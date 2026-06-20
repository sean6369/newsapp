import * as cron from "node-cron";
import { runFetchPipeline } from "./pipeline";

let task: ReturnType<typeof cron.schedule> | null = null;

export function startScheduler() {
  if (task) return;

  if (process.env.ENABLE_PIPELINE === "false") {
    console.log("[scheduler] Pipeline disabled (ENABLE_PIPELINE=false)");
    return;
  }

  // Run every hour to ensure we don't miss a day if the server was down
  task = cron.schedule("0 * * * *", async () => {
    console.log("[scheduler] Running hourly fetch pipeline...");
    try {
      const result = await runFetchPipeline();
      console.log("[scheduler] Pipeline complete:", result);
    } catch (error) {
      console.error("[scheduler] Pipeline failed:", error);
    }
  });

  console.log("[scheduler] Fetch pipeline scheduled to run every hour");
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
}
