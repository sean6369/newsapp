import * as cron from "node-cron";
import { getOrStartFetchPipeline } from "./pipeline";

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
      // No HTTP response to race, so run both phases inline. Joins a run a
      // page load may have started in the last minute instead of duplicating it.
      const { result, finalize } = await getOrStartFetchPipeline();
      await finalize();
      console.log("[scheduler] Pipeline complete:", result);
    } catch (error) {
      console.error("[scheduler] Pipeline failed:", error);
    }
  });

  console.log("[scheduler] Fetch pipeline scheduled hourly");
}

