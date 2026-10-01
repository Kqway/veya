CREATE TABLE seeking_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 public_key text NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$'),
 profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
 active_slot smallint NOT NULL CHECK(active_slot BETWEEN 1 AND 3),
 raw_text text NOT NULL CHECK(length(raw_text) BETWEEN 1 AND 500),
 activity_key text NOT NULL CHECK(length(activity_key) BETWEEN 1 AND 40 AND activity_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 activity_label text NOT NULL CHECK(length(activity_label) BETWEEN 1 AND 80),
 interaction_mode text NOT NULL CHECK(interaction_mode IN('in_person','online','either')),
 format text NOT NULL CHECK(format IN('one_to_one','group','either')),
 city text CHECK(length(city) BETWEEN 1 AND 60), area text CHECK(length(area) BETWEEN 1 AND 60),
 skill text NOT NULL CHECK(skill IN('beginner','casual','intermediate','advanced','expert','any')),
 languages text[] NOT NULL CHECK(cardinality(languages) BETWEEN 1 AND 5),
 desired_age_bands text[] NOT NULL DEFAULT '{}' CHECK(cardinality(desired_age_bands)<=5 AND desired_age_bands <@ ARRAY['18-20','21-24','25-29','30-39','40+']::text[]),
 group_size smallint CHECK(group_size BETWEEN 2 AND 12),
 privacy_mode text NOT NULL CHECK(privacy_mode IN('OPEN','PRIVATE','INCOGNITO')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','closed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days'),
 CHECK(interaction_mode='online' OR city IS NOT NULL),
 CHECK(format<>'one_to_one' OR group_size IS NULL)
);
CREATE UNIQUE INDEX seeking_active_slots ON seeking_posts(profile_id,active_slot) WHERE status='active';
CREATE INDEX seeking_discovery_pool ON seeking_posts(activity_key,expires_at,id) WHERE status='active';
CREATE INDEX seeking_owner ON seeking_posts(profile_id,created_at DESC);
CREATE TABLE seeking_availability (
 post_id uuid NOT NULL REFERENCES seeking_posts(id) ON DELETE CASCADE,
 slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 14),
 start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,
 PRIMARY KEY(post_id,slot),CHECK(end_at>start_at AND end_at<=start_at+interval '24 hours')
);
CREATE TABLE seeking_tags (
 post_id uuid NOT NULL REFERENCES seeking_posts(id) ON DELETE CASCADE,
 slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 8),value text NOT NULL CHECK(length(value) BETWEEN 1 AND 40),
 PRIMARY KEY(post_id,slot),UNIQUE(post_id,value)
);
ALTER TABLE seeking_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE seeking_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE seeking_tags ENABLE ROW LEVEL SECURITY;
