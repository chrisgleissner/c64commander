/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { LucideIcon } from "lucide-react";
import type { FeatureFlags } from "@/lib/config/featureFlags";

/**
 * Guide text marks an on-screen label as `**Label**` and a key as `` `key` ``; nothing else is
 * markup. Keeping the chapters as plain strings lets the tests read every word a user will see.
 */
export type GuideText = string;

export interface GuideKey {
  readonly key: GuideText;
  readonly action: GuideText;
}

export type GuideBlock =
  | { readonly kind: "text"; readonly text: GuideText }
  | { readonly kind: "steps"; readonly heading?: string; readonly items: readonly GuideText[] }
  | { readonly kind: "keys"; readonly heading?: string; readonly items: readonly GuideKey[] }
  | { readonly kind: "tip"; readonly text: GuideText };

export interface GuideChapter {
  /** Also the CollapsibleSection id in scope `docs`, so search entries can address it. */
  readonly id: string;
  readonly title: string;
  /** The chapter's name in the contents list, one line on a 320 px row. */
  readonly navLabel: string;
  readonly icon: LucideIcon;
  readonly blocks: readonly GuideBlock[];
}

export interface GuideContext {
  readonly variantId: string;
  readonly flags: Partial<FeatureFlags>;
}
