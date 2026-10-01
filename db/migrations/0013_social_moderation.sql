ALTER TABLE social_profiles ADD COLUMN can_seek boolean NOT NULL DEFAULT true;
ALTER TABLE social_profiles ADD COLUMN can_connect boolean NOT NULL DEFAULT true;
ALTER TABLE social_profiles ADD COLUMN moderation_status text NOT NULL DEFAULT 'active' CHECK(moderation_status IN('active','suspended'));
ALTER TABLE social_reports ADD COLUMN public_key text NOT NULL DEFAULT translate(left(encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text,'-',''),'hex'),'base64'),24),'+/','-_') UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$');
ALTER TABLE social_reports DROP CONSTRAINT social_reports_status_check;
UPDATE social_reports SET status=CASE WHEN status='received' THEN 'open' ELSE 'resolved' END;
ALTER TABLE social_reports ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE social_reports ADD CONSTRAINT social_reports_status_check CHECK(status IN('open','reviewing','resolved','dismissed'));
ALTER TABLE social_reports ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}';
ALTER TABLE social_reports ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
-- Freeze only reported context, without disclosures, location, exact availability,
-- guest bindings, profile identifiers or recovery credentials. Recent chat is bounded20.
CREATE FUNCTION moderation_report_evidence(reporter uuid,target uuid,request uuid,match uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('profiles',jsonb_build_array(
   jsonb_build_object('role','reporter','label','Reporting participant'),
   jsonb_build_object('role','target','label','Reported participant')),
   'posts',COALESCE((SELECT jsonb_agg(jsonb_build_object('role',CASE WHEN p.profile_id=reporter THEN 'reporter' ELSE 'target' END,'activityLabel',p.activity_label,'interactionMode',p.interaction_mode,'format',p.format)) FROM seeking_posts p WHERE p.id IN(SELECT r.source_post_id FROM connection_requests r WHERE r.id=COALESCE(request,(SELECT m.request_id FROM social_matches m WHERE m.id=match)) UNION SELECT r.target_post_id FROM connection_requests r WHERE r.id=COALESCE(request,(SELECT m.request_id FROM social_matches m WHERE m.id=match)))),'[]'::jsonb),
   'messages',COALESCE((SELECT jsonb_agg(jsonb_build_object('role',CASE WHEN recent.sender_profile_id=reporter THEN 'reporter' ELSE 'target' END,'text',recent.text,'createdAt',recent.created_at) ORDER BY recent.created_at,recent.id) FROM (SELECT msg.id,msg.sender_profile_id,msg.text,msg.created_at FROM messages msg JOIN conversations c ON c.id=msg.conversation_id WHERE c.match_id=match ORDER BY msg.created_at DESC,msg.id DESC LIMIT 20) recent),'[]'::jsonb))
$$;
UPDATE social_reports SET evidence=moderation_report_evidence(reporter_profile_id,target_profile_id,request_id,match_id);
CREATE FUNCTION moderation_freeze_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.evidence=moderation_report_evidence(NEW.reporter_profile_id,NEW.target_profile_id,NEW.request_id,NEW.match_id);
 ELSIF (NEW.public_key,NEW.evidence,NEW.created_at) IS DISTINCT FROM (OLD.public_key,OLD.evidence,OLD.created_at) THEN
  RAISE EXCEPTION 'Report evidence is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER moderation_report_freeze BEFORE INSERT OR UPDATE ON social_reports FOR EACH ROW EXECUTE FUNCTION moderation_freeze_evidence();
CREATE INDEX moderation_open_queue ON social_reports(created_at,id) WHERE status IN('open','reviewing');
CREATE TABLE moderation_admin_sessions (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 secret_fingerprint text NOT NULL CHECK(secret_fingerprint ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT statement_timestamp()+interval '8 hours',
 revoked_at timestamptz,
 CHECK(expires_at<=created_at+interval '8 hours')
);
CREATE INDEX moderation_session_expiry ON moderation_admin_sessions(expires_at);
-- No foreign keys: audit survives ordinary context/profile cleanup. Explicit
-- human-authorized legal purge may delete records; application never updates them.
CREATE TABLE moderation_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 report_public_key text CHECK(report_public_key ~ '^[A-Za-z0-9_-]{24}$'),
 moderator text NOT NULL CHECK(moderator='configured-admin'),
 action text NOT NULL CHECK(action IN('queue_read','case_read','case_action')),
 details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION moderation_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit records are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER moderation_audit_immutable BEFORE UPDATE ON moderation_audit FOR EACH ROW EXECUTE FUNCTION moderation_audit_append_only();
ALTER TABLE moderation_admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_audit ENABLE ROW LEVEL SECURITY;
