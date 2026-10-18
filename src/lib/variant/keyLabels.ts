/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { variant } from "@/generated/variant";
import { isKeypadEdition } from "@/lib/docs/deviceNames";

/** Names of the physical keys and the words the guidance bar prints; see `runtime.key_labels` in variants.yaml. */
export type KeyLabels = {
  readonly leftSoft: string;
  readonly center: string;
  readonly rightSoft: string;
  readonly leftCap: string;
  readonly centerCap: string;
  readonly rightCap: string;
  readonly backWord: string;
  readonly closeWord: string;
  readonly menuWord: string;
  readonly deleteWord: string;
};

export const GENERIC_KEY_LABELS: KeyLabels = {
  leftSoft: "Back key",
  center: "OK",
  rightSoft: "Menu key",
  leftCap: "Back",
  centerCap: "OK",
  rightCap: "Menu",
  backWord: "Back",
  closeWord: "Close",
  menuWord: "Menu",
  deleteWord: "Delete",
};

export const KEYPAD_KEY_LABELS: KeyLabels = {
  ...GENERIC_KEY_LABELS,
  leftSoft: "Left Soft Key",
  center: "D-pad Center / OK",
  rightSoft: "Right Soft Key",
};

let override: Partial<KeyLabels> | null = null;

/** Replaces labels for the current session; pass null to restore the variant's own. */
export const setKeyLabelsOverride = (labels: Partial<KeyLabels> | null): void => {
  override = labels;
};

/**
 * The labels for `variantId`. The selected variant's come from the generated config. The guide
 * can also describe the other edition (tests do), which has no generated labels in this build,
 * so it gets that edition's built-in set.
 */
export const getKeyLabels = (variantId: string = variant.appId): KeyLabels => {
  const base: KeyLabels =
    variantId === variant.appId
      ? variant.runtime.keyLabels
      : isKeypadEdition(variantId)
        ? KEYPAD_KEY_LABELS
        : GENERIC_KEY_LABELS;
  return override ? { ...base, ...override } : base;
};
