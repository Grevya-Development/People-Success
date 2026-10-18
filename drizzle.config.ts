import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  // Migrations are generated straight into the Supabase CLI folder so that
  // `supabase db reset` (local) and `supabase db push` (hosted) apply them.
  out: "./supabase/migrations",
  migrations: { prefix: "supabase" },
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
  schemaFilter: ["public"],
  strict: true,
  verbose: false,
});
