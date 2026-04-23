/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import {
  EMPTY_CUSTOM_SNAPSHOT_RANGE_DRAFT,
  normalizeCustomSnapshotRangeDraft,
  type CustomSnapshotRangeDraft,
} from "./customSnapshotRanges";

const CUSTOM_SNAPSHOT_DRAFTS_KEY = "c64u_custom_snapshot_ranges:v1";

const buildDefaultDrafts = (): CustomSnapshotRangeDraft[] => [{ ...EMPTY_CUSTOM_SNAPSHOT_RANGE_DRAFT }];

const isValidDraft = (value: unknown): value is CustomSnapshotRangeDraft => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.start === "string" && typeof candidate.end === "string";
};

export const loadCustomSnapshotDrafts = (): CustomSnapshotRangeDraft[] => {
  if (typeof localStorage === "undefined") return buildDefaultDrafts();
  const raw = localStorage.getItem(CUSTOM_SNAPSHOT_DRAFTS_KEY);
  if (!raw) return buildDefaultDrafts();

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      addErrorLog("Invalid custom snapshot draft payload", {
        payloadType: typeof parsed,
      });
      return buildDefaultDrafts();
    }

    const drafts = parsed.filter(isValidDraft).map(normalizeCustomSnapshotRangeDraft);
    if (drafts.length === 0) {
      addErrorLog("Custom snapshot draft payload contained no valid ranges", {
        rangeCount: parsed.length,
      });
      return buildDefaultDrafts();
    }
    return drafts;
  } catch (error) {
    addErrorLog("Failed to parse custom snapshot drafts", {
      error: (error as Error).message,
    });
    return buildDefaultDrafts();
  }
};

export const saveCustomSnapshotDrafts = (drafts: CustomSnapshotRangeDraft[]) => {
  if (typeof localStorage === "undefined") return;
  const normalizedDrafts = drafts.length > 0 ? drafts.map(normalizeCustomSnapshotRangeDraft) : buildDefaultDrafts();
  localStorage.setItem(CUSTOM_SNAPSHOT_DRAFTS_KEY, JSON.stringify(normalizedDrafts));
};
