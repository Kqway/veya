import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { ServerEnv } from '@/lib/config/env';
import type { Database } from '@/lib/db/types';
import { json } from '@/features/backend/http';
import { processCandidateJobs } from '@/features/discovery/candidate-jobs';
import { processNotificationJobs } from '@/features/notifications/jobs';
import { logOperationalEvent } from '@/lib/logging/server';

/** Machine-only entry point. Guest cookies, query parameters and client identity have no authority. */
export function createSocialCronHandler(options: {config: () => ServerEnv; database: () => Database}) {
  return async (request: Request): Promise<Response> => {
    const started = Date.now();
    try {
      if (request.method !== 'GET') return json({error: {code: 'METHOD_NOT_ALLOWED'}}, 405);
      const config = options.config();
      if (!config.CRON_SECRET) return json({error: {code: 'UNAVAILABLE'}}, 503);
      const authorization = request.headers.get('authorization') ?? '';
      const digest = (value: string) => createHash('sha256').update(value).digest();
      if (authorization.length > 512 || !timingSafeEqual(digest(authorization), digest('Bearer ' + config.CRON_SECRET))) {
        return json({error: {code: 'UNAUTHORIZED'}}, 401);
      }
      if (new URL(request.url).search) return json({error: {code: 'INVALID_INPUT'}}, 400);
      if (config.BETA_READ_ONLY) {
        logOperationalEvent('worker_skipped');
        return json({ok: true, skipped: true});
      }
      // The existing durable leases handle concurrent schedulers and host interruption.
      // The deadline stops starting further work; in-flight transactions finish safely.
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
      const db = options.database();
      logOperationalEvent('worker_started');
      const candidates = await processCandidateJobs(db, {limit: 5, signal});
      const push = config.PUSH_VAPID_PUBLIC_KEY && config.PUSH_VAPID_PRIVATE_KEY && config.PUSH_VAPID_SUBJECT && new URL(config.NEXT_PUBLIC_APP_URL).protocol === 'https:'
        ? {publicKey: config.PUSH_VAPID_PUBLIC_KEY, privateKey: config.PUSH_VAPID_PRIVATE_KEY, subject: config.PUSH_VAPID_SUBJECT} : undefined;
      const notifications = await processNotificationJobs(db, {limit: 5, signal, ...(push ? {push} : {})});
      logOperationalEvent('worker_complete', candidates);
      logOperationalEvent('worker_complete', {...notifications, durationMs: Date.now() - started});
      const failures = candidates.failed + candidates.retried + notifications.failed + notifications.retried;
      if (failures) logOperationalEvent('worker_failed', {count: failures});
      return json({ok: failures === 0, candidates, notifications}, failures ? 503 : 200);
    } catch {
      logOperationalEvent('worker_failed', {durationMs: Date.now() - started});
      return json({error: {code: 'UNAVAILABLE'}}, 503);
    }
  };
}
