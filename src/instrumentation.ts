export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    const { seedTopics } = await import("./lib/db/queries");
    const { TOPIC_TAXONOMY } = await import("./lib/topics");

    startScheduler();
    seedTopics(TOPIC_TAXONOMY).catch((err) =>
      console.error("[instrumentation] Failed to seed topics:", err)
    );
  }
}
