-- Additive intent orchestration. Server-only RLS; no public database policies.
CREATE TABLE social_action_searches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_key text NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$'),
 profile_id uuid NOT NULL REFERENCES social_profiles(id), post_id uuid UNIQUE REFERENCES seeking_posts(id) ON DELETE SET NULL,
 activity_label text NOT NULL CHECK(length(activity_label) BETWEEN 1 AND 80),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','filled','closed','expired')),
 draft jsonb NOT NULL CHECK(jsonb_typeof(draft)='object'), needed_people smallint NOT NULL CHECK(needed_people BETWEEN 1 AND 11),
 existing_people smallint NOT NULL CHECK(existing_people BETWEEN 1 AND 11),
 compatible_count smallint NOT NULL DEFAULT 0 CHECK(compatible_count BETWEEN 0 AND 100), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 CHECK(existing_people+needed_people BETWEEN 2 AND 12), CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days')
);
CREATE INDEX social_action_search_owner ON social_action_searches(profile_id,created_at DESC);
CREATE INDEX social_action_search_active ON social_action_searches(expires_at,id) WHERE status='active';
CREATE TABLE social_lobbies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), search_id uuid NOT NULL UNIQUE REFERENCES social_action_searches(id) ON DELETE CASCADE,
 owner_profile_id uuid NOT NULL REFERENCES social_profiles(id), capacity smallint NOT NULL CHECK(capacity BETWEEN 2 AND 12),
 external_count smallint NOT NULL CHECK(external_count BETWEEN 0 AND 10 AND external_count<capacity),
 status text NOT NULL DEFAULT 'forming' CHECK(status IN('forming','ready','active','completed','archived','closed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE social_candidate_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_key text NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$'),
 search_id uuid NOT NULL REFERENCES social_action_searches(id) ON DELETE CASCADE, recipient_profile_id uuid NOT NULL REFERENCES social_profiles(id),
 target_post_id uuid REFERENCES seeking_posts(id) ON DELETE SET NULL, pending_slot smallint NOT NULL CHECK(pending_slot BETWEEN 1 AND 10),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','declined','expired','cancelled')),
 source_revision integer NOT NULL CHECK(source_revision>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 UNIQUE(search_id,recipient_profile_id,source_revision), CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours')
);
CREATE UNIQUE INDEX social_offer_pending_slot ON social_candidate_offers(search_id,pending_slot) WHERE status='pending';
CREATE UNIQUE INDEX social_offer_pending_recipient ON social_candidate_offers(search_id,recipient_profile_id) WHERE status='pending';
CREATE INDEX social_offer_inbox ON social_candidate_offers(recipient_profile_id,created_at DESC);
CREATE TABLE social_lobby_members (
 lobby_id uuid NOT NULL REFERENCES social_lobbies(id) ON DELETE CASCADE, profile_id uuid NOT NULL REFERENCES social_profiles(id),
 public_key text NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$'), alias text NOT NULL CHECK(length(alias) BETWEEN 1 AND 60),
 avatar_seed text NOT NULL CHECK(avatar_seed ~ '^[a-f0-9]{32}$'), privacy_mode text NOT NULL CHECK(privacy_mode IN('OPEN','PRIVATE','INCOGNITO')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','left','removed','deleted')), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(lobby_id,profile_id)
);
CREATE INDEX social_lobby_member_profile ON social_lobby_members(profile_id,lobby_id) WHERE status='active';
CREATE TABLE social_rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_key text NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$'),
 lobby_id uuid NOT NULL UNIQUE REFERENCES social_lobbies(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'ready' CHECK(status IN('ready','active','completed','archived','closed')),
 plan_intent_id uuid REFERENCES intents(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE social_room_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_key text NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$'),
 room_id uuid NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE, author_profile_id uuid NOT NULL REFERENCES social_profiles(id),
 text text NOT NULL CHECK(length(text) BETWEEN 1 AND 2000 AND length(btrim(text))>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX social_room_message_cursor ON social_room_messages(room_id,created_at DESC,id DESC);
CREATE TABLE social_intent_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), search_id uuid NOT NULL UNIQUE REFERENCES social_action_searches(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','completed','failed','cancelled')),
 attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_key text CHECK(lease_key ~ '^[A-Za-z0-9_-]{24}$'),lease_until timestamptz, finished_at timestamptz,
 failure_code text CHECK(failure_code IN('LEASE_EXHAUSTED','MATCHING_FAILED')),
 CHECK((status='processing')=(lease_key IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX social_intent_job_claim ON social_intent_jobs(available_at,id) WHERE status IN('pending','processing');
CREATE TABLE social_conversation_preferences (
 profile_id uuid PRIMARY KEY REFERENCES social_profiles(id), settings jsonb NOT NULL CHECK(jsonb_typeof(settings)='object'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION social_intent_validate_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.post_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM seeking_posts s JOIN social_profiles p ON p.id=s.profile_id WHERE s.id=NEW.post_id AND s.profile_id=NEW.profile_id AND p.deleted_at IS NULL)
 THEN RAISE EXCEPTION 'Invalid intent owner' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.profile_id<>OLD.profile_id OR (NEW.post_id IS DISTINCT FROM OLD.post_id AND NEW.post_id IS NOT NULL)) THEN RAISE EXCEPTION 'Immutable intent ownership' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_intent_search_owner BEFORE INSERT OR UPDATE ON social_action_searches FOR EACH ROW EXECUTE FUNCTION social_intent_validate_search();
CREATE FUNCTION social_intent_validate_lobby() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM social_action_searches s WHERE s.id=NEW.search_id AND s.profile_id=NEW.owner_profile_id AND NEW.capacity=s.existing_people+s.needed_people AND NEW.external_count=s.existing_people-1)
 THEN RAISE EXCEPTION 'Invalid lobby context' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.search_id,NEW.owner_profile_id) IS DISTINCT FROM (OLD.search_id,OLD.owner_profile_id) THEN RAISE EXCEPTION 'Immutable lobby context' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM social_lobby_members WHERE lobby_id=NEW.id AND status='active')+NEW.external_count>NEW.capacity THEN RAISE EXCEPTION 'Lobby capacity exceeded' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_intent_lobby_context BEFORE INSERT OR UPDATE ON social_lobbies FOR EACH ROW EXECUTE FUNCTION social_intent_validate_lobby();
CREATE FUNCTION social_intent_validate_offer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.target_post_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM social_action_searches s JOIN seeking_posts t ON t.id=NEW.target_post_id JOIN social_profiles p ON p.id=t.profile_id WHERE s.id=NEW.search_id AND t.profile_id=NEW.recipient_profile_id AND s.profile_id<>NEW.recipient_profile_id AND p.deleted_at IS NULL)
 THEN RAISE EXCEPTION 'Invalid offer context' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.search_id,NEW.recipient_profile_id,NEW.source_revision) IS DISTINCT FROM (OLD.search_id,OLD.recipient_profile_id,OLD.source_revision) OR (NEW.target_post_id IS DISTINCT FROM OLD.target_post_id AND NEW.target_post_id IS NOT NULL)) THEN RAISE EXCEPTION 'Immutable offer context' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_intent_offer_context BEFORE INSERT OR UPDATE ON social_candidate_offers FOR EACH ROW EXECUTE FUNCTION social_intent_validate_offer();
CREATE FUNCTION social_intent_validate_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lobby social_lobbies;
BEGIN
 SELECT * INTO lobby FROM social_lobbies WHERE id=NEW.lobby_id FOR UPDATE;
 IF TG_OP='UPDATE' AND (NEW.lobby_id,NEW.profile_id,NEW.public_key) IS DISTINCT FROM (OLD.lobby_id,OLD.profile_id,OLD.public_key) THEN RAISE EXCEPTION 'Immutable member context' USING ERRCODE='23514'; END IF;
 IF NEW.status='active' THEN
  IF NOT EXISTS(SELECT 1 FROM social_profiles WHERE id=NEW.profile_id AND deleted_at IS NULL AND moderation_status='active' AND can_connect) THEN RAISE EXCEPTION 'Unavailable member' USING ERRCODE='23514'; END IF;
  IF NEW.profile_id<>lobby.owner_profile_id AND NOT EXISTS(SELECT 1 FROM social_candidate_offers WHERE search_id=lobby.search_id AND recipient_profile_id=NEW.profile_id AND status='accepted') THEN RAISE EXCEPTION 'Member requires consent' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM social_lobby_members WHERE lobby_id=NEW.lobby_id AND profile_id<>NEW.profile_id AND status='active' AND ((SELECT count(*) FROM social_lobby_members WHERE lobby_id=NEW.lobby_id AND status='active' AND profile_id<>NEW.profile_id)+lobby.external_count+1>lobby.capacity)) THEN RAISE EXCEPTION 'Lobby capacity exceeded' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_intent_member_context BEFORE INSERT OR UPDATE ON social_lobby_members FOR EACH ROW EXECUTE FUNCTION social_intent_validate_member();
