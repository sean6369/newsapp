import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db";

/**
 * Bring the database up to the schema this build expects, before anything
 * serves a request.
 *
 * The alternative — running `drizzle-kit push` by hand against each database —
 * is what this app did until the migration history was rebaselined, and it has
 * no answer for the production database, which publishes no port and is
 * reachable only from inside the compose network. Applying migrations here
 * makes `docker compose up` the whole deploy.
 *
 * Safe to run against a database that is already current: drizzle compares the
 * folder against the `drizzle.__drizzle_migrations` ledger and applies only
 * what is missing.
 */
export async function runMigrations() {
  // Resolved from the working directory rather than this module, which is
  // bundled into .next/ where nothing sits beside it. Both `next dev` and the
  // standalone server run from the root the `drizzle/` folder lives in.
  const migrationsFolder = `${process.cwd()}/drizzle`;

  console.log("[migrate] Applying migrations from", migrationsFolder);
  try {
    await migrate(db, { migrationsFolder });
  } catch (error) {
    console.error("[migrate] Migration failed:", error);
    // Next logs a rejection thrown from `register` and then carries on serving,
    // which is the worst of the options here: a container that cannot reach its
    // database, or stopped half way through a migration, stays "up" and answers
    // requests with errors, and `restart: unless-stopped` never fires because
    // nothing exited. Exiting hands the decision back to the orchestrator,
    // which retries — and a database still starting up becomes a few restarts
    // rather than a permanently broken app.
    if (process.env.NODE_ENV === "production") process.exit(1);
    // In development the reverse is true: dropping the dev server over a
    // database that is momentarily down costs more than it saves.
    throw error;
  }
  console.log("[migrate] Database up to date");
}
