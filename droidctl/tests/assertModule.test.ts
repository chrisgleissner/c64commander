/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { encodePng } from "../src/png.js";
import { evaluateMatches, isOnScreen, parseNodes } from "../src/tools/modules/assert.js";
import { FakeTransport } from "../src/transport/fake.js";
import { HIERARCHY_XML, createTestContext, invoke } from "./support/harness.js";

const TARGET = "adb:TESTSERIAL01";
const SCREEN = { width: 1080, height: 2280 };

function contextTransport(xml = HIERARCHY_XML): FakeTransport {
  const transport = new FakeTransport();
  transport.respondTo("wc -c", { stdout: "512\n" });
  transport.respondTo("cat /sdcard/Download/droidctl-ui.xml", { stdout: xml });
  transport.respondTo("screencap -p", {
    stdoutBytes: encodePng({ width: 64, height: 64, pixels: Buffer.alloc(64 * 64 * 4, 10) }),
  });
  return transport;
}

describe("hierarchy parsing", () => {
  it("reads the attributes an assertion needs and decodes XML entities", () => {
    const nodes = parseNodes(
      '<hierarchy><node text="Fish &amp; Chips" resource-id="a" class="c" enabled="true" bounds="[0,0][10,10]" /></hierarchy>',
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ text: "Fish & Chips", resourceId: "a", className: "c", enabled: true });
    expect(nodes[0]?.bounds).toEqual({ x1: 0, y1: 0, x2: 10, y2: 10 });
  });
});

describe("on-screen check", () => {
  const node = (bounds: { x1: number; y1: number; x2: number; y2: number } | null) => ({
    resourceId: "",
    text: "",
    contentDesc: "",
    className: "",
    enabled: true,
    bounds,
  });

  it("accepts a node overlapping the screen rectangle", () => {
    expect(isOnScreen(node({ x1: 0, y1: 2200, x2: 1080, y2: 2400 }), SCREEN)).toBe(true);
  });

  it("rejects a node scrolled entirely off the viewport, which non-degenerate bounds do not", () => {
    const scrolledAway = node({ x1: 0, y1: 4000, x2: 1080, y2: 4080 });
    expect(scrolledAway.bounds!.x2 > scrolledAway.bounds!.x1).toBe(true);
    expect(isOnScreen(scrolledAway, SCREEN)).toBe(false);
  });

  it("rejects a node with no bounds and a zero-area node", () => {
    expect(isOnScreen(node(null), SCREEN)).toBe(false);
    expect(isOnScreen(node({ x1: 10, y1: 10, x2: 10, y2: 20 }), SCREEN)).toBe(false);
  });
});

describe("match evaluation reports why each candidate was rejected", () => {
  const nodes = parseNodes(HIERARCHY_XML);
  const options = { requireEnabled: true, requireOnScreen: true };

  it("passes for a node that is present, enabled and on screen", () => {
    const outcome = evaluateMatches(nodes, { resourceId: "tab-play" }, SCREEN, options);
    expect(outcome.passed).toBe(true);
    expect(outcome.candidates.map((node) => node.rejectedBy)).toEqual([null]);
  });

  it("distinguishes present-but-disabled", () => {
    const outcome = evaluateMatches(nodes, { resourceId: "disabled-button" }, SCREEN, options);
    expect(outcome.passed).toBe(false);
    expect(outcome.candidates[0]).toMatchObject({ rejectedBy: "requireEnabled", onScreen: true });
  });

  it("distinguishes present-but-off-screen", () => {
    const outcome = evaluateMatches(nodes, { resourceId: "offscreen-row" }, SCREEN, options);
    expect(outcome.passed).toBe(false);
    expect(outcome.candidates[0]).toMatchObject({ rejectedBy: "requireOnScreen", onScreen: false });
  });

  it("distinguishes absent, which yields no candidate at all", () => {
    const outcome = evaluateMatches(nodes, { resourceId: "not-in-the-tree" }, SCREEN, options);
    expect(outcome.passed).toBe(false);
    expect(outcome.candidates).toEqual([]);
  });

  it("matches part of a merged row through textPattern, which exact text cannot", () => {
    expect(evaluateMatches(nodes, { text: "Play" }, SCREEN, options).passed).toBe(true);
    expect(evaluateMatches(nodes, { text: "Pla" }, SCREEN, options).passed).toBe(false);
    expect(evaluateMatches(nodes, { textPattern: "^Pla" }, SCREEN, options).passed).toBe(true);
  });

  it("matches on contentDesc and className", () => {
    expect(evaluateMatches(nodes, { contentDesc: "Play tab" }, SCREEN, options).passed).toBe(true);
    expect(evaluateMatches(nodes, { className: "android.widget.Button", text: "Play" }, SCREEN, options).passed).toBe(
      true,
    );
  });

  it("accepts an off-screen node when requireOnScreen is turned off", () => {
    const outcome = evaluateMatches(nodes, { resourceId: "offscreen-row" }, SCREEN, {
      requireEnabled: true,
      requireOnScreen: false,
    });
    expect(outcome.passed).toBe(true);
  });
});

