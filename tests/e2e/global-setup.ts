import postgres from "postgres";

/**
 * The suite signs up several owners from 127.0.0.1, which trips the app's
 * per-IP auth rate limits on repeated local runs. Reset those buckets, but
 * only against a local database.
 */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url || !/@(127\.0\.0\.1|localhost)(:|\/)/.test(url)) return;
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from rate_limits where bucket like 'signup:%' or bucket like 'signin:%'`;
  } finally {
    await sql.end();
  }
}