CREATE FUNCTION social_intent_validate_room() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.lobby_id<>OLD.lobby_id THEN RAISE EXCEPTION 'Immutable room context' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM social_lobbies l WHERE l.id=NEW.lobby_id AND (SELECT count(*) FROM social_lobby_members WHERE lobby_id=l.id AND status='active')+l.external_count=l.capacity AND l.status='ready') THEN RAISE EXCEPTION 'Room requires full consenting lobby' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_intent_room_context BEFORE INSERT OR UPDATE ON social_rooms FOR EACH ROW EXECUTE FUNCTION social_intent_validate_room();
CREATE FUNCTION social_intent_validate_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM social_rooms r JOIN social_lobby_members m ON m.lobby_id=r.lobby_id JOIN social_profiles p ON p.id=m.profile_id JOIN social_profile_bindings b ON b.profile_id=p.id WHERE r.id=NEW.room_id AND r.status IN('ready','active') AND m.profile_id=NEW.author_profile_id AND m.status='active' AND p.deleted_at IS NULL AND p.moderation_status='active' AND p.can_connect) THEN RAISE EXCEPTION 'Invalid message membership' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_intent_message_context BEFORE INSERT OR UPDATE ON social_room_messages FOR EACH ROW EXECUTE FUNCTION social_intent_validate_message();
ALTER TABLE social_action_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_lobby_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_candidate_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_intent_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_conversation_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_notifications ADD COLUMN offer_id uuid REFERENCES social_candidate_offers(id) ON DELETE CASCADE;
ALTER TABLE social_notifications ADD COLUMN room_id uuid REFERENCES social_rooms(id) ON DELETE CASCADE;
ALTER TABLE social_notifications DROP CONSTRAINT social_notifications_type_check;
ALTER TABLE social_notifications ADD CONSTRAINT social_notifications_type_check CHECK(type IN('INTEREST_RECEIVED','INTEREST_ACCEPTED','NEW_MESSAGE','PLAN_READY','MEETUP_REMINDER','CANDIDATE_FOUND','OFFER_RECEIVED','LOBBY_READY','ROOM_MESSAGE'));
ALTER TABLE social_notifications ADD CONSTRAINT social_notification_single_context CHECK((request_id IS NOT NULL)::int+(match_id IS NOT NULL)::int+(offer_id IS NOT NULL)::int+(room_id IS NOT NULL)::int<=1);
CREATE OR REPLACE FUNCTION social_validate_notification_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM connection_requests r WHERE r.id=NEW.request_id AND NEW.recipient_profile_id IN(r.sender_profile_id,r.recipient_profile_id) AND NEW.peer_profile_id=CASE WHEN NEW.recipient_profile_id=r.sender_profile_id THEN r.recipient_profile_id ELSE r.sender_profile_id END) THEN RAISE EXCEPTION 'Invalid notification context' USING ERRCODE='23514'; END IF;
 IF NEW.match_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id WHERE m.id=NEW.match_id AND NEW.recipient_profile_id IN(p.low_profile_id,p.high_profile_id) AND NEW.peer_profile_id=CASE WHEN NEW.recipient_profile_id=p.low_profile_id THEN p.high_profile_id ELSE p.low_profile_id END) THEN RAISE EXCEPTION 'Invalid notification context' USING ERRCODE='23514'; END IF;
 IF NEW.offer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM social_candidate_offers o JOIN social_action_searches s ON s.id=o.search_id WHERE o.id=NEW.offer_id AND o.recipient_profile_id=NEW.recipient_profile_id AND (NEW.peer_profile_id IS NULL OR NEW.peer_profile_id=s.profile_id)) THEN RAISE EXCEPTION 'Invalid notification context' USING ERRCODE='23514'; END IF;
 IF NEW.room_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM social_rooms r JOIN social_lobby_members m ON m.lobby_id=r.lobby_id WHERE r.id=NEW.room_id AND m.profile_id=NEW.recipient_profile_id AND m.status='active' AND (NEW.peer_profile_id IS NULL OR EXISTS(SELECT 1 FROM social_lobby_members peer WHERE peer.lobby_id=r.lobby_id AND peer.profile_id=NEW.peer_profile_id AND peer.status='active'))) THEN RAISE EXCEPTION 'Invalid notification context' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER TABLE social_reports ADD COLUMN room_id uuid REFERENCES social_rooms(id);
