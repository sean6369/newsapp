import type { Metadata } from "next";
import { getFeedSourceOverrides } from "@/lib/db/queries";
import { groupSourcesByFeed, resolveFeedSources } from "@/lib/feed-sources";
import { FeedSettings } from "@/components/FeedSettings";

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
  const groups = groupSourcesByFeed(
    resolveFeedSources(await getFeedSourceOverrides())
  );

  return <FeedSettings groups={groups} />;
}
