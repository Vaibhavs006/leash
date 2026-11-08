/**
 * Applies SQL migrations in ./drizzle. Runs locally and as Render's preDeployCommand.
 * Plain ESM with production dependencies only (no tsx/dotenv), so it works on any install.
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const local = /localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { max: 1, ssl: local ? false : "prefer", onnotice: () => {} });

try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied");
} catch (e) {
  console.error("Migration failed:", e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
