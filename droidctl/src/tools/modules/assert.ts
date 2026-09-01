/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { z } from "zod";
import { sanitizeArtifactName } from "../../artifacts.js";
import type { ResolvedTargetHandle } from "../../transport/registry.js";
import { defineExecute, delay, resolveTarget, runRootSchema, targetIdSchema } from "../common.js";
import { describeTarget } from "../../deviceInfo.js";
import { ToolExecutionError } from "../errors.js";
import { captureUiHierarchy, screenFromHierarchy, writeScreenshot } from "./capture.js";
import { defineToolModule, type ToolExecutionContext } from "../types.js";

export interface NodeAttributes {
  readonly resourceId: string;
  readonly text: string;
  readonly contentDesc: string;
  readonly className: string;
  readonly bounds: { x1: number; y1: number; x2: number; y2: number } | null;
  readonly enabled: boolean;
}

export interface MatchPredicates {
  readonly resourceId?: string;
  readonly text?: string;
  readonly textPattern?: string;
  readonly contentDesc?: string;
  readonly className?: string;
}

export interface Screen {
  readonly width: number;
  readonly height: number;
}

const XML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

/** Android's serialiser escapes newline, carriage return and tab numerically. */
function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity);
}

function attribute(fragment: string, name: string): string {
  const match = new RegExp(`${name}="([^"]*)"`).exec(fragment);
  return match ? decodeXml(match[1]!) : "";
}

export function parseNodes(xml: string): NodeAttributes[] {
  const nodes: NodeAttributes[] = [];
  for (const fragment of xml.split("<node ").slice(1)) {
    const end = fragment.indexOf(">");
    const attributes = end >= 0 ? fragment.slice(0, end) : fragment;
    const boundsMatch = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(attributes);
    nodes.push({
      resourceId: attribute(attributes, "resource-id"),
      text: attribute(attributes, "text"),
      contentDesc: attribute(attributes, "content-desc"),
      className: attribute(attributes, "class"),
      enabled: /enabled="true"/.test(attributes),
      bounds: boundsMatch
        ? {
            x1: Number(boundsMatch[1]),
            y1: Number(boundsMatch[2]),
            x2: Number(boundsMatch[3]),
            y2: Number(boundsMatch[4]),
          }
        : null,
    });
  }
  return nodes;
}

/**
 * The check the repository does not have today: non-degenerate bounds are not
 * enough, because a node scrolled far off the viewport still has them. The node's
 * rectangle must intersect the screen rectangle with non-zero area.
 */
export function isOnScreen(node: NodeAttributes, screen: Screen): boolean {
  if (!node.bounds) {
    return false;
  }
  const left = Math.max(node.bounds.x1, 0);
  const top = Math.max(node.bounds.y1, 0);
  const right = Math.min(node.bounds.x2, screen.width);
  const bottom = Math.min(node.bounds.y2, screen.height);
  return right > left && bottom > top;
}

export interface EvaluatedNode extends NodeAttributes {
  readonly onScreen: boolean;
  readonly rejectedBy: string | null;
}

/**
 * Candidates are the nodes the selectors picked out; each carries the state
 * predicate that rejected it. That keeps "not there", "there but disabled" and
 * "there but off-screen" apart, which a bare false cannot do.
 */
export function evaluateMatches(
  nodes: readonly NodeAttributes[],
  match: MatchPredicates,
  screen: Screen,
  options: { requireEnabled: boolean; requireOnScreen: boolean },
): { passed: boolean; candidates: EvaluatedNode[] } {
  const selectors: { name: string; test: (node: NodeAttributes) => boolean }[] = [];
  if (match.resourceId !== undefined) {
    selectors.push({ name: "resourceId", test: (node) => node.resourceId === match.resourceId });
  }
  if (match.text !== undefined) {
    selectors.push({ name: "text", test: (node) => node.text === match.text });
  }
  if (match.textPattern !== undefined) {
    const pattern = new RegExp(match.textPattern);
    selectors.push({ name: "textPattern", test: (node) => pattern.test(node.text) });
  }
  if (match.contentDesc !== undefined) {
    selectors.push({ name: "contentDesc", test: (node) => node.contentDesc === match.contentDesc });
  }
  if (match.className !== undefined) {
    selectors.push({ name: "className", test: (node) => node.className === match.className });
  }

  const state: { name: string; test: (node: NodeAttributes) => boolean }[] = [];
  if (options.requireEnabled) {
    state.push({ name: "requireEnabled", test: (node) => node.enabled });
  }
  if (options.requireOnScreen) {
    state.push({ name: "requireOnScreen", test: (node) => isOnScreen(node, screen) });
  }

  const candidates: EvaluatedNode[] = [];
  let passed = false;

  for (const node of nodes) {
    if (!selectors.every((selector) => selector.test(node))) {
      continue;
    }
    const rejectedBy = state.find((predicate) => !predicate.test(node))?.name ?? null;
    candidates.push({ ...node, onScreen: isOnScreen(node, screen), rejectedBy });
    if (rejectedBy === null) {
      passed = true;
    }
  }

  return { passed, candidates };
}

