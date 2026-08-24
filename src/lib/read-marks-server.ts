import { getSetting } from "@/lib/db/queries";
import { READ_MARKS_SETTING, readMarksEnabledFromSetting } from "@/lib/read-marks";

/**
 * Whether read marks are switched on, for the pages that render the switch or
 * the cards it governs.
 *
 * Its own module because `read-marks.ts` is imported by client components and
 * so cannot reach the database, and because three pages would otherwise each
 * spell out the same two steps — a lookup and a default — with nothing to stop
 * one of them drifting.
 *
 * Deliberately not "the marks": those travel with the articles, one flag per
 * row, so there is nothing else for a page to ask for.
 */
export async function getReadMarksEnabled(): Promise<boolean> {
  return readMarksEnabledFromSetting(await getSetting(READ_MARKS_SETTING));
}
