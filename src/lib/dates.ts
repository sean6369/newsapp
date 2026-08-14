/**
 * The timezone the archive is filed in.
 *
 * `articles.date` is the publication day in Singapore time, assigned when a
 * feed item is ingested. Anything comparing against that column — or telling a
 * model what "today" means — has to agree, and the server does not: the
 * container sets no `TZ`, so Node runs UTC and `toISOString()` names the wrong
 * day for the eight hours after midnight local. That window is when the
 * overnight crawl runs, so it is precisely when the archive's newest articles
 * are dated a day ahead of the date the prompt claims it is.
 */
export const ARCHIVE_TZ = "Asia/Singapore";

/** Today as `YYYY-MM-DD` in {@link ARCHIVE_TZ}. `en-CA` formats ISO-style. */
export function archiveToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: ARCHIVE_TZ });
}
