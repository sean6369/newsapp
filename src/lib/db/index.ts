import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

const globalForDb = globalThis as unknown as {
  pgClient: ReturnType<typeof postgres> | undefined;
};

const client =
  globalForDb.pgClient ??
  postgres(connectionString, {
    // The startup migration guards its bookkeeping with CREATE SCHEMA / CREATE
    // TABLE IF NOT EXISTS, and Postgres answers each with a NOTICE that this
    // driver prints by default — twenty lines of noise on every boot, saying
    // only that the migration ledger already exists.
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgClient = client;
}

export const db = drizzle(client, { schema });
