import * as cron from "node-cron";
import { runFetchPipeline } from "./pipeline";
import { generateAndStoreStorylines } from "./extractor";

let fetchTask: ReturnType<typeof cron.schedule> | null = null;

export function startScheduler() {
  if (fetchTask) return;

  if (process.env.ENABLE_PIPELINE === "false") {
    console.log("[scheduler] Pipeline disabled (ENABLE_PIPELINE=false)");
    return;
  }

  // Run every hour to ensure we don't miss a day if the server was down
  fetchTask = cron.schedule("0 * * * *", async () => {
    console.log("[scheduler] Running hourly fetch pipeline...");
    try {
      // No HTTP response to race, so run both phases inline.
      const { result, finalize } = await runFetchPipeline();
      await finalize();
      console.log("[scheduler] Pipeline complete:", result);
    } catch (error) {
      console.error("[scheduler] Pipeline failed:", error);
    }
  });

  // Generate top storylines daily at 7:30 AM
  cron.schedule("30 7 * * *", async () => {
    console.log("[scheduler] Running daily storyline generation...");
    try {
      const result = await generateAndStoreStorylines();
      console.log("[scheduler] Storylines complete:", result);
    } catch (error) {
      console.error("[scheduler] Storyline generation failed:", error);
    }
  });

  console.log("[scheduler] Fetch pipeline scheduled hourly");
  console.log("[scheduler] Storyline generation scheduled daily at 7:30 AM");
}

