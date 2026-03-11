/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { LogEventInput } from "../../lib/logging.js";
import type { HarnessConfig, StressBreakpointTarget } from "../../lib/config.js";
import type { SharedRestRequest } from "../../lib/restRequest.js";

type MutableScalar = string | number;

type TargetState = {
  target: StressBreakpointTarget;
  values: MutableScalar[];
  nextIndex: number;
};

export type SidVolumeBreakpointScenario = {
  id: "rest.breakpoint.sid-volume";
  mutate: (input: { clientId: string }) => Promise<void>;
  targets: StressBreakpointTarget[];
};

export async function prepareSidVolumeBreakpointScenario(input: {
  request: SharedRestRequest;
  log: (event: LogEventInput) => void;
  config: HarnessConfig;
}): Promise<SidVolumeBreakpointScenario> {
  const targets = input.config.stressBreakpoint?.targets ?? [];
  if (targets.length === 0) {
    throw new Error("stressBreakpoint.targets is required for rest.breakpoint.sid-volume");
  }

  const targetStates = await Promise.all(
    targets.map(async (target) => loadTargetState({ request: input.request, target })),
  );

  input.log({
    kind: "scenario",
    op: "rest.breakpoint.sid-volume",
    status: "ready",
    details: {
      targets: targetStates.map((state) => state.target),
    },
  });

  let mutationIndex = 0;
  return {
    id: "rest.breakpoint.sid-volume",
    targets,
    mutate: async ({ clientId }) => {
      const state = targetStates[mutationIndex % targetStates.length];
      const value = state.values[state.nextIndex % state.values.length];
      mutationIndex += 1;
      state.nextIndex = (state.nextIndex + 1) % state.values.length;

      const response = await input.request({
        method: "PUT",
        url: `/v1/configs/${encodeURIComponent(state.target.category)}/${encodeURIComponent(state.target.item)}`,
        params: { value },
        trace: {
          clientId,
          target: {
            category: state.target.category,
            item: state.target.item,
          },
        },
      });

      if (response.status !== 200) {
        throw new Error(
          `Breakpoint SID volume mutation failed for ${state.target.category} / ${state.target.item}: ${response.status}`,
        );
      }
    },
  };
}

async function loadTargetState(input: {
  request: SharedRestRequest;
  target: StressBreakpointTarget;
}): Promise<TargetState> {
  const response = await input.request({
    method: "GET",
    url: `/v1/configs/${encodeURIComponent(input.target.category)}/${encodeURIComponent(input.target.item)}`,
    trace: {
      clientId: "breakpoint-setup",
      target: {
        category: input.target.category,
        item: input.target.item,
      },
    },
  });

  if (response.status !== 200 || typeof response.data !== "object" || response.data === null) {
    throw new Error(
      `Failed to load breakpoint target ${input.target.category} / ${input.target.item}: status ${response.status}`,
    );
  }

  const categoryEntry = (response.data as Record<string, unknown>)[input.target.category];
  const itemEntry =
    categoryEntry && typeof categoryEntry === "object"
      ? ((categoryEntry as Record<string, unknown>)[input.target.item] as Record<string, unknown> | undefined)
      : undefined;

  if (!itemEntry || typeof itemEntry !== "object") {
    throw new Error(`Missing breakpoint target payload for ${input.target.category} / ${input.target.item}`);
  }

  const currentValue = readCurrentValue(itemEntry);
  const values = buildValueCycle(itemEntry, currentValue);
  if (values.length === 0) {
    throw new Error(`No valid deterministic values found for ${input.target.category} / ${input.target.item}`);
  }

  return {
    target: input.target,
    values,
    nextIndex: 0,
  };
}

function readCurrentValue(entry: Record<string, unknown>): MutableScalar | null {
  const current = entry.current ?? entry.value;
  return typeof current === "string" || typeof current === "number" ? current : null;
}

function buildValueCycle(entry: Record<string, unknown>, current: MutableScalar | null): MutableScalar[] {
  const values = normalizeValues(entry.values);
  if (values.length === 0) {
    return [];
  }

  const filtered = values.filter((value) => !Object.is(value, current));
  if (filtered.length === 0) {
    return [...values];
  }

  if (current === null) {
    return filtered;
  }

  const currentIndex = values.findIndex((value) => Object.is(value, current));
  if (currentIndex === -1) {
    return filtered;
  }

  return [...values.slice(currentIndex + 1), ...values.slice(0, currentIndex)].filter(
    (value) => !Object.is(value, current),
  );
}

function normalizeValues(values: unknown): MutableScalar[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter((value): value is MutableScalar => typeof value === "string" || typeof value === "number");
}
