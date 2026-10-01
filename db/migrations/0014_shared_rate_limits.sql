CREATE TABLE rate_limit_buckets (
 action text NOT NULL CHECK(action IN('read','write','session','create','join','ai','analytics','preview','image','socialRead','socialWrite','discovery','seekingCreate','connection','message','report','recovery','profileCreate','push','realtime','moderation')),
 bucket_key text NOT NULL CHECK(bucket_key IN('global','global-day') OR bucket_key ~ '^[a-f0-9]{64}$'),
 used integer NOT NULL CHECK(used BETWEEN 0 AND 1000000),
 reset_at timestamptz NOT NULL,
 PRIMARY KEY(action,bucket_key)
);
CREATE INDEX rate_limit_expiry ON rate_limit_buckets(reset_at);
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;
