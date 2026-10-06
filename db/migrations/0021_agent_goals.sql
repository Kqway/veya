-- Durable demo execution; previous migration history is immutable.
CREATE TABLE agent_goals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_key text UNIQUE NOT NULL CHECK(public_key ~ '^[A-Za-z0-9_-]{24}$'),
 profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,title text NOT NULL CHECK(length(title) BETWEEN 1 AND 140),raw_text text NOT NULL CHECK(length(raw_text) BETWEEN 3 AND 2000),
 environment text NOT NULL DEFAULT 'demo' CHECK(environment='demo'),status text NOT NULL CHECK(status IN('DRAFT','PLANNING','ACTIVE','WAITING_EXTERNAL','WAITING_APPROVAL','PAUSED','COMPLETED','FAILED','CANCELLED')),
 spec jsonb NOT NULL CHECK(jsonb_typeof(spec)='object' AND octet_length(spec::text)<12000),currency text NOT NULL CHECK(currency IN('RUB','USD','EUR')),target_amount_minor bigint NOT NULL CHECK(target_amount_minor BETWEEN 0 AND 100000000),
 next_tool text NOT NULL DEFAULT 'search' CHECK(next_tool IN('search','requirements','proposal','client_response','create_artifact','verify_artifact','deliver','delivery_response','revise_artifact','invoice','payment')),
 cycle integer NOT NULL DEFAULT 0 CHECK(cycle BETWEEN 0 AND 10000),revision integer NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 3),failure_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(id,profile_id)
);
CREATE INDEX agent_goals_owner ON agent_goals(profile_id,created_at DESC);
CREATE INDEX agent_goals_retention ON agent_goals(updated_at) WHERE status IN('COMPLETED','FAILED','CANCELLED');
CREATE TABLE agent_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),goal_id uuid UNIQUE NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','sleeping','done','failed')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_key text,lease_until timestamptz,failure_code text,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((status='processing')=(lease_key IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX agent_jobs_claim ON agent_jobs(status,available_at,lease_until);
CREATE TABLE agent_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_key text UNIQUE NOT NULL,goal_id uuid NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,
 action_key text NOT NULL,tool text NOT NULL,input jsonb NOT NULL CHECK(octet_length(input::text)<4096),input_hash text NOT NULL,revision integer NOT NULL CHECK(revision BETWEEN 0 AND 3),
 status text NOT NULL CHECK(status IN('pending','completed')),evidence jsonb CHECK(octet_length(evidence::text)<4096),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,UNIQUE(goal_id,action_key),UNIQUE(id,goal_id)
);
CREATE TABLE agent_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_key text UNIQUE NOT NULL,goal_id uuid NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,
 step_id uuid NOT NULL,input_hash text NOT NULL,revision integer NOT NULL,status text NOT NULL CHECK(status IN('pending','approved','declined','expired')),amount_minor bigint NOT NULL CHECK(amount_minor>0),currency text NOT NULL CHECK(currency IN('RUB','USD','EUR')),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',created_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(step_id,goal_id) REFERENCES agent_steps(id,goal_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX agent_approval_open ON agent_approvals(step_id) WHERE status IN('pending','approved');
