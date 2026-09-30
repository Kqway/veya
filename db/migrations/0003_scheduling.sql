ALTER TABLE plan_suggestions ADD COLUMN public_key text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-','') CHECK(public_key ~ '^[a-f0-9]{32}$');
CREATE UNIQUE INDEX suggestions_public_key ON plan_suggestions(intent_id,public_key);
ALTER TABLE intents ADD COLUMN scheduling_revision bigint NOT NULL DEFAULT 0 CHECK(scheduling_revision>=0);
ALTER TABLE intents ADD COLUMN suggestions_fingerprint text CHECK(suggestions_fingerprint IS NULL OR suggestions_fingerprint ~ '^[a-f0-9]{64}$');
ALTER TABLE intents ADD COLUMN selected_suggestion_id uuid;
ALTER TABLE intents ADD CONSTRAINT selected_suggestion_same_intent FOREIGN KEY(id,selected_suggestion_id) REFERENCES plan_suggestions(intent_id,id) ON DELETE SET NULL(selected_suggestion_id);