ALTER TABLE social_reports DROP CONSTRAINT social_reports_check;
ALTER TABLE social_reports ADD CONSTRAINT social_reports_one_context CHECK((request_id IS NOT NULL)::int+(match_id IS NOT NULL)::int+(room_id IS NOT NULL)::int=1);
CREATE UNIQUE INDEX social_report_room_once ON social_reports(reporter_profile_id,room_id,reason) WHERE room_id IS NOT NULL;
CREATE OR REPLACE FUNCTION social_validate_report_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pair_id uuid;
BEGIN
 IF (NEW.request_id IS NOT NULL)::int+(NEW.match_id IS NOT NULL)::int+(NEW.room_id IS NOT NULL)::int<>1 THEN RAISE EXCEPTION 'Invalid report context' USING ERRCODE='23514'; END IF;
 IF NEW.room_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM social_rooms r JOIN social_lobby_members own ON own.lobby_id=r.lobby_id JOIN social_lobby_members target ON target.lobby_id=r.lobby_id WHERE r.id=NEW.room_id AND own.profile_id=NEW.reporter_profile_id AND target.profile_id=NEW.target_profile_id) THEN RAISE EXCEPTION 'Invalid report membership' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.request_id IS NOT NULL THEN SELECT r.pair_id INTO pair_id FROM connection_requests r WHERE r.id=NEW.request_id;
  ELSE SELECT m.pair_id INTO pair_id FROM social_matches m WHERE m.id=NEW.match_id; END IF;
  IF NOT EXISTS(SELECT 1 FROM social_pairs p WHERE p.id=pair_id AND ((p.low_profile_id=NEW.reporter_profile_id AND p.high_profile_id=NEW.target_profile_id) OR (p.high_profile_id=NEW.reporter_profile_id AND p.low_profile_id=NEW.target_profile_id))) THEN RAISE EXCEPTION 'Invalid report membership' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.reporter_profile_id,NEW.target_profile_id,NEW.request_id,NEW.match_id,NEW.room_id,NEW.reason,NEW.text) IS DISTINCT FROM (OLD.reporter_profile_id,OLD.target_profile_id,OLD.request_id,OLD.match_id,OLD.room_id,OLD.reason,OLD.text) THEN RAISE EXCEPTION 'Report evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION moderation_room_evidence(reporter uuid,target uuid,room uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('profiles',jsonb_build_array(jsonb_build_object('role','reporter','label','Reporting participant'),jsonb_build_object('role','target','label','Reported participant')),
 'posts',COALESCE((SELECT jsonb_agg(jsonb_build_object('role','reporter','activityLabel',p.activity_label,'interactionMode',p.interaction_mode,'format',p.format)) FROM social_rooms r JOIN social_lobbies l ON l.id=r.lobby_id JOIN social_action_searches s ON s.id=l.search_id JOIN seeking_posts p ON p.id=s.post_id WHERE r.id=room),'[]'::jsonb),
 'messages',COALESCE((SELECT jsonb_agg(jsonb_build_object('role',CASE WHEN recent.author_profile_id=reporter THEN 'reporter' ELSE 'target' END,'text',recent.text,'createdAt',recent.created_at) ORDER BY recent.created_at,recent.id) FROM (SELECT id,author_profile_id,text,created_at FROM social_room_messages WHERE room_id=room AND author_profile_id IN(reporter,target) ORDER BY created_at DESC,id DESC LIMIT 20) recent),'[]'::jsonb))
