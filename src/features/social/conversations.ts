import { enqueueNotification } from '@/features/notifications/service';
import { trackFunnel } from '@/lib/analytics/funnel';
import { publishSocialEvent } from '@/features/realtime/events';
import 'server-only';
import { z } from 'zod';
import type { Database, DatabaseExecutor } from '@/lib/db/types';
import { validate } from '@/features/backend/validation';
import { lockProfiles, reauthorize, requireProfile, type ProfileRow } from './context';
import { fail } from './errors';
import { isBlocked, opaqueKey, pairIdentity, peerId, readPair, readProfile, type PairRow } from './pairs';
import { publicKeySchema } from './seeking-schema';
import { matchSchema, messageSchema, type MatchDTO, type MessageDTO } from './network-projections';

const textSchema = z.string().min(1).max(2000).refine(value => value.trim().length > 0 && !value.includes('\0'));
const sendSchema = z.object({ text: textSchema }).strict();
const querySchema = z.object({ before: publicKeySchema.optional(), limit: z.number().int().min(1).max(50).default(30) }).strict();
const disclosureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('first_name'), value: z.string().trim().min(1).max(60).refine(v => !v.includes('\0')), consent: z.literal(true) }).strict(),
  z.object({ kind: z.literal('contact_handle'), value: z.string().trim().min(1).max(120).refine(v => !v.includes('\0')), consent: z.literal(true) }).strict(),
]);
export type MatchRow = { id: string; public_key: string; pair_id: string; status: 'active' | 'closed'; activity_label: string; conversation_id: string; conversation_status: 'active' | 'closed'; plan_slug: string | null };
type MessageRow = { id: string; public_key: string; sender_profile_id: string; text: string; created_at: Date };
export type ConversationContext = { match: MatchRow; pair: PairRow; own: ProfileRow; peer: ProfileRow; closed: boolean };

async function readMatch(tx: DatabaseExecutor, key: string): Promise<MatchRow> {
  const result = await tx.query<MatchRow>(`SELECT m.id,m.public_key,m.pair_id,m.status,m.activity_label,c.id AS conversation_id,c.status AS conversation_status,i.public_slug AS plan_slug
    FROM social_matches m JOIN conversations c ON c.match_id=m.id LEFT JOIN intents i ON i.id=m.plan_intent_id WHERE m.public_key=$1`, [key]);
  return result.rows[0] ?? fail('NOT_FOUND');
}
async function contextAfterLocks(tx: DatabaseExecutor, token: string, ownId: string, key: string): Promise<ConversationContext> {
  const own = await reauthorize(tx, token, ownId);
  const match = await readMatch(tx, key), pair = await readPair(tx, match.pair_id);
  const peer = await readProfile(tx, peerId(pair, own.id));
  const closed = match.status === 'closed' || match.conversation_status === 'closed' || await isBlocked(tx, pair.low_profile_id, pair.high_profile_id);
  return { match, pair, own, peer, closed };
}
export async function authorizeMatch(tx: DatabaseExecutor, token: string, key: string): Promise<ConversationContext> {
  const own = await requireProfile(tx, token);
  const match = await readMatch(tx, key), pair = await readPair(tx, match.pair_id);
  peerId(pair, own.id);
  await lockProfiles(tx, [pair.low_profile_id, pair.high_profile_id]);
  return contextAfterLocks(tx, token, own.id, key);
}
async function projectMatch(tx: DatabaseExecutor, context: ConversationContext): Promise<MatchDTO> {
  const { match, pair, own, peer, closed } = context;
  const disclosures = await tx.query<{kind:'first_name'|'contact_handle';value:string;sender_profile_id:string}>(
    'SELECT kind,value,sender_profile_id FROM match_disclosures WHERE match_id=$1 ORDER BY created_at,sender_profile_id,kind LIMIT 4', [match.id]);
  return matchSchema.parse({ publicKey: match.public_key, status: closed ? 'closed' : 'active', identity: await pairIdentity(tx, pair, peer), ownIdentity: await pairIdentity(tx, pair, own), activityLabel: match.activity_label,
    disclosures: disclosures.rows.map(row => ({kind: row.kind, value: row.value, isMine: row.sender_profile_id === own.id})), planSlug: closed ? null : match.plan_slug });
}
async function projectMessage(tx: DatabaseExecutor, context: ConversationContext, row: MessageRow): Promise<MessageDTO> {
  const mine = row.sender_profile_id === context.own.id;
  if (!mine && row.sender_profile_id !== context.peer.id) fail('NOT_FOUND');
  return messageSchema.parse({ publicKey: row.public_key, text: row.text, createdAt: row.created_at.toISOString(), isMine: mine, identity: await pairIdentity(tx, context.pair, mine ? context.own : context.peer) });
}

