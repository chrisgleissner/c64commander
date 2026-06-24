/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface BaselineState {
  capturedAt: string;
  appState: Record<string, unknown>;
  savedDeviceState: Record<string, unknown>;
  settings: Record<string, unknown>;
  playlistState: Record<string, unknown>;
  diskLibraryState: Record<string, unknown>;
  playbackState: Record<string, unknown>;
  driveState: Record<string, unknown>;
  c64ConfigState: Record<string, unknown>;
}

export interface MutationLedgerEntry {
  mutationId: string;
  caseId: string;
  route: string;
  controlFingerprint: string;
  originalValue: unknown;
  newValue: unknown;
  mutationMethod: string;
  expectedEffect: string;
  observedEffect?: string;
  restorationMethod: string;
  restorationResult?: string;
  restored: boolean;
  recordedAt: string;
}

export interface StateLedger {
  baseline: BaselineState;
  mutations: MutationLedgerEntry[];
}

export function createBaselineState(input: Partial<BaselineState> = {}): BaselineState {
  return {
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    appState: input.appState ?? {},
    savedDeviceState: input.savedDeviceState ?? {},
    settings: input.settings ?? {},
    playlistState: input.playlistState ?? {},
    diskLibraryState: input.diskLibraryState ?? {},
    playbackState: input.playbackState ?? {},
    driveState: input.driveState ?? {},
    c64ConfigState: input.c64ConfigState ?? {},
  };
}

export function appendMutation(ledger: StateLedger, entry: Omit<MutationLedgerEntry, "recordedAt"> & { recordedAt?: string }): StateLedger {
  return {
    baseline: ledger.baseline,
    mutations: [
      ...ledger.mutations,
      {
        ...entry,
        recordedAt: entry.recordedAt ?? new Date().toISOString(),
      },
    ],
  };
}

export function unrestoredMutations(ledger: StateLedger): MutationLedgerEntry[] {
  return ledger.mutations.filter((entry) => !entry.restored);
}