CREATE TABLE agent_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,public_key text UNIQUE NOT NULL,goal_id uuid NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,type text NOT NULL,description text NOT NULL CHECK(length(description)<=500),evidence_ref text,dedupe_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(goal_id,dedupe_key)
);
CREATE INDEX agent_events_goal ON agent_events(goal_id,id DESC);
CREATE TABLE agent_opportunities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_key text UNIQUE NOT NULL,goal_id uuid NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,cycle integer NOT NULL,
 title text NOT NULL,requirements jsonb NOT NULL CHECK(octet_length(requirements::text)<4096),amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 100000000),currency text NOT NULL CHECK(currency IN('RUB','USD','EUR')),UNIQUE(goal_id,cycle),UNIQUE(id,goal_id)
);
CREATE TABLE agent_deals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_key text UNIQUE NOT NULL,goal_id uuid NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,opportunity_id uuid NOT NULL,
 cycle integer NOT NULL,title text NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),currency text NOT NULL CHECK(currency IN('RUB','USD','EUR')),
 status text NOT NULL CHECK(status IN('proposed','accepted','working','delivered','revision_requested','delivery_accepted','invoiced','paid')),revision integer NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 3),invoice_key text UNIQUE,
 UNIQUE(goal_id,cycle),UNIQUE(id,goal_id),FOREIGN KEY(opportunity_id,goal_id) REFERENCES agent_opportunities(id,goal_id) ON DELETE CASCADE
);
CREATE TABLE agent_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_key text UNIQUE NOT NULL,goal_id uuid NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,deal_id uuid NOT NULL UNIQUE,idempotency_key text UNIQUE NOT NULL,status text NOT NULL CHECK(status IN('sent','accepted')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(deal_id,goal_id) REFERENCES agent_deals(id,goal_id) ON DELETE CASCADE
);
CREATE TABLE agent_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_key text UNIQUE NOT NULL,goal_id uuid NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,deal_id uuid NOT NULL,kind text NOT NULL,description text NOT NULL CHECK(length(description)<=500),idempotency_key text UNIQUE NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(deal_id,goal_id) REFERENCES agent_deals(id,goal_id) ON DELETE CASCADE
);
CREATE TABLE agent_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_key text UNIQUE NOT NULL,goal_id uuid NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,step_id uuid NOT NULL,deal_id uuid NOT NULL,title text NOT NULL,media_type text NOT NULL DEFAULT 'text/markdown',storage_ref text NOT NULL,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 1000000),verified boolean NOT NULL DEFAULT false,revision integer NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(deal_id,revision),FOREIGN KEY(step_id,goal_id) REFERENCES agent_steps(id,goal_id) ON DELETE CASCADE,FOREIGN KEY(deal_id,goal_id) REFERENCES agent_deals(id,goal_id) ON DELETE CASCADE
);
CREATE TABLE agent_connector_accounts(profile_id uuid PRIMARY KEY REFERENCES social_profiles(id) ON DELETE CASCADE,enabled boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE agent_autonomy_preferences(profile_id uuid PRIMARY KEY REFERENCES social_profiles(id) ON DELETE CASCADE,communication_limit integer NOT NULL DEFAULT 5 CHECK(communication_limit BETWEEN 0 AND 10));
CREATE TABLE agent_communication_usage(profile_id uuid NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,day date NOT NULL,used integer NOT NULL CHECK(used BETWEEN 0 AND 10),PRIMARY KEY(profile_id,day));
CREATE TABLE agent_payment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),provider_event_id text UNIQUE NOT NULL,goal_id uuid NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,deal_id uuid UNIQUE NOT NULL,invoice_key text NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),currency text NOT NULL CHECK(currency IN('RUB','USD','EUR')),provider text NOT NULL CHECK(provider='mock'),confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(deal_id,goal_id) REFERENCES agent_deals(id,goal_id) ON DELETE CASCADE
);
CREATE TABLE agent_artifact_erasure(goal_id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['agent_goals','agent_jobs','agent_steps','agent_approvals','agent_events','agent_opportunities','agent_deals','agent_proposals','agent_conversations','agent_artifacts','agent_connector_accounts','agent_autonomy_preferences','agent_communication_usage','agent_payment_events','agent_artifact_erasure'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); END LOOP; END $$;
ALTER TABLE social_events DROP CONSTRAINT social_events_topic_check;
ALTER TABLE social_events ADD CONSTRAINT social_events_topic_check CHECK(topic IN('connections','match','notifications','discovery','intents','rooms','goals'));
ALTER TABLE social_notifications DROP CONSTRAINT social_notifications_type_check;
ALTER TABLE social_notifications ADD CONSTRAINT social_notifications_type_check CHECK(type IN('INTEREST_RECEIVED','INTEREST_ACCEPTED','NEW_MESSAGE','PLAN_READY','MEETUP_REMINDER','CANDIDATE_FOUND','OFFER_RECEIVED','LOBBY_READY','ROOM_MESSAGE','GOAL_APPROVAL','GOAL_RESULT','GOAL_BLOCKER'));
