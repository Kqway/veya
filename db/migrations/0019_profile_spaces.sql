-- Server-owned bounded customization. Identity/recovery records are unchanged.
CREATE FUNCTION social_space_string_array(value jsonb, max_items integer, max_length integer,
 allowed text[] DEFAULT NULL, pattern text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; scalar text; seen text[] := '{}';
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value)>max_items THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
  IF jsonb_typeof(item)<>'string' THEN RETURN false; END IF;
  scalar := item #>> '{}';
  IF length(btrim(scalar))<1 OR length(scalar)>max_length OR scalar=ANY(seen)
   OR (allowed IS NOT NULL AND NOT scalar=ANY(allowed)) OR (pattern IS NOT NULL AND scalar !~ pattern)
  THEN RETURN false; END IF;
  seen := array_append(seen,scalar);
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION social_valid_profile_space(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR octet_length(value::text)>16384
  OR (SELECT count(*) FROM jsonb_object_keys(value))<>12
  OR NOT value ?& ARRAY['world','accent','avatar','status','tagline','interests','goals','selectedActivities','intentPostKey','enabledBlocks','blockOrder','visibility']
 THEN RETURN false; END IF;
 IF jsonb_typeof(value->'world')<>'string' OR NOT (value->>'world'=ANY(ARRAY['minimal','midnight','glass','cozy','cyber','manga','y2k','monochrome']))
  OR jsonb_typeof(value->'accent')<>'string' OR NOT (value->>'accent'=ANY(ARRAY['coral','mint','violet','amber','blue']))
  OR jsonb_typeof(value->'avatar')<>'string' OR NOT (value->>'avatar'=ANY(ARRAY['orbit','arch','spark','grid']))
  OR jsonb_typeof(value->'status')<>'string' OR length(value->>'status')>60
  OR jsonb_typeof(value->'tagline')<>'string' OR length(value->>'tagline')>120
  OR NOT social_space_string_array(value->'interests',8,30)
  OR NOT social_space_string_array(value->'goals',3,80)
  OR NOT social_space_string_array(value->'selectedActivities',6,64,NULL,'^[a-z0-9]+([_-][a-z0-9]+)*$')
  OR NOT social_space_string_array(value->'enabledBlocks',4,10,ARRAY['intent','activities','interests','goals'])
  OR NOT social_space_string_array(value->'blockOrder',4,10,ARRAY['intent','activities','interests','goals'])
  OR jsonb_array_length(value->'blockOrder')<>4
 THEN RETURN false; END IF;
 IF value->'intentPostKey'<>'null'::jsonb AND (jsonb_typeof(value->'intentPostKey')<>'string' OR value->>'intentPostKey' !~ '^[A-Za-z0-9_-]{24}$') THEN RETURN false; END IF;
 IF jsonb_typeof(value->'visibility')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(value->'visibility'))<>6
  OR NOT (value->'visibility' ?& ARRAY['status','tagline','intent','activities','interests','goals']) THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['status','tagline','intent','activities','interests','goals'] LOOP
  IF jsonb_typeof(value->'visibility'->field)<>'string' OR NOT (value->'visibility'->>field=ANY(ARRAY['self','connection','everyone'])) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE TABLE social_profile_spaces (
 profile_id uuid PRIMARY KEY REFERENCES social_profiles(id) ON DELETE CASCADE,
 customization jsonb NOT NULL CHECK(social_valid_profile_space(customization)),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE social_profile_spaces ENABLE ROW LEVEL SECURITY;
-- No browser/client policies: all authorization stays in the trusted server.
CREATE FUNCTION social_space_not_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE erased timestamptz;
BEGIN
 SELECT deleted_at INTO erased FROM social_profiles WHERE id=NEW.profile_id FOR SHARE;
 IF NOT FOUND OR erased IS NOT NULL THEN RAISE EXCEPTION 'Profile is unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_profile_space_active BEFORE INSERT OR UPDATE ON social_profile_spaces
 FOR EACH ROW EXECUTE FUNCTION social_space_not_deleted();
