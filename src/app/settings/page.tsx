import type { Metadata } from "next";
import { getFeedSourceOverrides } from "@/lib/db/queries";
import { groupSourcesByFeed, resolveFeedSources } from "@/lib/feed-sources";
import { FeedSettings } from "@/components/FeedSettings";
import { ReadMarksProvider } from "@/components/ReadMarks";
import { getReadMarksEnabled } from "@/lib/read-marks-server";

export const metadata: Metadata = {
  title: "Settings — Leedon News",
  description: "Choose which sources each feed is pulled from.",
};

/**
 * Rendered per request.
 *
 * The roster lives in the database, and this page's whole job is to show what
 * is switched on right now — a build-time snapshot would show the state the
 * image was built with, which for a self-hosted deploy could be weeks stale.
 */
export const dynamic = "force-dynamic";

export default async function SettingsRoute() {
  const [overrides, readMarks] = await Promise.all([
    getFeedSourceOverrides(),
    getReadMarksEnabled(),
  ]);
  const groups = groupSourcesByFeed(resolveFeedSources(overrides));

  // The switch is drawn in the position the server already knows it to be in.
  // One that rendered off and flicked on a moment later would read as the page
  // having changed the setting, which is the one thing a settings page must
  // never look like.
  return (
    <ReadMarksProvider enabled={readMarks}>
      <FeedSettings groups={groups} />
    </ReadMarksProvider>
  );
}
