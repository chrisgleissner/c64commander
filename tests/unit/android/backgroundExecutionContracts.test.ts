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

  it("guards background receiver registration so load is idempotent", () => {
    expect(backgroundPluginSource).toContain("private var areServiceReceiversRegistered = false");
    expect(backgroundPluginSource).toContain("if (areServiceReceiversRegistered) return");
    expect(backgroundPluginSource).toContain("areServiceReceiversRegistered = true");
    expect(backgroundPluginSource).toContain("areServiceReceiversRegistered = false");
  });

  it("HARD27-040: publishes now-playing metadata to the session the lock screen reads", () => {
    expect(backgroundPluginSource).toContain("fun setNowPlaying(call: PluginCall)");
    expect(backgroundServiceSource).toContain("session.setMetadata(metadata.build())");
    expect(backgroundServiceSource).toContain("MediaMetadata.METADATA_KEY_TITLE");
    expect(backgroundServiceSource).toContain("MediaMetadata.METADATA_KEY_ARTIST");
    expect(backgroundServiceSource).toContain("MediaMetadata.METADATA_KEY_DURATION");
  });

  it("HARD27-040: names the session on the notification, which is what draws the media control", () => {
    expect(backgroundServiceSource).toContain("Notification.MediaStyle()");
    expect(backgroundServiceSource).toContain("style.setMediaSession(it)");
    // The session has to exist before the notification that names its token is built.
    const startBlock = backgroundServiceSource.slice(
      backgroundServiceSource.indexOf('AppLogger.info(this, TAG, "Service starting"'),
      backgroundServiceSource.indexOf("isRunning = true"),
    );
    expect(startBlock.indexOf("initializeMediaSession()")).toBeGreaterThanOrEqual(0);
    expect(startBlock.indexOf("initializeMediaSession()")).toBeLessThan(startBlock.indexOf("startForeground("));
  });

  it("HARD27-040: the notification's transport buttons relay the same broadcast a media button does", () => {
    expect(backgroundServiceSource).toContain("PendingIntent.getBroadcast(");
    expect(backgroundServiceSource).toContain("TRANSPORT_COMMAND_NEXT");
    expect(backgroundServiceSource).toContain("override fun onSkipToNext()");
    expect(backgroundServiceSource).toContain("PlaybackState.ACTION_SKIP_TO_NEXT");
  });

  it("relays a media button press to the web layer, retained until Play remounts a listener", () => {
    expect(backgroundPluginSource).toContain('notifyListeners("backgroundTransportCommand", payload, true)');
  });

  it("HARD20-010: retains an auto-skip event until Play remounts a listener", () => {
    expect(backgroundPluginSource).toContain('notifyListeners("backgroundAutoSkipDue", payload, true)');
  });

  it("HARD20-007: always issues a fresh generation for start so stop-to-start cannot be swallowed", () => {
    const startBody = backgroundServiceSource.slice(
      backgroundServiceSource.indexOf("fun start(context: Context)"),
      backgroundServiceSource.indexOf("fun stop(context: Context)"),
    );
    expect(startBody).toContain("val generation = nextCommandGeneration()");
    expect(startBody).not.toContain("if (isRunning)");
  });
});
