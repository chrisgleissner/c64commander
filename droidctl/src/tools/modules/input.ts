/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { z } from "zod";
import { describeTarget } from "../../deviceInfo.js";
import { resolveKeycode } from "../../keycodes.js";
import type { ResolvedTargetHandle } from "../../transport/registry.js";
import { ToolExecutionError, ToolValidationError } from "../errors.js";
import { defineExecute, expectSuccess, resolveTarget, targetIdField, targetIdSchema } from "../common.js";
import { defineToolModule } from "../types.js";

const unitsField = {
  type: "string",
  enum: ["physical", "css"],
  description:
    "Coordinate space. adb input speaks physical pixels while the DOM speaks CSS pixels; with css the server " +
    "multiplies by dpr once, instead of each caller doing it.",
} as const;

const tapSchema = z
  .object({
    targetId: targetIdSchema,
    x: z.number(),
    y: z.number(),
    units: z.enum(["physical", "css"]).optional(),
    dpr: z.number().positive().optional(),
    hold: z.number().int().positive().optional(),
  })
  .strict();

const swipeSchema = z
  .object({
    targetId: targetIdSchema,
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    durationMs: z.number().int().positive().optional(),
    units: z.enum(["physical", "css"]).optional(),
    dpr: z.number().positive().optional(),
  })
  .strict();

const typeTextSchema = z.object({ targetId: targetIdSchema, text: z.string().min(1) }).strict();

const pressKeySchema = z
  .object({
    targetId: targetIdSchema,
    keycode: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    longPress: z.boolean().optional(),
    repeat: z.number().int().positive().optional(),
  })
  .strict();

export interface ScreenRect {
  readonly width: number;
  readonly height: number;
}

export function convertCoordinate(
  value: number,
  units: "physical" | "css" | undefined,
  dpr: number | undefined,
): number {
  if (units !== "css") {
    return Math.round(value);
  }
  if (dpr === undefined) {
    throw new ToolValidationError('units: "css" requires dpr, which droid_target.describe_target reports.');
  }
  return Math.round(value * dpr);
}

export function assertOnScreen(points: readonly { x: number; y: number }[], screen: ScreenRect): void {
  const offScreen = points.filter(
    (point) => point.x < 0 || point.y < 0 || point.x >= screen.width || point.y >= screen.height,
  );
  if (offScreen.length > 0) {
    throw new ToolValidationError(
      `Coordinates ${JSON.stringify(offScreen)} fall outside the ${screen.width}x${screen.height} screen. An ` +
        "off-screen injection does nothing and reads downstream as an application fault, so it is refused here.",
      { details: { offScreen, screen } },
    );
  }
}

async function screenOf(handle: ResolvedTargetHandle): Promise<ScreenRect> {
  const description = await describeTarget(handle.transport, handle.target, handle.info);
  if (description.screen.width === null || description.screen.height === null) {
    throw new ToolExecutionError(
      `Unable to read the screen size of ${handle.target.targetId}; refusing to inject input.`,
      {
        details: { targetId: handle.target.targetId },
      },
    );
  }
  return { width: description.screen.width, height: description.screen.height };
}

