import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFilePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(testFilePath), "../../..");
const mainActivitySource = readFileSync(
  resolve(repoRoot, "android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt"),
  "utf8",
);
const backgroundServiceSource = readFileSync(
  resolve(repoRoot, "android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt"),
  "utf8",
);
const backgroundPluginSource = readFileSync(
  resolve(repoRoot, "android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionPlugin.kt"),
  "utf8",
);

describe("Android background execution contracts", () => {
  it("keeps WebView playback alive on both pause and stop while the background service is running", () => {
    expect(mainActivitySource).toContain("override fun onPause()");
    expect(mainActivitySource).toContain("override fun onStop()");
    expect(mainActivitySource).toContain("keepWebViewPlaybackAliveDuringBackgroundExecution()");
  });

  it("clears the previous watchdog callback before publishing the next dueAt state", () => {
    const removeIndex = backgroundServiceSource.indexOf("dueRunnable?.let { handler.removeCallbacks(it) }");
    const assignIndex = backgroundServiceSource.indexOf("dueAtMs = nextDueAtMs");
    expect(removeIndex).toBeGreaterThanOrEqual(0);
    expect(assignIndex).toBeGreaterThan(removeIndex);
  });

  it("reschedules watchdog retries with the same local runnable instead of re-reading shared service state", () => {
    expect(backgroundServiceSource).toContain("handler.postDelayed(runnable, remaining)");
    expect(backgroundServiceSource).not.toContain("handler.postDelayed(nextRunnable, remaining)");
  });

  it("guards background auto-skip receiver registration so load is idempotent", () => {
    expect(backgroundPluginSource).toContain("private var isAutoSkipReceiverRegistered = false");
    expect(backgroundPluginSource).toContain("if (isAutoSkipReceiverRegistered) return");
    expect(backgroundPluginSource).toContain("isAutoSkipReceiverRegistered = true");
    expect(backgroundPluginSource).toContain("isAutoSkipReceiverRegistered = false");
  });
});
