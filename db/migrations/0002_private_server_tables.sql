-- The server authenticates guests. Direct database/API clients have no policies.
-- Owners/BYPASSRLS roles are trusted server connections; do not expose their URI.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_participant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE veya_schema_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE users, guest_participant_sessions, intents, participants,
  availability_windows, preferences, plan_suggestions, votes, analytics_events,
  veya_schema_migrations FROM PUBLIC;
REVOKE ALL ON SEQUENCE analytics_events_id_seq FROM PUBLIC;
