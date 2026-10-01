ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_event_name_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_event_name_check CHECK(event_name IN ('landing_view','intent_started','intent_created','invite_link_copied','invite_opened','participant_joined','result_viewed','vote_submitted','new_intent_from_invite','seeking_created','discovery_results_seen','interest_sent','interest_received','match_created','first_message_sent','plan_created','plan_confirmed'));
ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_surface_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_surface_check CHECK(surface IN ('landing','create','invite','result','social'));
ALTER TABLE seeking_posts ADD COLUMN discovery_found_at timestamptz;