export const inputModule = defineToolModule({
  domain: "droid_input",
  summary: "Inject taps, swipes, text and key events.",
  tools: [
    {
      name: "droid_input.tap",
      description:
        "Tap at a point, or press and hold when hold is given. A hold uses motionevent DOWN/UP with an explicit " +
        "release rather than input tap, because the application treats a tap and a hold as different gestures.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          x: { type: "number" },
          y: { type: "number" },
          units: unitsField,
          dpr: { type: "number", description: "Device pixel ratio. Required when units is css." },
          hold: { type: "number", description: "Hold duration in milliseconds. Omit for a plain tap." },
        },
        required: ["targetId", "x", "y"],
        additionalProperties: false,
      },
      argsSchema: tapSchema,
      execute: defineExecute(tapSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const x = convertCoordinate(args.x, args.units, args.dpr);
        const y = convertCoordinate(args.y, args.units, args.dpr);
        const screen = await screenOf(handle);
        assertOnScreen([{ x, y }], screen);

        if (args.hold === undefined) {
          const result = await handle.transport.exec(handle.target, ["input", "tap", String(x), String(y)]);
          expectSuccess(result, `input tap ${x} ${y}`);
          return { tapped: true, x, y, holdMs: null };
        }

        const down = await handle.transport.exec(handle.target, ["input", "motionevent", "DOWN", String(x), String(y)]);
        expectSuccess(down, `input motionevent DOWN ${x} ${y}`);
        await new Promise((resolve) => setTimeout(resolve, args.hold));
        const up = await handle.transport.exec(handle.target, ["input", "motionevent", "UP", String(x), String(y)]);
        expectSuccess(up, `input motionevent UP ${x} ${y}`);
        return { tapped: true, x, y, holdMs: args.hold };
      }),
    },
    {
      name: "droid_input.swipe",
      description: "Swipe between two points over a duration.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          x1: { type: "number" },
          y1: { type: "number" },
          x2: { type: "number" },
          y2: { type: "number" },
          durationMs: { type: "number", description: "Swipe duration in milliseconds. Default 250." },
          units: unitsField,
          dpr: { type: "number", description: "Device pixel ratio. Required when units is css." },
        },
        required: ["targetId", "x1", "y1", "x2", "y2"],
        additionalProperties: false,
      },
      argsSchema: swipeSchema,
      execute: defineExecute(swipeSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const x1 = convertCoordinate(args.x1, args.units, args.dpr);
        const y1 = convertCoordinate(args.y1, args.units, args.dpr);
        const x2 = convertCoordinate(args.x2, args.units, args.dpr);
        const y2 = convertCoordinate(args.y2, args.units, args.dpr);
        const screen = await screenOf(handle);
        assertOnScreen(
          [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ],
          screen,
        );

        const durationMs = args.durationMs ?? 250;
        const result = await handle.transport.exec(handle.target, [
          "input",
          "swipe",
          String(x1),
          String(y1),
          String(x2),
          String(y2),
          String(durationMs),
        ]);
        expectSuccess(result, `input swipe ${x1} ${y1} ${x2} ${y2}`);
        return { swiped: true, from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, durationMs };
      }),
    },
    {
      name: "droid_input.type_text",
      description: "Type text through adb input text. The keypad target has no IME, so prefer press_key there.",
      inputSchema: {
        type: "object",
        properties: { targetId: targetIdField, text: { type: "string" } },
        required: ["targetId", "text"],
        additionalProperties: false,
      },
      argsSchema: typeTextSchema,
      execute: defineExecute(typeTextSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const result = await handle.transport.exec(handle.target, ["input", "text", args.text]);
        expectSuccess(result, "input text");
        return { typed: true, characters: args.text.length };
      }),
    },
    {
      name: "droid_input.press_key",
      description:
        "Send a key event. keycode accepts an Android name such as KEYCODE_DPAD_DOWN or a number; the table is served " +
        "as the droidctl://reference/keycodes resource. This is the primary input tool on a keypad-only target.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: targetIdField,
          keycode: {
            anyOf: [{ type: "number" }, { type: "string" }],
            description: "Android keycode number or KEYCODE_ name.",
          },
          longPress: { type: "boolean", description: "Send with --longpress." },
          repeat: { type: "number", description: "Send the key this many times. Default 1." },
        },
        required: ["targetId", "keycode"],
        additionalProperties: false,
      },
      argsSchema: pressKeySchema,
      execute: defineExecute(pressKeySchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const keycode = resolveKeycode(args.keycode);
        const repeat = args.repeat ?? 1;
        const argv = ["input", "keyevent", ...(args.longPress ? ["--longpress"] : []), String(keycode)];
        for (let index = 0; index < repeat; index += 1) {
          const result = await handle.transport.exec(handle.target, argv);
          expectSuccess(result, `input keyevent ${keycode}`);
        }
        return { pressed: true, keycode, repeat, longPress: args.longPress === true };
      }),
    },
  ],
});
