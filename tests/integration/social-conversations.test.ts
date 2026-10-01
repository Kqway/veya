import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../support/postgres';
import { applyMigrations } from '@/lib/db/migrations';
import { socialActor, forbiddenKeys } from '../support/social';
import { ConversationService } from '@/features/social/conversations';
import { ensurePair, opaqueKey } from '@/features/social/pairs';
import { requireProfile, lockProfiles } from '@/features/social/context';
import { IdentityService } from '@/features/social/identity';
import { createGuestSession } from '@/features/backend/sessions';

describe('private conversations and explicit match disclosure', () => {
  let c: Awaited<ReturnType<typeof startTestDatabase>>;
  let service: ConversationService;
  beforeAll(async () => { c = await startTestDatabase(); await applyMigrations(c.db); service = new ConversationService(c.db); });
  afterAll(async () => { if (c) await c.stop(); });
  beforeEach(async () => { await c.db.query('TRUNCATE social_profiles CASCADE'); });
  async function match(a: Awaited<ReturnType<typeof socialActor>>, b: Awaited<ReturnType<typeof socialActor>>) {
    return c.db.transaction(async tx => {
      const own = await requireProfile(tx, a.token), peer = await requireProfile(tx, b.token);
      const pair = await ensurePair(tx, own, peer, own.privacy_mode, peer.privacy_mode);
      const request = await tx.query<{id:string}>("INSERT INTO connection_requests(public_key,pair_id,sender_profile_id,recipient_profile_id,pending_slot,status,activity_label) VALUES($1,$2,$3,$4,1,'accepted','Chess') RETURNING id", [opaqueKey(), pair.id, own.id, peer.id]);
      const key = opaqueKey();
      const m = await tx.query<{id:string}>("INSERT INTO social_matches(public_key,pair_id,request_id,activity_label) VALUES($1,$2,$3,'Chess') RETURNING id", [key,pair.id,request.rows[0]!.id]);
      const conv = await tx.query<{id:string}>('INSERT INTO conversations(match_id) VALUES($1) RETURNING id',[m.rows[0]!.id]);
      return {key,id:m.rows[0]!.id,conversation:conv.rows[0]!.id,own,peer,pair};
    });
  }
  it('owns reads, sends and list projections without revealing private identifiers', async () => {
    const a=await socialActor(c.db,'Secret-A'), b=await socialActor(c.db,'Secret-B'), x=await socialActor(c.db,'Outsider');
    const m=await match(a,b);
    const html='<img src=x onerror="alert(1)">';
    const message=await service.send(a.token,m.key,{text:html});
    expect(message.text).toBe(html); expect(message.isMine).toBe(true); expect(Date.parse(message.createdAt)).toBeGreaterThan(Date.now()-10000);
    const theirs=await service.messages(b.token,m.key); expect(theirs.messages[0]!.isMine).toBe(false);
    const view=await service.get(b.token,m.key); expect(view.identity).toEqual(message.identity); expect(view.ownIdentity.alias).not.toBe('Secret-B');
    expect(await service.list(b.token)).toEqual([view]); expect(await service.list(x.token)).toEqual([]);
    expect(forbiddenKeys([message,view,theirs])).toEqual([]); expect(JSON.stringify([message,view,theirs])).not.toMatch(/Secret-A|Secret-B/);
    await expect(service.get(x.token,m.key)).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(service.messages(x.token,m.key)).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(service.send(x.token,m.key,{text:'intrusion'})).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(service.send(a.token,m.key,{text:'x'.repeat(2001)})).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(service.send(a.token,m.key,{text:'ok',senderProfileId:m.peer.id})).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(service.send(a.token,m.key,{text:'   '})).rejects.toMatchObject({code:'INVALID_INPUT'});
  });
  it('returns bounded chronological pages and rejects cursors from other conversations', async () => {
    const a=await socialActor(c.db,'Page-A'),b=await socialActor(c.db,'Page-B'),x=await socialActor(c.db,'Page-X');
    const m=await match(a,b),other=await match(a,x);
    const sent=[];
    for(let i=0;i<55;i++) sent.push(await service.send(a.token,m.key,{text:`message ${i}`}));
    const recent=await service.messages(a.token,m.key); expect(recent.messages).toHaveLength(30); expect(recent.messages.map(v=>v.text)).toEqual(sent.slice(25).map(v=>v.text));
    expect(recent.nextBefore).toBe(sent[25]!.publicKey);
    const older=await service.messages(b.token,m.key,{before:recent.nextBefore!,limit:50}); expect(older.messages.map(v=>v.text)).toEqual(sent.slice(0,25).map(v=>v.text)); expect(older.nextBefore).toBeNull();
    const foreign=await service.send(a.token,other.key,{text:'other'});
    await expect(service.messages(a.token,m.key,{before:foreign.publicKey})).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(service.messages(a.token,m.key,{before:opaqueKey()})).rejects.toMatchObject({code:'NOT_FOUND'});
    for(const limit of [0,51,1.5]) await expect(service.messages(a.token,m.key,{limit})).rejects.toMatchObject({code:'INVALID_INPUT'});
  });
  it('preserves PostgreSQL microsecond ordering across opaque cursor pages', async () => {
    const a=await socialActor(c.db,'Precise-A'),b=await socialActor(c.db,'Precise-B');const m=await match(a,b);
    const keys=[opaqueKey(),opaqueKey(),opaqueKey()];
    for(let i=0;i<3;i++) await c.db.query('INSERT INTO messages(public_key,conversation_id,sender_profile_id,text,created_at) VALUES($1,$2,$3,$4,$5)',[keys[i],m.conversation,m.own.id,`precise ${i}`,`2026-01-01T00:00:00.000${i+1}00Z`]);
    const latest=await service.messages(a.token,m.key,{limit:1});expect(latest.messages[0]!.publicKey).toBe(keys[2]);
    const middle=await service.messages(a.token,m.key,{limit:1,before:latest.nextBefore!});expect(middle.messages[0]!.publicKey).toBe(keys[1]);
    const first=await service.messages(a.token,m.key,{limit:1,before:middle.nextBefore!});expect(first.messages[0]!.publicKey).toBe(keys[0]);expect(first.nextBefore).toBeNull();
  });
  it('requires explicit consent, keeps disclosure match-scoped and immutable', async () => {
    const a=await socialActor(c.db,'Share-A'),b=await socialActor(c.db,'Share-B'),x=await socialActor(c.db,'Share-X');
    const m=await match(a,b),other=await match(a,x);
    for(const consent of [false,undefined,'true']) await expect(service.disclose(a.token,m.key,{kind:'first_name',value:'Alice',consent})).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(service.disclose(x.token,m.key,{kind:'first_name',value:'X',consent:true})).rejects.toMatchObject({code:'NOT_FOUND'});
    expect(await service.disclose(a.token,m.key,{kind:'first_name',value:'Alice',consent:true})).toEqual({shared:true});
    expect(await service.disclose(a.token,m.key,{kind:'first_name',value:'Alice',consent:true})).toEqual({shared:true});
    await expect(service.disclose(a.token,m.key,{kind:'first_name',value:'Changed',consent:true})).rejects.toMatchObject({code:'CONFLICT'});
    await expect(service.disclose(a.token,m.key,{kind:'first_name',value:'x'.repeat(61),consent:true})).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(service.disclose(a.token,m.key,{kind:'contact_handle',value:'x'.repeat(121),consent:true})).rejects.toMatchObject({code:'INVALID_INPUT'});
    await service.disclose(b.token,m.key,{kind:'contact_handle',value:'@bob',consent:true});
    expect((await service.get(b.token,m.key)).disclosures).toEqual([{kind:'first_name',value:'Alice',isMine:false},{kind:'contact_handle',value:'@bob',isMine:true}]);
    expect((await service.get(x.token,other.key)).disclosures).toEqual([]);
  });
  it('keeps blocked history generically closed and prevents sends, disclosure and plan exposure', async () => {
    const a=await socialActor(c.db,'Closed-A'),b=await socialActor(c.db,'Closed-B'); const m=await match(a,b);
    await service.send(a.token,m.key,{text:'retained'}); await service.disclose(a.token,m.key,{kind:'first_name',value:'Alice',consent:true});
    const slug=opaqueKey();
    const intent=await c.db.query<{id:string}>("INSERT INTO intents(public_slug,creator_guest_id,creator_display_name,raw_text,title,expires_at) VALUES($1,(SELECT guest_id FROM social_profile_bindings WHERE profile_id=$2 LIMIT 1),'Pair','Chess','Chess',now()+interval '1 day') RETURNING id",[slug,m.own.id]);
    await c.db.query('UPDATE social_matches SET plan_intent_id=$1 WHERE id=$2',[intent.rows[0]!.id,m.id]);
    expect((await service.get(a.token,m.key)).planSlug).toBe(slug);
    await c.db.query('INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) VALUES($1,$2)',[m.peer.id,m.own.id]);
    for(const token of [a.token,b.token]) { const view=await service.get(token,m.key); expect(view.status).toBe('closed');expect(view.planSlug).toBeNull();expect(view.disclosures).toHaveLength(1);expect((await service.messages(token,m.key)).messages[0]!.text).toBe('retained');await expect(service.send(token,m.key,{text:'blocked'})).rejects.toMatchObject({code:'CONFLICT'});await expect(service.disclose(token,m.key,{kind:'contact_handle',value:'@blocked',consent:true})).rejects.toMatchObject({code:'CONFLICT'}); }
    await c.db.query('DELETE FROM social_blocks'); await c.db.query("UPDATE conversations SET status='closed' WHERE id=$1",[m.conversation]);
    expect((await service.get(a.token,m.key)).status).toBe('closed'); await expect(service.send(a.token,m.key,{text:'closed'})).rejects.toMatchObject({code:'CONFLICT'});
    expect((await c.db.query('SELECT * FROM messages')).rows).toHaveLength(1); expect((await c.db.query('SELECT * FROM match_disclosures')).rows).toHaveLength(1);
  });
  it('rechecks a block committed while message and disclosure sends wait on pair locks', async () => {
    const a=await socialActor(c.db,'Race-A'),b=await socialActor(c.db,'Race-B');const m=await match(a,b);
    let release!:()=>void,locked!:()=>void;const ready=new Promise<void>(resolve=>locked=resolve),hold=new Promise<void>(resolve=>release=resolve);
    const blocker=c.db.transaction(async tx=>{await lockProfiles(tx,[m.own.id,m.peer.id]);locked();await hold;await tx.query('INSERT INTO social_blocks(blocker_profile_id,blocked_profile_id) VALUES($1,$2)',[m.peer.id,m.own.id]);});await ready;
    const sendOutcome=expect(service.send(a.token,m.key,{text:'queued'})).rejects.toMatchObject({code:'CONFLICT'});
    const disclosureOutcome=expect(service.disclose(a.token,m.key,{kind:'first_name',value:'Alice',consent:true})).rejects.toMatchObject({code:'CONFLICT'});
    await new Promise(resolve=>setTimeout(resolve,30));release();await blocker;await Promise.all([sendOutcome,disclosureOutcome]);
    expect((await c.db.query('SELECT * FROM messages')).rows).toEqual([]);expect((await c.db.query('SELECT * FROM match_disclosures')).rows).toEqual([]);
  });
  it('uses current stronger privacy without exposing a newly incognito global alias', async () => {
    const a=await socialActor(c.db,'Open-A','OPEN'),b=await socialActor(c.db,'Open-B','OPEN'); const m=await match(a,b);
    expect((await service.get(a.token,m.key)).identity.alias).toBe('Open-B');
    await new IdentityService(c.db).update(b.token,{alias:'Private now',privacyMode:'INCOGNITO'});
    expect((await service.get(a.token,m.key)).identity.alias).not.toMatch(/Open-B|Private now/);
    expect((await service.send(b.token,m.key,{text:'private'})).identity.alias).not.toMatch(/Open-B|Private now/);
  });
  it('enforces sender membership and disclosure bounds in PostgreSQL with server-only RLS', async () => {
    const a=await socialActor(c.db,'DB-A'),b=await socialActor(c.db,'DB-B'),x=await socialActor(c.db,'DB-X'); const m=await match(a,b);const outsider=await c.db.transaction(tx=>requireProfile(tx,x.token));
    await expect(c.db.query('INSERT INTO messages(public_key,conversation_id,sender_profile_id,text) VALUES($1,$2,$3,$4)',[opaqueKey(),m.conversation,outsider.id,'intrusion'])).rejects.toMatchObject({code:'23514'});
    await expect(c.db.query("INSERT INTO match_disclosures(match_id,sender_profile_id,kind,value) VALUES($1,$2,'first_name','intrusion')",[m.id,outsider.id])).rejects.toMatchObject({code:'23514'});
    await expect(c.db.query("INSERT INTO match_disclosures(match_id,sender_profile_id,kind,value) VALUES($1,$2,'first_name',$3)",[m.id,m.own.id,'x'.repeat(61)])).rejects.toMatchObject({code:'23514'});
    const rls=await c.db.query<{relrowsecurity:boolean}>('SELECT relrowsecurity FROM pg_class WHERE relname IN ($1,$2)',['messages','match_disclosures']);expect(rls.rows).toHaveLength(2);expect(rls.rows.every(r=>r.relrowsecurity)).toBe(true);
    expect((await c.db.query("SELECT * FROM pg_policies WHERE tablename IN ('messages','match_disclosures')")).rows).toEqual([]);
  });
  it('reauthorizes expired sessions after waiting for participant locks', async () => {
    const a=await socialActor(c.db,'Expire-A'),b=await socialActor(c.db,'Expire-B'); const m=await match(a,b);
    await c.db.query("UPDATE guest_participant_sessions SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE token_hash=$1",[(await import('node:crypto')).createHash('sha256').update(a.token).digest('hex')]);
    let release!:()=>void,locked!:()=>void;
    const ready=new Promise<void>(resolve=>locked=resolve),hold=new Promise<void>(resolve=>release=resolve);
    const locker=c.db.transaction(async tx=>{await lockProfiles(tx,[m.own.id,m.peer.id]);locked();await hold;}); await ready;
    const pending=service.send(a.token,m.key,{text:'too late'}); const outcome=expect(pending).rejects.toMatchObject({code:'UNAUTHORIZED'});
    await new Promise(resolve=>setTimeout(resolve,600));release();await locker;await outcome;expect((await c.db.query('SELECT * FROM messages')).rows).toEqual([]);
  });
  it('reauthorizes removed recovery bindings after waiting for participant locks', async () => {
    const a=await socialActor(c.db,'Recover-A'),b=await socialActor(c.db,'Recover-B'); const m=await match(a,b);
    const fresh=await createGuestSession(c.db);
    let release!:()=>void,locked!:()=>void; const ready=new Promise<void>(resolve=>locked=resolve),hold=new Promise<void>(resolve=>release=resolve);
    const locker=c.db.transaction(async tx=>{await lockProfiles(tx,[m.own.id,m.peer.id]);locked();await hold;});await ready;
    // Queue recovery first, so it rotates and removes the previous binding before chat obtains the same lock.
    const recovering=new IdentityService(c.db).recover(fresh.token,{key:a.key});
    await new Promise(resolve=>setTimeout(resolve,30));
    const sending=service.send(a.token,m.key,{text:'old binding'});const outcome=expect(sending).rejects.toMatchObject({code:'NOT_FOUND'});
    await new Promise(resolve=>setTimeout(resolve,30));release();await locker;await recovering;await outcome;
    expect((await c.db.query('SELECT * FROM messages')).rows).toEqual([]);
  });
});