const matchSchema = z
  .object({
    resourceId: z
      .string()
      .min(1)
      .describe(
        "Exact resource-id. In a WebView this is the element's HTML id attribute, NOT its data-testid: an element " +
          "that sets only a testid cannot be addressed this way.",
      )
      .optional(),
    text: z.string().describe("Exact match on the node's whole text. Inline spans merge into the row.").optional(),
    textPattern: z
      .string()
      .min(1)
      .describe("Regular expression against text; the way to match part of a row.")
      .optional(),
    contentDesc: z.string().describe("Exact content-desc.").optional(),
    className: z.string().min(1).describe("Exact class name.").optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "match must name at least one predicate" })
  .describe("Predicates the node must satisfy. At least one is required.");

const assertSchema = z
  .object({
    targetId: targetIdSchema,
    name: z.string().min(1).describe("Artifact base name for the evidence pair."),
    match: matchSchema,
    requireEnabled: z.boolean().describe('Require enabled="true". Default true.').optional(),
    requireOnScreen: z
      .boolean()
      .describe("Require the node's bounds to intersect the screen. Default true.")
      .optional(),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .describe("Re-capture until the predicate holds. Default: one capture.")
      .optional(),
    pollIntervalMs: z.number().int().positive().describe("Interval between re-captures. Default 500.").optional(),
    runRoot: runRootSchema,
  })
  .strict();

async function runAssertion(
  args: z.infer<typeof assertSchema>,
  ctx: ToolExecutionContext,
  tool: string,
  expectPresent: boolean,
): Promise<Record<string, unknown>> {
  const handle = await resolveTarget(ctx, args.targetId);
  const requireEnabled = args.requireEnabled ?? true;
  const requireOnScreen = args.requireOnScreen ?? true;
  const deadline = Date.now() + (args.timeoutMs ?? 0);
  const pollIntervalMs = args.pollIntervalMs ?? 500;

  let outcome: { passed: boolean; candidates: EvaluatedNode[] };
  let xml: string;
  let screen: Screen;
  let attempts = 0;

  for (;;) {
    attempts += 1;
    const capture = await captureUiHierarchy(handle);
    xml = capture.xml;
    /*
     * A zero-sized screen makes every node fail requireOnScreen, which silently
     * turns assert_not_visible into "always passes" - including for the
     * error-boundary title it exists to catch. Fall back to the device's own
     * geometry, and refuse rather than guess if that is unavailable too.
     */
    screen = screenFromHierarchy(xml) ?? (await screenFromDevice(handle));
    outcome = evaluateMatches(parseNodes(xml), args.match, screen, { requireEnabled, requireOnScreen });
    const satisfied = expectPresent ? outcome.passed : !outcome.passed;
    if (satisfied || Date.now() >= deadline) {
      break;
    }
    await delay(pollIntervalMs);
  }

  const passed = expectPresent ? outcome.passed : !outcome.passed;
  const evidence = await writeEvidence(ctx, handle, tool, args.name, xml, passed, args.runRoot);

  return {
    passed,
    attempts,
    screen,
    matches: outcome.candidates,
    evidence,
  };
}

async function screenFromDevice(handle: ResolvedTargetHandle): Promise<Screen> {
  const description = await describeTarget(handle.transport, handle.target, handle.info);
  if (!description.screen.width || !description.screen.height) {
    throw new ToolExecutionError(
      `The UI hierarchy from ${handle.target.targetId} carried no bounds and the device reported no screen size, ` +
        "so visibility cannot be decided. Refusing to report an assertion result.",
      { details: { targetId: handle.target.targetId } },
    );
  }
  return { width: description.screen.width, height: description.screen.height };
}

async function writeEvidence(
  ctx: ToolExecutionContext,
  handle: ResolvedTargetHandle,
  tool: string,
  name: string,
  xml: string,
  passed: boolean,
  runRoot: string | undefined,
): Promise<Record<string, unknown>> {
  const safeName = sanitizeArtifactName(name);
  const xmlEntry = ctx.artifacts.write(tool, handle.target.targetId, "hierarchies", `${safeName}.xml`, xml, runRoot);
  if (passed) {
    return { xmlPath: xmlEntry.path, screenshotPath: null };
  }

  // A failed assertion is diagnosed from the dump plus a shot taken at the same
  // moment; capturing it later would show a different screen.
  const shot = await writeScreenshot(ctx, handle, tool, safeName, runRoot === undefined ? {} : { runRoot });
  return { xmlPath: xmlEntry.path, screenshotPath: shot["rawPath"], reviewPath: shot["reviewPath"] };
}

export const assertModule = defineToolModule({
  domain: "droid_assert",
  summary: "Visibility assertions over the UI hierarchy dump.",
  tools: [
    {
      name: "droid_assert.assert_visible",
      description:
        "Assert a node matching the predicates is present, enabled and on screen. Decided from the accessibility " +
        "hierarchy, never from image comparison. A false assertion returns passed: false with evidence, not an error.",
      argsSchema: assertSchema,
      execute: defineExecute(assertSchema, (args, ctx) => runAssertion(args, ctx, "droid_assert.assert_visible", true)),
    },
    {
      name: "droid_assert.assert_not_visible",
      description:
        "Assert no node matching the predicates is visible. The check that catches a whole-app crash is a negative " +
        "assertion on the error-boundary title, which both the application shell and the page boundary render.",
      argsSchema: assertSchema,
      execute: defineExecute(assertSchema, (args, ctx) =>
        runAssertion(args, ctx, "droid_assert.assert_not_visible", false),
      ),
    },
  ],
});
