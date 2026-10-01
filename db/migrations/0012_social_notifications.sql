ALTER TABLE social_profile_bindings ADD CONSTRAINT social_binding_guest_profile UNIQUE(guest_id,profile_id);
CREATE TABLE social_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 public_key text NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$'),
 recipient_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 peer_profile_id uuid REFERENCES social_profiles(id) ON DELETE CASCADE,
 type text NOT NULL CHECK(type IN('INTEREST_RECEIVED','INTEREST_ACCEPTED','NEW_MESSAGE','PLAN_READY','MEETUP_REMINDER','CANDIDATE_FOUND')),
 request_id uuid REFERENCES connection_requests(id) ON DELETE CASCADE,
 match_id uuid REFERENCES social_matches(id) ON DELETE CASCADE,
 dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 256),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),read_at timestamptz,
 UNIQUE(recipient_profile_id,dedupe_key),CHECK(peer_profile_id IS NULL OR peer_profile_id<>recipient_profile_id),
 CHECK(request_id IS NULL OR match_id IS NULL)
);
CREATE INDEX social_notifications_cursor ON social_notifications(recipient_profile_id,created_at DESC,id DESC);
CREATE INDEX social_notifications_unread ON social_notifications(recipient_profile_id,created_at DESC) WHERE read_at IS NULL;
CREATE TABLE social_push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 guest_id uuid NOT NULL REFERENCES guest_participant_sessions(id) ON DELETE CASCADE,
 profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 endpoint text NOT NULL UNIQUE CHECK(length(endpoint)<=2048 AND endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)(:443)?/[^#]+$'),
 p256dh text NOT NULL CHECK(p256dh ~ '^[A-Za-z0-9_-]{87}$'), auth text NOT NULL CHECK(auth ~ '^[A-Za-z0-9_-]{22}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(guest_id,profile_id) REFERENCES social_profile_bindings(guest_id,profile_id) ON DELETE CASCADE
);
CREATE INDEX social_push_profile ON social_push_subscriptions(profile_id);
CREATE TABLE social_notification_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 notification_id uuid NOT NULL REFERENCES social_notifications(id) ON DELETE CASCADE,
 subscription_id uuid NOT NULL REFERENCES social_push_subscriptions(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','delivered','cancelled','failed')),
 attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_key text CHECK(lease_key ~ '^[A-Za-z0-9_-]{24}$'),lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz,
 UNIQUE(notification_id,subscription_id),
 CHECK((status='processing')=(lease_key IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX social_notification_jobs_claim ON social_notification_jobs(available_at,id) WHERE status IN('pending','processing');
CREATE FUNCTION social_validate_notification_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM connection_requests r WHERE r.id=NEW.request_id AND NEW.recipient_profile_id IN(r.sender_profile_id,r.recipient_profile_id) AND NEW.peer_profile_id=CASE WHEN NEW.recipient_profile_id=r.sender_profile_id THEN r.recipient_profile_id ELSE r.sender_profile_id END) THEN RAISE EXCEPTION 'Invalid notification context' USING ERRCODE='23514'; END IF;
 IF NEW.match_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id WHERE m.id=NEW.match_id AND NEW.recipient_profile_id IN(p.low_profile_id,p.high_profile_id) AND NEW.peer_profile_id=CASE WHEN NEW.recipient_profile_id=p.low_profile_id THEN p.high_profile_id ELSE p.low_profile_id END) THEN RAISE EXCEPTION 'Invalid notification context' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_notification_context BEFORE INSERT OR UPDATE ON social_notifications FOR EACH ROW EXECUTE FUNCTION social_validate_notification_context();
ALTER TABLE social_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_notification_jobs ENABLE ROW LEVEL SECURITY;
