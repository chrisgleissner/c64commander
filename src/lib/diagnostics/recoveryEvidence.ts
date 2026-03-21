/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ContributorKey } from "@/lib/diagnostics/healthModel";

const MAX_RECOVERY_EVENTS = 500;

export type RecoveryEventKind = "retry-connection" | "switch-device" | "health-check";
export type RecoveryEventOutcome = "success" | "failure";

export type RecoveryEvidenceEvent = {
  id: string;
  timestamp: string;
  kind: RecoveryEventKind;
  outcome: RecoveryEventOutcome;
  contributor: ContributorKey;
  target: string;
  message: string;
};

const events: RecoveryEvidenceEvent[] = [];
let recoveryEventSequence = 0;

const nextRecoveryEventId = () => {
  recoveryEventSequence += 1;
  return `recovery-${recoveryEventSequence.toString().padStart(4, "0")}`;
};

export const recordRecoveryEvidence = (
  event: Omit<RecoveryEvidenceEvent, "id" | "timestamp"> & { timestamp?: string },
): RecoveryEvidenceEvent => {
  const next: RecoveryEvidenceEvent = {
    id: nextRecoveryEventId(),
    timestamp: event.timestamp ?? new Date().toISOString(),
    kind: event.kind,
    outcome: event.outcome,
    contributor: event.contributor,
    target: event.target,
    message: event.message,
  };
  if (events.length >= MAX_RECOVERY_EVENTS) {
    events.shift();
  }
  events.push(next);
  return next;
};

export const getRecoveryEvidence = (): Readonly<RecoveryEvidenceEvent[]> => [...events];

export const clearRecoveryEvidence = (): void => {
  events.splice(0);
};
