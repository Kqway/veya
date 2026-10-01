CREATE TABLE messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 public_key text NOT NULL UNIQUE CHECK (public_key ~ '^[A-Za-z0-9_-]{24}$'),
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 sender_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 text text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000 AND length(btrim(text)) > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX messages_conversation_cursor ON messages(conversation_id,created_at DESC,id DESC);
CREATE TABLE match_disclosures (
 match_id uuid NOT NULL REFERENCES social_matches(id) ON DELETE CASCADE,
 sender_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('first_name','contact_handle')),
 value text NOT NULL CHECK (length(btrim(value)) > 0 AND length(value) <= CASE WHEN kind='first_name' THEN 60 ELSE 120 END),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(match_id,sender_profile_id,kind)
);
CREATE FUNCTION social_validate_message_sender() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM conversations c JOIN social_matches m ON m.id=c.match_id
  JOIN social_pairs p ON p.id=m.pair_id
  WHERE c.id=NEW.conversation_id AND NEW.sender_profile_id IN (p.low_profile_id,p.high_profile_id)
 ) THEN RAISE EXCEPTION 'Invalid conversation membership' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER message_membership BEFORE INSERT OR UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION social_validate_message_sender();
CREATE FUNCTION social_validate_disclosure_sender() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id
  WHERE m.id=NEW.match_id AND NEW.sender_profile_id IN (p.low_profile_id,p.high_profile_id)
 ) THEN RAISE EXCEPTION 'Invalid match membership' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.match_id,NEW.sender_profile_id,NEW.kind,NEW.value) IS DISTINCT FROM (OLD.match_id,OLD.sender_profile_id,OLD.kind,OLD.value)
 THEN RAISE EXCEPTION 'Disclosure is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER disclosure_membership BEFORE INSERT OR UPDATE ON match_disclosures FOR EACH ROW EXECUTE FUNCTION social_validate_disclosure_sender();
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_disclosures ENABLE ROW LEVEL SECURITY;
