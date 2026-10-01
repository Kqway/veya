import { createDatabase } from "@/lib/db/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { seedDemo } from "@/lib/db/seed";
import { getServerEnv } from "@/lib/config/server";

async function main() {
  const command = process.argv[2];
  if (command !== "migrate" && command !== "seed") throw new Error("Unknown database command.");
  const config = getServerEnv();
  if (config.NODE_ENV === "production" && (!config.DATABASE_URL || command === "seed")) {
    throw new Error("Production requires DATABASE_URL; demo seeding is disabled in production.");
  }
  const database = createDatabase(config.DATABASE_URL ?? "postgresql://veya:veya-local-only@127.0.0.1:54322/veya", { max:config.DB_POOL_MAX, ...(config.DATABASE_SSL_MODE ? {sslMode:config.DATABASE_SSL_MODE}: {}) });
  try {
    const applied = await applyMigrations(database);
    console.log(`Migrations applied: ${applied.length}.`);
    if (command === "seed") {
      const demo = await seedDemo(database);
      console.log(`Demo ${demo.created ? "created" : "already exists"}: /api/intents/${demo.publicSlug}`);
    }
  } finally { await database.close(); }
}

main().catch(() => {
  console.error("Database command failed. Verify DATABASE_URL, PostgreSQL availability and migration checksums. Demo seeding is disabled in production.");
  process.exitCode = 1;
});