$$;
CREATE OR REPLACE FUNCTION moderation_freeze_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.evidence=CASE WHEN NEW.room_id IS NOT NULL THEN moderation_room_evidence(NEW.reporter_profile_id,NEW.target_profile_id,NEW.room_id) ELSE moderation_report_evidence(NEW.reporter_profile_id,NEW.target_profile_id,NEW.request_id,NEW.match_id) END;
 ELSIF (NEW.public_key,NEW.evidence,NEW.created_at) IS DISTINCT FROM (OLD.public_key,OLD.evidence,OLD.created_at) THEN RAISE EXCEPTION 'Report evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

-- Fixed invalidation topics and content-free aggregate transitions.
ALTER TABLE social_events DROP CONSTRAINT social_events_topic_check;
ALTER TABLE social_events ADD CONSTRAINT social_events_topic_check CHECK(topic IN('connections','match','notifications','discovery','intents','rooms'));
ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_event_name_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_event_name_check CHECK(event_name IN('landing_view','intent_started','intent_created','invite_link_copied','invite_opened','participant_joined','result_viewed','vote_submitted','new_intent_from_invite','seeking_created','discovery_results_seen','interest_sent','interest_received','match_created','first_message_sent','plan_created','plan_confirmed','search_started','offer_delivered','offer_accepted','lobby_filled','room_opened','activity_completed'));

