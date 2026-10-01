CREATE TABLE social_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reporter_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 target_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 request_id uuid REFERENCES connection_requests(id) ON DELETE CASCADE,
 match_id uuid REFERENCES social_matches(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK(reason IN('spam','harassment','unsafe_meeting','impersonation','other')),
 text text CHECK(length(text)<=1000),
 status text NOT NULL DEFAULT 'received' CHECK(status IN('received','reviewed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((request_id IS NOT NULL)::int+(match_id IS NOT NULL)::int=1),
 CHECK(reporter_profile_id<>target_profile_id)
);
CREATE UNIQUE INDEX social_report_request_once ON social_reports(reporter_profile_id,request_id,reason) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX social_report_match_once ON social_reports(reporter_profile_id,match_id,reason) WHERE match_id IS NOT NULL;
CREATE INDEX social_reports_retention ON social_reports(created_at,id);
CREATE INDEX social_reports_status ON social_reports(status,created_at,id);
CREATE FUNCTION social_validate_report_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pair_id uuid;
BEGIN
 IF (NEW.request_id IS NOT NULL)::int+(NEW.match_id IS NOT NULL)::int<>1 THEN RAISE EXCEPTION 'Invalid report context' USING ERRCODE='23514'; END IF;
 IF NEW.request_id IS NOT NULL THEN SELECT r.pair_id INTO pair_id FROM connection_requests r WHERE r.id=NEW.request_id;
 ELSE SELECT m.pair_id INTO pair_id FROM social_matches m WHERE m.id=NEW.match_id; END IF;
 IF NOT EXISTS(SELECT 1 FROM social_pairs p WHERE p.id=pair_id AND
  ((p.low_profile_id=NEW.reporter_profile_id AND p.high_profile_id=NEW.target_profile_id)
   OR (p.high_profile_id=NEW.reporter_profile_id AND p.low_profile_id=NEW.target_profile_id)))
 THEN RAISE EXCEPTION 'Invalid report membership' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.reporter_profile_id,NEW.target_profile_id,NEW.request_id,NEW.match_id,NEW.reason,NEW.text)
   IS DISTINCT FROM (OLD.reporter_profile_id,OLD.target_profile_id,OLD.request_id,OLD.match_id,OLD.reason,OLD.text)
 THEN RAISE EXCEPTION 'Report evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_report_membership BEFORE INSERT OR UPDATE ON social_reports FOR EACH ROW EXECUTE FUNCTION social_validate_report_membership();
ALTER TABLE social_reports ENABLE ROW LEVEL SECURITY;
-- Trusted server access only. Ordinary cleanup retains reports for365 days;
-- deliberate profile/context deletion cascades and must follow an explicit policy.
CREATE INDEX social_pairs_retention ON social_pairs(created_at,id);
CREATE INDEX seeking_posts_retention ON seeking_posts(expires_at,id);
CREATE INDEX discovery_handles_retention ON discovery_handles(created_at,public_handle);
CREATE INDEX discovery_passes_retention ON discovery_passes(created_at,viewer_profile_id,target_profile_id);
