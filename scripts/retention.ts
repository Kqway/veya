import { createDatabase } from "@/lib/db/postgres";
import { cleanupSocial } from "@/lib/db/social-retention";
import { cleanupExpired } from "@/lib/db/retention";
import { getServerEnv } from "@/lib/config/server";
async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => arg !== "--apply" && arg !== "--dry-run") ||
    (args.includes("--apply") && args.includes("--dry-run"))
  )
    throw new Error("Use --dry-run or --apply.");
  const config = getServerEnv();
  if (config.NODE_ENV === "production" && !config.DATABASE_URL)
    throw new Error("Production requires DATABASE_URL.");
  const database = createDatabase(
    config.DATABASE_URL ??
      "postgresql://veya:veya-local-only@127.0.0.1:54322/veya",
  );
  try {
    const social = await cleanupSocial(database, {
      apply: args.includes("--apply"),
    });
    const result = await cleanupExpired(database, {
      apply: args.includes("--apply"),
    });
    console.log(
      `${result.dryRun ? "Dry run" : "Applied cleanup"}: ${result.intents} intents, ${result.guests} guest sessions, ${result.analytics} analytics events (up to 100 each).`,
    );
    console.log(
      `Social cleanup: ${social.reports} reports, ${social.handles} discovery handles, ${social.passes} passes, ${social.posts} seeking posts, ${social.pairs} inactive pairs (up to 100 each; ${social.dryRun ? "dry run" : "applied"}).`,
    );
  } finally {
    await database.close();
  }
}
main().catch(() => {
  console.error(
    "Retention command failed. Check database availability/migrations and use --dry-run or --apply. Production requires explicit DATABASE_URL.",
  );
  process.exitCode = 1;
});
