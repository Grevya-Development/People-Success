import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../env";
import * as schema from "./schema";

function createClient() {
  const url = env().DATABASE_URL;
  // Supabase's transaction pooler (port 6543) does not support prepared statements.
  const pooled = url.includes(":6543");
  return postgres(url, {
    max: env().DATABASE_POOL_MAX,
    prepare: !pooled,
    idle_timeout: 20,
    connect_timeout: 10,
    // Keep timestamps and dates as strings where drizzle asks for them.
    onnotice: () => {},
  });
}

const globalForDb = globalThis as unknown as { __psSql?: ReturnType<typeof postgres> };

export const sqlClient = globalForDb.__psSql ?? createClient();
if (env().NODE_ENV !== "production") globalForDb.__psSql = sqlClient;

export const db = drizzle(sqlClient, { schema, casing: "snake_case" });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run a query: the root client or an open transaction. */
export type Queryable = Db | Tx;
