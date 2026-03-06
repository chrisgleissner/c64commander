/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { runWithImplicitAction } from "@/lib/tracing/actionTrace";

const startupStartMs =
  typeof performance !== "undefined" && Number.isFinite(performance.now()) ? performance.now() : Date.now();

let startupBootstrapMarked = false;
let firstMeaningfulInteractionMarked = false;

const shouldSkipMeaningfulInteraction = (label: string) => {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "diagnostics" || normalized === "open diagnostics" || normalized.includes("diagnostics");
};

const elapsedSinceStartupMs = () => {
  const nowMs =
    typeof performance !== "undefined" && Number.isFinite(performance.now()) ? performance.now() : Date.now();
  return Math.max(0, Math.round(nowMs - startupStartMs));
};

const emitMilestone = (name: string, detail: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("c64u-startup-milestone", {
      detail: {
        name,
        ...detail,
      },
    }),
  );
};

export const markStartupBootstrapComplete = () => {
  if (startupBootstrapMarked) return;
  startupBootstrapMarked = true;
  const elapsedMs = elapsedSinceStartupMs();
  addLog("info", "Startup bootstrap complete", { elapsedMs });
  emitMilestone("bootstrap-complete", { elapsedMs });
  void runWithImplicitAction("startup.bootstrap_complete", async () => undefined);
};

export const markFirstMeaningfulInteraction = (action: string, label: string) => {
  if (shouldSkipMeaningfulInteraction(label)) return;
  if (firstMeaningfulInteractionMarked) return;
  firstMeaningfulInteractionMarked = true;
  const elapsedMs = elapsedSinceStartupMs();
  addLog("info", "First meaningful interaction", {
    action,
    label,
    elapsedMs,
  });
  emitMilestone("first-meaningful-interaction", {
    action,
    label,
    elapsedMs,
  });
  void runWithImplicitAction("startup.first_meaningful_interaction", async () => undefined);
};
