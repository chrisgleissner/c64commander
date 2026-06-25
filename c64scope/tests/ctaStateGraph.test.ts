/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { CtaStateGraph, stateKey, type CtaStateNode } from "../src/cta/stateGraph.js";

const home: CtaStateNode = {
  route: "/",
  target: "c64u",
  connectionState: "REAL_CONNECTED",
  featureFlags: ["b", "a"],
};

describe("CTA state graph", () => {
  it("builds stable keys independent of feature flag order", () => {
    expect(stateKey(home)).toBe(
      stateKey({
        ...home,
        featureFlags: ["a", "b"],
      }),
    );
  });

  it("orders next edges deterministically and skips visited states", () => {
    const graph = new CtaStateGraph();
    const docs: CtaStateNode = { ...home, route: "/docs" };
    const play: CtaStateNode = { ...home, route: "/play" };

    graph.addEdge(home, play, "digit-2", 2);
    graph.addEdge(home, docs, "digit-6", 1);

    expect(graph.nextEdges(home, new Set()).map((edge) => edge.actionId)).toEqual(["digit-6", "digit-2"]);
    expect(graph.nextEdges(home, new Set([stateKey(docs)])).map((edge) => edge.actionId)).toEqual(["digit-2"]);
    expect(graph.serialize().nodes).toHaveLength(3);
  });
});