ALTER TABLE social_action_searches ADD CONSTRAINT social_search_live_post CHECK(post_id IS NOT NULL OR status IN('filled','closed','expired'));
ALTER TABLE social_candidate_offers ADD CONSTRAINT social_offer_live_post CHECK(target_post_id IS NOT NULL OR status<>'pending');

ALTER TABLE social_intent_jobs ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();

-- Recovery detaches guest bindings, but must not defeat later erasure of social-linked plan identity.
CREATE TABLE social_linked_plan_identities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_intent_id uuid NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
 profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 guest_id uuid REFERENCES guest_participant_sessions(id) ON DELETE SET NULL,
 is_creator boolean NOT NULL DEFAULT true,
 UNIQUE(plan_intent_id,profile_id,guest_id)
);
CREATE INDEX social_linked_plan_profile ON social_linked_plan_identities(profile_id,plan_intent_id);
ALTER TABLE social_linked_plan_identities ENABLE ROW LEVEL SECURITY;
INSERT INTO social_linked_plan_identities(plan_intent_id,profile_id,guest_id,is_creator)
 SELECT DISTINCT i.id,b.profile_id,b.guest_id,i.creator_guest_id=b.guest_id
 FROM intents i JOIN social_profile_bindings b ON i.creator_guest_id=b.guest_id
 OR EXISTS(SELECT 1 FROM participants p WHERE p.intent_id=i.id AND p.guest_id=b.guest_id)
 WHERE EXISTS(SELECT 1 FROM social_matches m JOIN social_pairs pair ON pair.id=m.pair_id WHERE m.plan_intent_id=i.id AND b.profile_id IN(pair.low_profile_id,pair.high_profile_id))
 OR EXISTS(SELECT 1 FROM social_rooms r JOIN social_lobby_members lm ON lm.lobby_id=r.lobby_id WHERE r.plan_intent_id=i.id AND lm.profile_id=b.profile_id)
 ON CONFLICT DO NOTHING;
