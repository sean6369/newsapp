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
  await migrate(db, { migrationsFolder });
  console.log("[migrate] Database up to date");
}
