CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text CHECK (email IS NULL OR length(email) BETWEEN 3 AND 320),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE guest_participant_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX guest_sessions_expiration ON guest_participant_sessions (expires_at);

CREATE TABLE intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_slug text NOT NULL UNIQUE CHECK (public_slug ~ '^[A-Za-z0-9_-]{24}$'),
  creator_user_id uuid REFERENCES users(id),
  creator_guest_id uuid REFERENCES guest_participant_sessions(id),
  creator_display_name text NOT NULL CHECK (length(btrim(creator_display_name)) BETWEEN 1 AND 60),
  raw_text text NOT NULL CHECK (length(btrim(raw_text)) BETWEEN 1 AND 500),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  structured_intent jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(structured_intent) = 'object' AND octet_length(structured_intent::text) <= 8192),
  status text NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting','ready','decided','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  seed_key text UNIQUE,
  CHECK (num_nonnulls(creator_user_id, creator_guest_id) = 1),
  CHECK (expires_at > created_at)
);
CREATE INDEX intents_creator_guest ON intents (creator_guest_id);
CREATE INDEX intents_expiration ON intents (expires_at) WHERE status <> 'expired';

CREATE TABLE participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  guest_id uuid REFERENCES guest_participant_sessions(id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 60),
  budget_min integer CHECK (budget_min BETWEEN 0 AND 100000000),
  budget_max integer CHECK (budget_max BETWEEN 0 AND 100000000),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_id, id),
  UNIQUE (intent_id, guest_id),
  UNIQUE (intent_id, user_id),
  CHECK (num_nonnulls(user_id, guest_id) = 1),
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max),
  CHECK ((budget_min IS NULL AND budget_max IS NULL AND currency IS NULL) OR ((budget_min IS NOT NULL OR budget_max IS NOT NULL) AND currency IS NOT NULL))
);
CREATE INDEX participants_guest ON participants (guest_id);

CREATE TABLE availability_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  CHECK (end_at > start_at AND end_at - start_at <= interval '24 hours'),
  UNIQUE (participant_id, start_at, end_at)
);
CREATE INDEX availability_participant ON availability_windows (participant_id, start_at);

CREATE TABLE preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('activity','dietary','location')),
  value text NOT NULL CHECK (length(btrim(value)) BETWEEN 1 AND 80),
  UNIQUE (participant_id, category, value)
);

CREATE TABLE plan_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL CHECK (end_at > start_at),
  score integer NOT NULL CHECK (score BETWEEN 0 AND 1000),
  available_count integer NOT NULL CHECK (available_count >= 0),
  explanation text CHECK (length(explanation) <= 1000),
  details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_id, id)
);

CREATE TABLE votes (
  intent_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  suggestion_id uuid NOT NULL,
  value smallint NOT NULL CHECK (value IN (-1,0,1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, suggestion_id),
  FOREIGN KEY (intent_id, participant_id) REFERENCES participants(intent_id, id) ON DELETE CASCADE,
  FOREIGN KEY (intent_id, suggestion_id) REFERENCES plan_suggestions(intent_id, id) ON DELETE CASCADE
);
CREATE INDEX votes_suggestion ON votes (suggestion_id);

CREATE TABLE analytics_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_name text NOT NULL CHECK (event_name IN ('landing_view','intent_started','intent_created','invite_link_copied','invite_opened','participant_joined','result_viewed','vote_submitted','new_intent_from_invite')),
  surface text NOT NULL CHECK (surface IN ('landing','create','invite','result')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_event_time ON analytics_events (event_name, created_at);
