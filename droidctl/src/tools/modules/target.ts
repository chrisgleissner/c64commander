/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { z } from "zod";
import { describeTarget } from "../../deviceInfo.js";
import type { TransportKind } from "../../transport/types.js";
import { defineExecute, resolveTarget, targetIdSchema } from "../common.js";
import { defineToolModule } from "../types.js";

const listTargetsSchema = z
  .object({
    transports: z
      .array(z.enum(["adb", "ssh"]))
      .describe("Restrict enumeration to these transports. Omit to enumerate all registered transports.")
      .optional(),
  })
  .strict();

const describeTargetSchema = z.object({ targetId: targetIdSchema }).strict();

export const targetModule = defineToolModule({
  domain: "droid_target",
  summary: "Enumerate and describe the devices droidctl can address.",
  tools: [
    {
      name: "droid_target.list_targets",
      description:
        "List every addressable target with its transport, serial, model, API level, state and whether it is an emulator. " +
        "Returns no default, preferred or current target: pick one and pass its targetId. Offline and unauthorized " +
        "targets are listed rather than hidden, so a caller can see why its target vanished.",
      argsSchema: listTargetsSchema,
      execute: defineExecute(listTargetsSchema, async (args, ctx) => {
        const listing = await ctx.transports.list(args.transports as TransportKind[] | undefined);
        return { targets: listing.targets, transportErrors: listing.transportErrors };
      }),
    },
    {
      name: "droid_target.describe_target",
      description:
        "Describe one target: build properties, screen geometry, and any wm size or wm density override. A leftover " +
        "override from a small-screen audit fails input and clarity checks with no code fault, so it is reported here.",
      argsSchema: describeTargetSchema,
      execute: defineExecute(describeTargetSchema, async (args, ctx) => {
        const handle = await resolveTarget(ctx, args.targetId);
        const description = await describeTarget(handle.transport, handle.target, handle.info);
        return { ...description, state: handle.info.state, isEmulator: handle.info.isEmulator };
      }),
    },
  ],
});
