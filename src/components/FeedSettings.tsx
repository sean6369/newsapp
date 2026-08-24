"use client";

import { useState } from "react";
import { Checkbox, CheckboxGroup, Description, Label, Switch, Tooltip, toast } from "@heroui/react";
import { Info } from "lucide-react";
import type { FeedSourceGroup, FeedSourceState } from "@/lib/feed-sources";
import { contentColumn } from "./hero-shared";
import { useReadMarks } from "./ReadMarks";

/**
 * The host a source is read from, as a reader would recognise it.
 *
 * The stored URL is the machine's business — CNA's sections are query
 * parameters on one endpoint, so the full string tells a reader nothing they
 * can act on while making four rows look identical.
 */
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface FeedSettingsProps {
  groups: FeedSourceGroup[];
}

export function FeedSettings({ groups }: FeedSettingsProps) {
  /**
   * The switches, flat, keyed by source id.
   *
   * Flat rather than nested inside the groups so a change is one lookup and
   * the groups stay what the server sent: they are the *roster*, which only a
   * deploy changes, and only `enabled` is the reader's to move.
   */
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      groups.flatMap((g) => g.sources.map((s) => [s.id, s.enabled]))
    )
  );
  const [saving, setSaving] = useState(0);

  /**
   * The read-marks switch.
   *
   * The provider is handed the setting by this route's server render, so the
   * switch is drawn in the position it is already in — and because that
   * provider is shared, throwing it here reaches the feed behind this page
   * without a reload.
   */
  const { enabled: readMarks, setEnabled: setReadMarks } = useReadMarks();

  const toggleReadMarks = (on: boolean) => {
    setSaving((n) => n + 1);
    // Switching off clears every mark server-side; the switch and the feed
    // both move on the click and roll back together if the write fails.
    setReadMarks(on)
      .catch((err: Error) => {
        console.error("[settings] read marks save failed:", err);
        toast.danger(
          err instanceof TypeError
            ? "Couldn't reach the server — nothing was saved"
            : err.message
        );
      })
      .finally(() => setSaving((n) => n - 1));
  };

  /**
   * Apply one feed group's new selection.
   *
   * The group hands back the ids still ticked, so what changed is the
   * difference against this group's own sources — never the whole roster.
   * Sending everything on every click would let a second tab, or the settings
   * page left open since yesterday, quietly undo switches thrown elsewhere.
   */
  const applyGroup = (group: FeedSourceGroup, selected: string[]) => {
    const picked = new Set(selected);
    const updates: Record<string, boolean> = {};
    for (const source of group.sources) {
      const next = picked.has(source.id);
      if (next !== enabled[source.id]) updates[source.id] = next;
    }
    if (Object.keys(updates).length === 0) return;

    // Optimistic: a checkbox that waits for the network before moving feels
    // broken, and there is nothing to reconcile — the server stores exactly
    // what was clicked or fails.
    const previous = enabled;
    setEnabled((current) => ({ ...current, ...updates }));
    setSaving((n) => n + 1);

    fetch("/api/settings/feeds", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Couldn't save that");
        }
      })
      .catch((err: Error) => {
        console.error("[settings] save failed:", err);
        // Roll back only the sources this request touched. A blanket revert to
        // `previous` would also undo a change made in a different group while
        // this one was in flight.
        setEnabled((current) => {
          const rolledBack = { ...current };
          for (const id of Object.keys(updates)) rolledBack[id] = previous[id];
          return rolledBack;
        });
        // A transport failure arrives as a TypeError carrying the browser's
        // own wording — "Failed to fetch", "Load failed" — which says nothing
        // about what happened to the switch. Only the server's own message is
        // worth repeating verbatim.
        toast.danger(
          err instanceof TypeError
            ? "Couldn't reach the server — nothing was saved"
            : err.message
        );
      })
      .finally(() => setSaving((n) => n - 1));
  };

  return (
    // `contentColumn` rather than a width of its own: Search and Ask already
    // share it, and the feed and library set the same 7xl column by hand, so
    // this page lines up with whichever one you arrived from.
    <div className={`${contentColumn} py-8 pb-24 md:pb-28`}>
      <div className="flex items-baseline justify-between gap-4 mb-8">
        <h1 className="font-serif text-2xl md:text-3xl font-medium">Settings</h1>
        {/* Polite, so a screen reader hears it between clicks rather than
            interrupting the checkbox it just announced. */}
        <span className="text-xs text-muted" aria-live="polite">
          {saving > 0 ? "Saving…" : ""}
        </span>
      </div>

      {/* The page keeps the full column so its title lines up with every other
          page's, but the list itself is held to a reading width and centred in
          it: switches and their hostnames are short, and stretched across 80rem
          the hairlines would run off into empty space with the text stranded at
          one end. */}
      <div className="max-w-2xl mx-auto">
        {/* Reading comes first: it is one switch about how the app behaves,
            and it would be lost under a list of twenty outlets. The feeds are
            the longer, rarer errand, so they take the section below. */}
        <section>
          {/* The heading is deliberately quieter than the serif feed names
              further down: it names the section, and a heading that outweighed
              the things it introduces would read as another feed. */}
          <h2 className="mb-5 text-xs font-medium uppercase tracking-wider text-muted">
            Reading
          </h2>

          {/* The icon sits outside the `Switch`, not inside it. The switch
              renders as a `<label>`, and a button nested in a label is still
              part of that label's hit area — reaching for the explanation
              would throw the switch. */}
          <div className="flex items-center gap-2">
            <Switch
              className="items-center"
              isSelected={readMarks}
              onChange={toggleReadMarks}
            >
              <Switch.Content className="flex-row items-center gap-3">
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                {/* Named for what it does, in the same words the card's own
                    right-click menu uses — "Mark as read" there, marking
                    articles as read here — rather than for how it looks. */}
                <span className="text-sm">Mark articles as read</span>
              </Switch.Content>
            </Switch>

            {/* Same treatment as the feeds' own note below, for the same
                reason: it answers a question asked once, and a reader who
                already knows the answer should not read past it every visit.
                It still says what switching *off* does as well as what on
                does, because off is the destructive direction and the marks
                do not come back. */}
            <Tooltip delay={200}>
              <Tooltip.Trigger
                className="text-muted hover:text-foreground"
                aria-label="What marking articles as read does"
              >
                <Info className="h-3.5 w-3.5" />
              </Tooltip.Trigger>
              <Tooltip.Content showArrow className="break-normal p-3 leading-relaxed">
                Articles you have opened are dimmed in the feed, so you can
                see at a glance what you have not read yet. They stay where
                they are — nothing is hidden or reordered. Switching this off
                clears every mark and returns all articles to unread.
              </Tooltip.Content>
            </Tooltip>
          </div>
        </section>

        {/* A rule between the two, so they read as sections of one page rather
            than one being a footnote to the other. */}
        <section className="mt-10 border-t border-border pt-10">
          <div className="flex items-center gap-2 mb-5">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted">
              RSS Feeds
            </h2>

            {/* What switching a source off actually does, kept behind the icon
                rather than set as a paragraph under the title. It answers a
                question asked once, and a reader who already knows the answer
                should not have to read past it every visit.

                `break-normal` undoes the tooltip's default `break-all`, which
                is meant for URLs and would hyphenate this mid-word. */}
            <Tooltip delay={200}>
              <Tooltip.Trigger
                className="text-muted hover:text-foreground"
                aria-label="What switching a source off does"
              >
                <Info className="h-3.5 w-3.5" />
              </Tooltip.Trigger>
              <Tooltip.Content showArrow className="break-normal p-3 leading-relaxed">
                Which sources each feed is pulled from. Switching one off stops new
                articles arriving from it on the next fetch — everything already
                gathered stays in the archive, and switching it back on resumes from
                whatever that source is carrying then.
              </Tooltip.Content>
            </Tooltip>
          </div>

          {/* A hairline between feeds rather than a card around each — it marks
              where one feed ends without boxing the switches in. */}
          <div className="flex flex-col divide-y divide-border">
            {groups.map((group) => (
              <FeedGroupSection
                key={group.feed}
                group={group}
                enabled={enabled}
                onChange={(selected) => applyGroup(group, selected)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function FeedGroupSection({
  group,
  enabled,
  onChange,
}: {
  group: FeedSourceGroup;
  enabled: Record<string, boolean>;
  onChange: (selected: string[]) => void;
}) {
  const on = group.sources.filter((s) => enabled[s.id]);

  return (
    <section className="py-6 first:pt-0 last:pb-0">
      <CheckboxGroup
        className="gap-0"
        value={on.map((s) => s.id)}
        onChange={onChange}
      >
        {/* The paused note sits on the feed name's baseline beside it, and
            wraps to its own line only when the row is too narrow to hold both.
            Said only when it is true, and said as the group's description so a
            screen reader reaches it with the heading rather than after the
            last checkbox — an empty feed is the one state a reader could
            mistake for a bug. */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Label className="font-serif text-lg font-medium">{group.label}</Label>
          {on.length === 0 && (
            <Description className="text-xs text-accent">
              Paused — nothing new will arrive in this feed.
            </Description>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {group.sources.map((source) => (
            <SourceCheckbox key={source.id} source={source} />
          ))}
        </div>
      </CheckboxGroup>
    </section>
  );
}

/**
 * One source's switch.
 *
 * The layout is set here rather than left to the component's defaults: the
 * control belongs beside the outlet name, with the host beneath both, and
 * that is a decision about this list rather than about checkboxes in general.
 */
function SourceCheckbox({ source }: { source: FeedSourceState }) {
  return (
    <Checkbox
      // `mt-0` undoes the group's default stacking margin; the wrapper above
      // spaces these with a gap instead, which stays even at the top of the list.
      className="mt-0 flex-col items-start gap-1"
      value={source.id}
    >
      <Checkbox.Content className="flex-row items-center gap-3">
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <span className="text-sm">{source.outlet}</span>
      </Checkbox.Content>
      {/* Indented past the control so it reads as belonging to the outlet
          above it: 1rem of control plus the 0.75rem gap. */}
      <Description className="pl-7 text-xs text-muted">
        {sourceHost(source.url)}
      </Description>
    </Checkbox>
  );
}
