-- Actual Intent Network discovery is a read capability; it never fabricates contact.
ALTER TABLE agent_goals DROP CONSTRAINT agent_goals_next_tool_check;
ALTER TABLE agent_goals ADD CONSTRAINT agent_goals_next_tool_check
 CHECK(next_tool IN('search_people','search','requirements','proposal','client_response','create_artifact','verify_artifact','deliver','delivery_response','revise_artifact','invoice','payment'));

ALTER TABLE agent_artifacts ADD COLUMN kind text NOT NULL DEFAULT 'document'
 CHECK(kind IN('document','code','research','proposal','invoice','deliverable','archive','link'));
ALTER TABLE agent_artifacts ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb
 CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=4096);
