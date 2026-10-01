-- A coordination intent belongs to at most one social match; no alternate scheduler.
CREATE UNIQUE INDEX social_match_plan_unique ON social_matches(plan_intent_id) WHERE plan_intent_id IS NOT NULL;
CREATE INDEX social_match_membership ON social_matches(pair_id,created_at DESC);
