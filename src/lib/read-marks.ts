/**
 * Which articles the reader has already opened.
 *
 * The marks themselves live in Postgres and travel with the articles — every
 * row a query returns carries its own `read` flag (see `articleColumns`). So
 * there is no set of marks to fetch, to seed, or to keep in step: a page of
 * articles arrives knowing which of them have been read, and that stays true
 * however long the reader has been using the app.
 *
 * What is left here is the preference, which is one row in `settings`.
 */

/** The route that writes marks and moves the switch. */
export const READ_MARKS_ENDPOINT = "/api/read-marks";

/** The `settings` row the toggle lives in. */
export const READ_MARKS_SETTING = "read-marks-enabled";

/**
 * On unless it was explicitly switched off.
 *
 * A missing row is a reader who has never visited the settings page, and the
 * feature is meant to be on for them — defaulting to off would hide it behind
 * a switch nobody has a reason to go looking for.
 */
export function readMarksEnabledFromSetting(value: string | null): boolean {
  return value !== "off";
}

export function readMarksSettingValue(enabled: boolean): string {
  return enabled ? "on" : "off";
}
