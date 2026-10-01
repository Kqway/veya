CREATE TABLE social_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 public_key text NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$'),
 recipient_profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 topic text NOT NULL CHECK(topic IN('connections','match','notifications','discovery')),
 match_key text CHECK(match_key ~ '^[A-Za-z0-9_-]{24}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX social_events_recipient_cursor ON social_events(recipient_profile_id,id);
CREATE INDEX social_events_retention ON social_events(created_at);
ALTER TABLE social_events ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION social_notify_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_notify('veya_social_events',NEW.recipient_profile_id::text);
 RETURN NEW;
END $$;
CREATE TRIGGER social_event_committed AFTER INSERT ON social_events FOR EACH ROW EXECUTE FUNCTION social_notify_event();
