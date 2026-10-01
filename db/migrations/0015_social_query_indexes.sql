-- Bounded candidate pool can follow activity + deterministic recent order without
-- sorting every live activity post. Expiry remains a current-time filter, never
-- a time-dependent partial-index predicate.
CREATE INDEX seeking_active_activity_recent ON seeking_posts(activity_key,created_at DESC,id) INCLUDE(profile_id,expires_at) WHERE status='active';

-- Separate directional predicates use exact profile pairs instead of OR scans.
CREATE INDEX connection_live_direction ON connection_requests(sender_profile_id,recipient_profile_id) WHERE status<>'expired';
CREATE INDEX connection_live_reverse_direction ON connection_requests(recipient_profile_id,sender_profile_id) WHERE status<>'expired';

-- Pending sender-budget refresh is bounded at ten and can avoid historical rows.
CREATE INDEX connection_pending_sender_refresh ON connection_requests(sender_profile_id,id) INCLUDE(source_post_id,target_post_id) WHERE status='pending';

-- Existing seeking child primary keys, block/pass pair keys, daily handle budget,
-- message conversation cursor, and notification unread indexes already cover
-- their bounded access paths. No duplicate indexes are added for those tables.
