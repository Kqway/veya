# Profile Worlds and minimal intent review

Review applies to the local changes from starting HEAD
`ae68914ede1923f6d93cf888403fc397e9b42cf4`, including additive 0019/0020 and preserved
social/coordination behavior. No production migration/deployment, new remote CI,
paid provider call or real-user data access is claimed. See CODEX_PROGRESS.md for
current gates. This is an independent bounded read-only implementation review with
reproducible native regressions, not a complete external security audit.

## Reviewed boundaries

Server-owned identity and sorted lock/post-wait authorization; Profile Worlds
self/stranger/connection projections and Incognito global-customization suppression;
search/offer consent, revisions, expiry, last-slot capacity and member scope;
room read/message/block/report/remove/lifecycle and Plan it; deletion/recovery and
historical linked-plan identity erasure; immutable minimized moderator evidence and
explicit cleanup; fixed realtime topics and minimal notifications. Candidate ranking
remains deterministic; optional AI is a stateless own-text/draft translator.

## Reproduced Important findings and corrections

1. **Room-report retention bypass through legacy cleanup.** An old room report newly
   resolved could be deleted by `cleanupSocial`, which checked only creation age,
   even though intent cleanup protected both creation and update for 365 days.
   Correction: legacy report cleanup selects `room_id IS NULL`; room reports stay
   exclusively under the stricter intent retention path. Open/reviewing cases and
   protected evidence continue to prevent unsafe context deletion.
2. **Updated search permanently suppressed cancelled recipients.** Search update
   cancelled pending offers, but one-off search/recipient uniqueness and broad
   exclusions prevented the recipient receiving a revised compatible offer.
   Correction: unique search/recipient/revision plus a partial unique pending
   search/recipient constraint and status-aware exclusions. Cancelled previous
   revisions can receive a fresh offer; actual declines remain remembered. Native
   tests retain concurrent capacity/admission and idempotence protections.

Both findings were reproduced RED before correction and GREEN afterward in the
actual native PostgreSQL harness; targeted review regression run **42 PASS**.
A separate independent rerun verified these corrections and the search-cohort report
with **48 native PostgreSQL tests PASS**, finding no additional confirmed Important
or Critical issue in those inspected boundaries.
The corrections apply to the new, unapplied 0020 migration; applied 0001–0018 are
unchanged. No unresolved Important finding from this bounded review is recorded.

A separate actual browser regression reproduced Back navigation invoking Next's
popstate before a late dirty-form guard. An early static `public/history-guard.js`
now intercepts before route teardown; native desktop/mobile regressions **2/2 PASS**.
This regression is also covered by the complete browser gates below.

## Evidence and practical limits

Current full local `npm run check`: PASS, **952 tests / 91 files**, lint/types/build.
Fresh `npm ci --offline` PASS and `npm audit --json` reports zero vulnerabilities.
Full ordinary **66/66** and isolated Vercel-mode **66/66** desktop/mobile E2E PASS,
no retries. Both Docker targets build; non-root and isolated PostgreSQL18 all-20
migration/idempotency/verification, concurrent worker, retention preview, readiness
and backup/restore gates PASS. Initial vfs disk exhaustion was resolved by removing
the compiled web build from the operations image and ordering ephemeral smoke
containers; assertions remain intact. The first full ordinary browser attempt
exposed a Profile Worlds accessible-name bug; explicit labelled spans fixed it,
with DOM and actual desktop/mobile regression reruns PASS. A browser block test now
awaits block commit before checking 404; it does not weaken access assertions.
First-failure traces were preserved. Hosted CI is separate and is not claimed for
this source at the documentation checkpoint. Historical CI or live18 readiness
does not verify local20 source.

Operators retain internal relational identity. Incognito does not prevent behavioral
identification or voluntary disclosure; a copied plan/message cannot be retracted.
Completion and aggregate counts do not prove attendance or unique humans. Historical
linked-plan associations detached before migration cannot be safely invented. Human
moderation, trusted verified-TLS database access, backups/restores, hosted streaming,
frequent scheduled workers and actual device checks remain operational requirements.
