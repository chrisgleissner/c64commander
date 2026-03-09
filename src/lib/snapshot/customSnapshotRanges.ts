/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MemoryRange } from "./snapshotTypes";

export type CustomSnapshotRangeDraft = {
  start: string;
  end: string;
};

export type CustomSnapshotRangeValidationResult =
  | {
      ok: true;
      ranges: MemoryRange[];
    }
  | {
      ok: false;
      title: string;
      description: string;
    };

export const EMPTY_CUSTOM_SNAPSHOT_RANGE_DRAFT: CustomSnapshotRangeDraft = {
  start: "",
  end: "",
};

const HEX_RE = /^[0-9A-F]{1,4}$/;

export const sanitizeHexAddressInput = (raw: string): string =>
  raw
    .replace(/\$/g, "")
    .replace(/[^0-9a-f]/gi, "")
    .toUpperCase()
    .slice(0, 4);

export const normalizeCustomSnapshotRangeDraft = (
  draft: Partial<CustomSnapshotRangeDraft>,
): CustomSnapshotRangeDraft => ({
  start: sanitizeHexAddressInput(draft.start ?? ""),
  end: sanitizeHexAddressInput(draft.end ?? ""),
});

export const parseHexAddress = (raw: string): number | null => {
  const cleaned = sanitizeHexAddressInput(raw);
  if (!HEX_RE.test(cleaned)) return null;
  return parseInt(cleaned, 16);
};

export const validateCustomSnapshotRanges = (
  drafts: CustomSnapshotRangeDraft[],
): CustomSnapshotRangeValidationResult => {
  const parsedRanges = drafts.map((draft, index) => {
    const start = parseHexAddress(draft.start);
    const end = parseHexAddress(draft.end);
    return {
      index,
      start,
      end,
    };
  });

  const invalidAddress = parsedRanges.find((range) => range.start === null || range.end === null);
  if (invalidAddress) {
    return {
      ok: false,
      title: "Invalid address",
      description: `Range ${invalidAddress.index + 1} must use 1-4 hex digits.`,
    };
  }

  const reversedRange = parsedRanges.find((range) => range.end < range.start);
  if (reversedRange) {
    return {
      ok: false,
      title: "Invalid range",
      description: `Range ${reversedRange.index + 1} end address must be \u2265 start address.`,
    };
  }

  const sorted = parsedRanges
    .map((range) => ({
      index: range.index,
      start: range.start as number,
      end: range.end as number,
    }))
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start <= sorted[i - 1].end) {
      return {
        ok: false,
        title: "Overlapping ranges",
        description: "Custom ranges must not overlap.",
      };
    }
  }

  return {
    ok: true,
    ranges: parsedRanges.map((range) => ({
      start: range.start as number,
      length: (range.end as number) - (range.start as number) + 1,
    })),
  };
};
