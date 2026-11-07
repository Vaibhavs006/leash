import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// One pool per process (survives Next.js dev hot reloads).
const g = globalThis as unknown as { __leashSql?: ReturnType<typeof postgres> };

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

export const sqlClient = (g.__leashSql ??= postgres(connectionString(), {
  max: 10,
  // Render Postgres requires TLS on external connections; internal URLs work either way.
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") ? false : "require",
}));

export const db = drizzle(sqlClient, { schema });
export { schema };