describe("droid_assert.assert_visible", () => {
  it("passes and writes the hierarchy without a screenshot", async () => {
    const { ctx } = await createTestContext({ transport: contextTransport() });

    const result = await invoke(
      "droid_assert.assert_visible",
      { targetId: TARGET, name: "play-tab", match: { resourceId: "tab-play" } },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.data.passed).toBe(true);
    expect(result.data.screen).toEqual(SCREEN);
    expect(result.data.evidence.screenshotPath).toBeNull();
    expect(await readFile(result.data.evidence.xmlPath, "utf8")).toContain("<hierarchy");
  });

  it("returns passed: false with an evidence pair rather than throwing", async () => {
    const { ctx } = await createTestContext({ transport: contextTransport() });

    const result = await invoke(
      "droid_assert.assert_visible",
      { targetId: TARGET, name: "missing-thing", match: { resourceId: "offscreen-row" } },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.data.passed).toBe(false);
    expect(result.data.matches[0].rejectedBy).toBe("requireOnScreen");
    expect(result.data.evidence.xmlPath).toMatch(/hierarchies\/missing-thing\.xml$/);
    expect(result.data.evidence.screenshotPath).toMatch(/raw\/missing-thing\.png$/);
    expect((await readFile(result.data.evidence.screenshotPath)).subarray(1, 4).toString()).toBe("PNG");
  });

  it("re-captures until the deadline when timeoutMs is given", async () => {
    const transport = contextTransport('<hierarchy><node bounds="[0,0][100,100]" enabled="true" /></hierarchy>');
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_assert.assert_visible",
      { targetId: TARGET, name: "never", match: { resourceId: "nope" }, timeoutMs: 120, pollIntervalMs: 20 },
      ctx,
    );

    expect(result.data.passed).toBe(false);
    expect(result.data.attempts).toBeGreaterThan(1);
  });

  it("propagates a hierarchy capture failure as an error, not as passed: false", async () => {
    const transport = contextTransport("no hierarchy here");
    transport.respondTo("uiautomator dump /dev/tty", { stdout: "" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_assert.assert_visible",
      { targetId: TARGET, name: "broken", match: { resourceId: "tab-play" } },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/no <hierarchy root/);
  });

  it("rejects an empty match object", async () => {
    const { ctx } = await createTestContext({ transport: contextTransport() });

    const result = await invoke("droid_assert.assert_visible", { targetId: TARGET, name: "x", match: {} }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("invalid_input");
  });
});

describe("droid_assert.assert_not_visible", () => {
  it("passes when nothing matches, which is what catches a crashed page", async () => {
    const { ctx } = await createTestContext({ transport: contextTransport() });

    const result = await invoke(
      "droid_assert.assert_not_visible",
      { targetId: TARGET, name: "no-crash", match: { text: "Something went wrong" } },
      ctx,
    );

    expect(result.data.passed).toBe(true);
  });

  it("fails, with evidence, when the node is visible", async () => {
    const { ctx } = await createTestContext({ transport: contextTransport() });

    const result = await invoke(
      "droid_assert.assert_not_visible",
      { targetId: TARGET, name: "unexpected", match: { resourceId: "tab-play" } },
      ctx,
    );

    expect(result.data.passed).toBe(false);
    expect(result.data.evidence.screenshotPath).toMatch(/raw\/unexpected\.png$/);
  });
});
