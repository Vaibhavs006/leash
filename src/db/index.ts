import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;

// One pool per process (survives Next.js dev hot reloads). Created lazily so
// `next build` never needs a database.
const g = globalThis as unknown as { __leashDb?: DB };

function create(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, {
    max: 10,
    // TLS when the server offers it (Render external URLs require it; internal URLs may not).
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "prefer",
    onnotice: () => {},
  });
  return drizzle(client, { schema });
}

export const db: DB = new Proxy({} as DB, {
  get(_t, prop, receiver) {
    const real = (g.__leashDb ??= create());
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
