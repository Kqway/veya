CREATE TABLE social_candidate_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 post_id uuid NOT NULL UNIQUE REFERENCES seeking_posts(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','completed','failed')),
 attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_key text CHECK(lease_key ~ '^[A-Za-z0-9_-]{24}$'),
 lease_until timestamptz,
 failure_code text CHECK(failure_code IN('MATCHING_FAILED','LEASE_EXHAUSTED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 CHECK((status='processing')=(lease_key IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((status IN('completed','failed'))=(finished_at IS NOT NULL))
);
CREATE INDEX social_candidate_jobs_claim ON social_candidate_jobs(available_at,id) WHERE status IN('pending','processing');
CREATE INDEX social_candidate_jobs_finished ON social_candidate_jobs(finished_at,id) WHERE status IN('completed','failed');
ALTER TABLE social_candidate_jobs ENABLE ROW LEVEL SECURITY;
