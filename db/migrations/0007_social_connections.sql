CREATE TABLE social_pairs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 low_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 high_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 low_privacy text NOT NULL CHECK(low_privacy IN('OPEN','PRIVATE','INCOGNITO')),
 high_privacy text NOT NULL CHECK(high_privacy IN('OPEN','PRIVATE','INCOGNITO')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(low_profile_id,high_profile_id), CHECK(low_profile_id<high_profile_id)
);
CREATE INDEX social_pairs_low_membership ON social_pairs(low_profile_id,created_at DESC);
CREATE INDEX social_pairs_high_membership ON social_pairs(high_profile_id,created_at DESC);
CREATE TABLE pairwise_identities (
 pair_id uuid NOT NULL REFERENCES social_pairs(id) ON DELETE CASCADE,
 side text NOT NULL CHECK(side IN('low','high')),
 alias text NOT NULL CHECK(length(alias) BETWEEN 1 AND 60),
 avatar_seed text NOT NULL CHECK(avatar_seed ~ '^[a-f0-9]{32}$'),
 PRIMARY KEY(pair_id,side)
);
CREATE TABLE social_blocks (
 blocker_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 blocked_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(blocker_profile_id,blocked_profile_id), CHECK(blocker_profile_id<>blocked_profile_id)
);
CREATE INDEX social_blocks_reverse ON social_blocks(blocked_profile_id,blocker_profile_id);
CREATE TABLE discovery_handles (
 public_handle text PRIMARY KEY CHECK(public_handle ~ '^[A-Za-z0-9_-]{24}$'),
 viewer_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 source_post_id uuid NOT NULL REFERENCES seeking_posts(id) ON DELETE CASCADE,
 target_post_id uuid NOT NULL REFERENCES seeking_posts(id) ON DELETE CASCADE,
 pair_id uuid NOT NULL REFERENCES social_pairs(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(viewer_profile_id,source_post_id,target_post_id),CHECK(source_post_id<>target_post_id)
);
CREATE INDEX discovery_daily_budget ON discovery_handles(viewer_profile_id,created_at DESC);
CREATE TABLE discovery_passes (
 viewer_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 target_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(viewer_profile_id,target_profile_id),CHECK(viewer_profile_id<>target_profile_id)
);
CREATE TABLE connection_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_key text NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$'),
 pair_id uuid NOT NULL REFERENCES social_pairs(id) ON DELETE CASCADE,
 sender_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 recipient_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 source_post_id uuid REFERENCES seeking_posts(id) ON DELETE SET NULL,
 target_post_id uuid REFERENCES seeking_posts(id) ON DELETE SET NULL,
 pending_slot smallint NOT NULL CHECK(pending_slot BETWEEN 1 AND 10),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','declined','expired')),
 activity_label text NOT NULL CHECK(length(activity_label) BETWEEN 1 AND 80),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(sender_profile_id<>recipient_profile_id)
);
CREATE UNIQUE INDEX connection_live_pair ON connection_requests(pair_id) WHERE status<>'expired';
CREATE INDEX connection_outbox ON connection_requests(sender_profile_id,created_at DESC);
CREATE UNIQUE INDEX connection_pending_slots ON connection_requests(sender_profile_id,pending_slot) WHERE status='pending';
CREATE INDEX connection_inbox ON connection_requests(recipient_profile_id,created_at DESC);
CREATE TABLE social_matches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_key text NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$'),
 pair_id uuid NOT NULL UNIQUE REFERENCES social_pairs(id) ON DELETE CASCADE,
 request_id uuid NOT NULL UNIQUE REFERENCES connection_requests(id) ON DELETE CASCADE,
 activity_label text NOT NULL CHECK(length(activity_label) BETWEEN 1 AND 80),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','closed')),
 plan_intent_id uuid REFERENCES intents(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),closed_at timestamptz
);
CREATE TABLE conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),match_id uuid NOT NULL UNIQUE REFERENCES social_matches(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','closed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION social_validate_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pair social_pairs;
BEGIN
 SELECT * INTO pair FROM social_pairs WHERE id=NEW.pair_id;
 IF NOT((pair.low_profile_id=NEW.sender_profile_id AND pair.high_profile_id=NEW.recipient_profile_id) OR (pair.high_profile_id=NEW.sender_profile_id AND pair.low_profile_id=NEW.recipient_profile_id)) THEN RAISE EXCEPTION 'Invalid pair membership' USING ERRCODE='23514'; END IF;
 IF NEW.source_post_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM seeking_posts WHERE id=NEW.source_post_id AND profile_id=NEW.sender_profile_id) THEN RAISE EXCEPTION 'Invalid post ownership' USING ERRCODE='23514'; END IF;
 IF NEW.target_post_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM seeking_posts WHERE id=NEW.target_post_id AND profile_id=NEW.recipient_profile_id) THEN RAISE EXCEPTION 'Invalid post ownership' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER connection_membership BEFORE INSERT OR UPDATE ON connection_requests FOR EACH ROW EXECUTE FUNCTION social_validate_request();
CREATE FUNCTION social_validate_match() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM connection_requests WHERE id=NEW.request_id AND pair_id=NEW.pair_id AND status='accepted') THEN RAISE EXCEPTION 'Match requires accepted request' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER match_acceptance BEFORE INSERT OR UPDATE ON social_matches FOR EACH ROW EXECUTE FUNCTION social_validate_match();
ALTER TABLE social_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairwise_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_handles ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
