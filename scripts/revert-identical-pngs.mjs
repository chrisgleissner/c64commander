#!/usr/bin/env node
import { pruneRedundantScreenshots } from "./screenshotMetadataDedupe.js";

const run = async () => {
  const summary = await pruneRedundantScreenshots();

  if (summary.scanned === 0) {
    console.log("[png-prune] No modified screenshot PNG files detected.");
    return;
  }

  console.log(
    `[png-prune] scanned=${summary.scanned} reverted=${summary.reverted} deleted=${summary.deleted} kept=${summary.kept}`,
  );
};

run().catch((error) => {
  console.error("[png-prune] Unexpected failure:", error);
  process.exitCode = 1;
});
