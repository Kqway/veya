# Russian interface and Intavro brand review

This pass localizes generated website copy, accessibility labels, forms/select labels,
errors, privacy explanations, recovery/delete UX, coordination and scheduling, inbox/
push, moderator screens, metadata and date formatting. New profile/post language
inputs default to `ru`; existing saved language choices remain unchanged. User text,
aliases and message/disclosure/evidence contents are preserved. Canonical keys,
privacy/status enums and API identifiers are unchanged. Optional AI generates Russian
human labels and suggestions from the current user's own input only.

The public name is Intavro; the technical repository is still `Kqway/veya`. GitHub
repository-name search found no Intavro repository at verification time. Public search
was unavailable in this environment; domain and trademark availability are unverified.
This is an invented brand candidate, not a claim of universal legal uniqueness.

## Independent read-only findings and corrections

- **Important: localized engine explanations invalidated legacy fingerprints.** The
  candidate fingerprint included these explanations; regeneration could cascade-delete
  existing votes. A native PostgreSQL regression reproduced the changed revision after
  installing a legacy English fingerprint. The deterministic engine remains byte-for-
  byte unchanged; Russian title/explanation rendering belongs to a separate presentation
  function invoked by the explicit results projection. Legacy keys, fingerprints,
  revisions and votes remain stable. Expired plans also receive Russian presentation.
- **Legacy generated English on frozen results.** Fixed by the same projection layer
  without mutation of historical proposals or user data.
- **Browser transport errors displayed in English.** Moderator and social/push UI use
  a Russian fallback for English native error messages. DOM tests cover moderator
  transport/parser failures and service-worker failure; localized validation/API errors
  remain useful. Browser details are not exposed.
- **Em dash triggered generic share-image copy.** Local licensed DejaVu regular/bold
  fonts cover Cyrillic and supported punctuation. Regression renders distinct Russian
  names containing a long dash and forbids external font requests. Standalone Docker
  smoke requests the actual no-store PNG, verifying font packaging and rendering.

No database migration is added. Applied migrations and server-owned identity/privacy
boundaries are preserved. Internal `Deleted participant` profile tombstone remains as
required by migration 0018; public erased pair/creator labels are Russian. Incognito
pair aliases still use independent random entropy, with a localized prefix for new
pairs only. Historical aliases are never rewritten or correlated.

Verification evidence and counts are recorded in CODEX_PROGRESS.md. Hosted HTTPS,
real push credentials and real iPhone/Android behavior remain deployment/device checks.
