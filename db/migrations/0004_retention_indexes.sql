-- Bounded maintenance selects oldest candidates without scanning retained data.
CREATE INDEX intents_retention ON intents (expires_at, id);
CREATE INDEX guest_sessions_retention ON guest_participant_sessions ((COALESCE(revoked_at, expires_at)), id);
CREATE INDEX analytics_retention ON analytics_events (created_at, id);
