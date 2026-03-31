import { describe, expect, it } from "vitest";

import { buildPlaybackConfigSignature } from "@/lib/config/playbackConfig";

describe("buildPlaybackConfigSignature", () => {
  it("normalizes override order so equivalent sets share a signature", () => {
    const configRef = {
      kind: "ultimate" as const,
      fileName: "Demo.cfg",
      path: "/Configs/Demo.cfg",
    };

    const first = buildPlaybackConfigSignature(configRef, [
      { category: "audio", item: "stereo", value: "on" },
      { category: "video", item: "border", value: 1 },
    ]);
    const second = buildPlaybackConfigSignature(configRef, [
      { category: "video", item: "border", value: 1 },
      { category: "audio", item: "stereo", value: "on" },
    ]);

    expect(first).toBe(second);
  });
});