export class ConversationService {
  constructor(private readonly db: Database, private readonly options: {analyticsEnabled?: boolean} = {}) {}
  async get(token: string, matchKey: string): Promise<MatchDTO> {
    validate(publicKeySchema, matchKey);
    return this.db.transaction(async tx => projectMatch(tx, await authorizeMatch(tx, token, matchKey)));
  }
  async list(token: string): Promise<MatchDTO[]> {
    return this.db.transaction(async tx => {
      const own = await requireProfile(tx, token);
      const matches = await tx.query<{public_key:string;low_profile_id:string;high_profile_id:string}>(`SELECT m.public_key,p.low_profile_id,p.high_profile_id FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id
        WHERE $1 IN (p.low_profile_id,p.high_profile_id) ORDER BY m.created_at DESC,m.id DESC LIMIT 20`, [own.id]);
      await lockProfiles(tx, [own.id, ...matches.rows.flatMap(row => [row.low_profile_id, row.high_profile_id])]);
      await reauthorize(tx, token, own.id);
      const result: MatchDTO[] = [];
      for (const row of matches.rows) result.push(await projectMatch(tx, await contextAfterLocks(tx, token, own.id, row.public_key)));
      return result;
    });
  }
  async messages(token: string, matchKey: string, query: {before?: string; limit?: number} = {}): Promise<{messages: MessageDTO[]; nextBefore: string | null}> {
    validate(publicKeySchema, matchKey);
    const data = validate(querySchema, query);
    return this.db.transaction(async tx => {
      const context = await authorizeMatch(tx, token, matchKey);
      let before: string | undefined;
      if (data.before) {
        const cursor = await tx.query<{public_key:string}>('SELECT public_key FROM messages WHERE conversation_id=$1 AND public_key=$2', [context.match.conversation_id, data.before]);
        before = cursor.rows[0]?.public_key ?? fail('NOT_FOUND');
      }
      const rows = await tx.query<MessageRow>(`SELECT id,public_key,sender_profile_id,text,created_at FROM messages WHERE conversation_id=$1
        ${before ? 'AND (created_at,id)<(SELECT created_at,id FROM messages WHERE conversation_id=$1 AND public_key=$3)' : ''} ORDER BY created_at DESC,id DESC LIMIT $2`, before ? [context.match.conversation_id,data.limit+1,before] : [context.match.conversation_id,data.limit+1]);
      const page = rows.rows.slice(0,data.limit).reverse();
      const result: MessageDTO[] = [];
      // Request-local identities use the current, reauthorized profiles and pair
      // privacy after locks. At most two senders exist in a conversation page.
      const identities = new Map<string, Awaited<ReturnType<typeof pairIdentity>>>();
      for (const row of page) {
        const mine = row.sender_profile_id === context.own.id;
        if (!mine && row.sender_profile_id !== context.peer.id) fail('NOT_FOUND');
        let identity = identities.get(row.sender_profile_id);
        if (!identity) {
          identity = await pairIdentity(tx, context.pair, mine ? context.own : context.peer);
          identities.set(row.sender_profile_id, identity);
        }
        result.push(messageSchema.parse({ publicKey: row.public_key, text: row.text, createdAt: row.created_at.toISOString(), isMine: mine, identity }));
      }
      return { messages: result, nextBefore: rows.rows.length > data.limit ? page[0]!.public_key : null };
    });
  }
  async send(token: string, matchKey: string, input: unknown): Promise<MessageDTO> {
    validate(publicKeySchema, matchKey);
    const data = validate(sendSchema, input);
    return this.db.transaction(async tx => {
      const context = await authorizeMatch(tx, token, matchKey);
      if (context.closed) fail('CONFLICT');
      const prior = await tx.query('SELECT 1 FROM messages WHERE conversation_id=$1 LIMIT 1',[context.match.conversation_id]);
      const result = await tx.query<MessageRow>('INSERT INTO messages(public_key,conversation_id,sender_profile_id,text) VALUES($1,$2,$3,$4) RETURNING id,public_key,sender_profile_id,text,created_at', [opaqueKey(),context.match.conversation_id,context.own.id,data.text]);
      await enqueueNotification(tx,{recipientProfileId:context.peer.id,peerProfileId:context.own.id,type:'NEW_MESSAGE',matchKey,dedupeKey:'message:'+result.rows[0]!.id});
      if (!prior.rows.length) await trackFunnel(tx,'first_message_sent',this.options.analyticsEnabled ?? false);
      await publishSocialEvent(tx,[context.own.id,context.peer.id],{topic:'match',matchKey});
      return projectMessage(tx, context, result.rows[0]!);
    });
  }
  async disclose(token: string, matchKey: string, input: unknown): Promise<{shared: true}> {
    validate(publicKeySchema, matchKey);
    const data = validate(disclosureSchema, input);
    return this.db.transaction(async tx => {
      const context = await authorizeMatch(tx, token, matchKey);
      if (context.closed) fail('CONFLICT');
      const previous = await tx.query<{value:string}>('SELECT value FROM match_disclosures WHERE match_id=$1 AND sender_profile_id=$2 AND kind=$3', [context.match.id,context.own.id,data.kind]);
      if (previous.rows[0]) {
        if (previous.rows[0].value !== data.value) fail('CONFLICT');
      } else {
        await tx.query('INSERT INTO match_disclosures(match_id,sender_profile_id,kind,value) VALUES($1,$2,$3,$4)', [context.match.id,context.own.id,data.kind,data.value]);
        await publishSocialEvent(tx,[context.own.id,context.peer.id],{topic:'match',matchKey});
      }
      return { shared: true };
    });
  }
}
