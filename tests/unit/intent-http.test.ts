import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntentProductHandler } from '@/features/intent-product/http';
import type { BetaControls } from '@/lib/config/beta-policy';
import type { RateAction } from '@/lib/security/rate-limit';

beforeEach(() => { vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date('2026-10-04T09:00:00Z')); });
afterEach(() => vi.useRealTimers());

const origin = 'https://intent.test';
const controls: BetaControls = { signupsEnabled: true, seekingEnabled: true, readOnly: false };
const key = 'k'.repeat(24);
function request(path: string, method = 'POST', body = 'malformed-json', requestOrigin = origin) {
  return new Request(`${origin}/api/intent-product/${path}`, { method, headers: { origin: requestOrigin, 'content-type': 'application/json', cookie: 'veya_guest=actor-token' }, ...(method === 'GET' ? {} : { body }) });
}
function forbiddenDatabase() { return vi.fn(() => { throw new Error('Database construction must not run'); }); }
function reader(request: Request) { return request.body ? vi.spyOn(request.body, 'getReader') : undefined; }

it('rejects foreign origin before beta controls, quotas, body consumption, or database construction', async () => {
  const db = forbiddenDatabase(), beta = vi.fn(() => controls), check = vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 }));
  const handler = createIntentProductHandler({ origin, db, getBetaControls: beta, limiter: { check } });
  const req = request('searches', 'POST', 'malformed-json', 'https://foreign.test'), consumed = reader(req);
  const response = await handler(req, ['searches']);
  expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: { code: 'ORIGIN_REJECTED' } });
  expect(beta).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled(); expect(consumed).not.toHaveBeenCalled(); expect(db).not.toHaveBeenCalled();
});

it.each([
  ['POST', 'searches'], ['PATCH', `searches/${key}`], ['POST', `searches/${key}/command`],
  ['POST', `offers/${key}/respond`], ['PATCH', 'preferences'], ['POST', `rooms/${key}/messages`],
  ['POST', `rooms/${key}/state`], ['POST', `rooms/${key}/remove`], ['POST', `rooms/${key}/plan`],
])('rejects read-only %s %s before quota, body, and database work', async (method, path) => {
  const db = forbiddenDatabase(), check = vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 }));
  const handler = createIntentProductHandler({ origin, db, getBetaControls: () => ({ ...controls, readOnly: true }), limiter: { check } });
  const req = request(path, method), consumed = reader(req), response = await handler(req, path.split('/'));
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: { code: 'BETA_READ_ONLY' } });
  expect(check).not.toHaveBeenCalled(); expect(consumed).not.toHaveBeenCalled(); expect(db).not.toHaveBeenCalled();
});

it('pauses new searches before quotas and expensive work when seeking is disabled', async () => {
  const db = forbiddenDatabase(), check = vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 }));
  const handler = createIntentProductHandler({ origin, db, getBetaControls: () => ({ ...controls, seekingEnabled: false }), limiter: { check } });
  const req = request('searches'), consumed = reader(req), response = await handler(req, ['searches']);
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: { code: 'BETA_SEEKING_PAUSED' } });
  expect(check).not.toHaveBeenCalled(); expect(consumed).not.toHaveBeenCalled(); expect(db).not.toHaveBeenCalled();
});

it.each([
  ['POST', 'interpret', 'ai'], ['POST', 'searches', 'seekingCreate'], ['GET', 'offers', 'socialRead'],
  ['POST', `offers/${key}/respond`, 'connection'], ['POST', `rooms/${key}/messages`, 'message'],
  ['POST', `rooms/${key}/report`, 'report'], ['POST', `rooms/${key}/block`, 'socialWrite'],
] as [string, string, RateAction][])('applies the %s %s quota before reading input or constructing services', async (method, path, action) => {
  const db = forbiddenDatabase(), check = vi.fn(() => ({ allowed: false, retryAfterSeconds: 17 }));
  const handler = createIntentProductHandler({ origin, db, getBetaControls: () => controls, limiter: { check } });
  const req = request(path, method), consumed = reader(req), response = await handler(req, path.split('/'));
  expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('17'); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(check).toHaveBeenCalledWith(action, 'actor-token'); if (consumed) expect(consumed).not.toHaveBeenCalled(); expect(db).not.toHaveBeenCalled();
});

it.each(['block', 'report'])('keeps room %s safety available under read-only controls', async operation => {
  const db = forbiddenDatabase(), check = vi.fn(() => ({ allowed: false, retryAfterSeconds: 1 }));
  const handler = createIntentProductHandler({ origin, db, getBetaControls: () => ({ ...controls, readOnly: true }), limiter: { check } });
  const response = await handler(request(`rooms/${key}/${operation}`), ['rooms', key, operation]);
  expect(response.status).toBe(429); expect(check).toHaveBeenCalledOnce(); expect(db).not.toHaveBeenCalled();
});

describe('bounded own-text interpretation HTTP errors', () => {
  it.each([
    { text: 'Дота завтра вечером нужны 99 человек', timezone: 'UTC', referenceDate: '2026-10-04' },
    { text: 'продли на 2000 минут', timezone: 'UTC', referenceDate: '2026-10-04' },
    { text: 'x'.repeat(501), timezone: 'UTC', referenceDate: '2026-10-04' },
    { text: 'Дота завтра вечером', timezone: 'UTC', referenceDate: '2026-10-04', candidateProfiles: [{ id: 'foreign' }] },
  ])('returns safe 400 for invalid actor text or forbidden structured context', async body => {
    const db = forbiddenDatabase(), handler = createIntentProductHandler({ origin, db, getBetaControls: () => controls });
    const response = await handler(request('interpret', 'POST', JSON.stringify(body)), ['interpret']);
    expect(response.status).toBe(400); const value = await response.json(); expect(value).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(JSON.stringify(value)).not.toMatch(/ZodError|too_big|candidateProfiles|foreign|99 человек|2000 минут/); expect(db).not.toHaveBeenCalled();
  });
  it('interprets valid actor input without a database or candidate context', async () => {
    const db = forbiddenDatabase(), handler = createIntentProductHandler({ origin, db, getBetaControls: () => controls });
    const response = await handler(request('interpret', 'POST', JSON.stringify({ text: 'Дота завтра вечером нужен пятый', timezone: 'UTC', referenceDate: '2026-10-04' })), ['interpret']);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ interpretation: { kind: 'draft', draft: { existingPeople: 4, neededPeople: 1 } } });
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(db).not.toHaveBeenCalled();
  });
});
