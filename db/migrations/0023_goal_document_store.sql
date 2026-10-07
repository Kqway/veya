-- Serverless demo documents only: large files require a separate object store.
CREATE TABLE agent_document_contents (
 goal_id uuid NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,
 checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
 content text NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 16384),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(goal_id,checksum)
);
ALTER TABLE agent_document_contents ENABLE ROW LEVEL SECURITY;
