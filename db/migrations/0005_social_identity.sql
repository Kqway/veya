-- Social identity is server-owned and independent of bearer coordination invites.
CREATE FUNCTION social_valid_languages(value text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT value IS NOT NULL
    AND cardinality(value) <= 5
    AND (cardinality(value) = 0 OR array_ndims(value) = 1)
    AND NOT EXISTS (SELECT 1 FROM unnest(value) language WHERE language IS NULL OR language !~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$' OR length(language) > 20)
    AND cardinality(value) = (SELECT count(DISTINCT language) FROM unnest(value) language)
$$;

CREATE TABLE social_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias text NOT NULL CHECK (length(alias) BETWEEN 1 AND 60 AND alias = btrim(alias)),
  privacy_mode text NOT NULL CHECK (privacy_mode IN ('OPEN', 'PRIVATE', 'INCOGNITO')),
  avatar_seed text NOT NULL CHECK (avatar_seed ~ '^[a-f0-9]{32}$'),
  adult_confirmed boolean NOT NULL CHECK (adult_confirmed = true),
  age_band text CHECK (age_band IN ('18-20', '21-24', '25-29', '30-39', '40+')),
  languages text[] NOT NULL DEFAULT '{}' CHECK (social_valid_languages(languages)),
  recovery_key_hash text UNIQUE CHECK (recovery_key_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE social_profile_bindings (
  guest_id uuid PRIMARY KEY REFERENCES guest_participant_sessions(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX social_profile_bindings_profile_id_idx ON social_profile_bindings(profile_id);
ALTER TABLE social_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_profile_bindings ENABLE ROW LEVEL SECURITY;
-- No client policies: the trusted server database role is the sole access path.
