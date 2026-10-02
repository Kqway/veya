-- Retain only an inaccessible identity tombstone for closed history and immutable
-- moderation evidence. Never cascade a self-service deletion through report rows.
ALTER TABLE social_profiles ADD COLUMN deleted_at timestamptz;
ALTER TABLE social_profiles ADD CONSTRAINT social_deleted_profile_minimized CHECK (
 deleted_at IS NULL OR (
  alias='Deleted participant' AND privacy_mode='INCOGNITO' AND age_band IS NULL
  AND cardinality(languages)=0 AND recovery_key_hash IS NULL
  AND moderation_status='suspended' AND NOT can_seek AND NOT can_connect
 )
);
CREATE FUNCTION social_deleted_profile_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
 THEN RAISE EXCEPTION 'Deleted profile cannot be restored' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_profile_deletion_irreversible BEFORE UPDATE ON social_profiles
 FOR EACH ROW EXECUTE FUNCTION social_deleted_profile_immutable();

CREATE FUNCTION social_binding_not_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM social_profiles WHERE id=NEW.profile_id AND deleted_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Profile is unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_binding_active_identity BEFORE INSERT OR UPDATE ON social_profile_bindings
 FOR EACH ROW EXECUTE FUNCTION social_binding_not_deleted();

CREATE INDEX social_deleted_profiles ON social_profiles(deleted_at,id) WHERE deleted_at IS NOT NULL;
