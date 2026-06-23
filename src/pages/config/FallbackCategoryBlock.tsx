/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import { useC64Category, VISIBLE_C64_QUERY_OPTIONS } from "@/hooks/useC64Connection";
import type { AuthoritativeConfigValueState } from "@/hooks/useAuthoritativeConfigValueState";
import { BACKGROUND_REQUEST_TIMEOUT_MS } from "@/lib/c64api";
import type { ConfigCategory, ConfigResponse } from "@/lib/c64api";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { humanizeRestName, resolveOverlayEntry } from "@/lib/config/menuMapping";
import { ConfigLeafRow } from "./ConfigLeafRow";

const BLOCK_QUERY_OPTIONS = { ...VISIBLE_C64_QUERY_OPTIONS, timeoutMs: BACKGROUND_REQUEST_TIMEOUT_MS };

const readCategoryItems = (data: ConfigResponse | undefined, category: string) => {
  if (!data) return {} as Record<string, ReturnType<typeof normalizeConfigItem>>;
  const catData = data[category] as ConfigCategory | undefined;
  if (!catData || typeof catData !== "object" || Array.isArray(catData)) return {};
  const itemsData = (catData as ConfigCategory & { items?: ConfigCategory }).items ?? catData;
  const out: Record<string, ReturnType<typeof normalizeConfigItem>> = {};
  for (const [name, config] of Object.entries(itemsData)) {
    if (name === "errors") continue;
    out[name] = normalizeConfigItem(config);
  }
  return out;
};

interface FallbackCategoryBlockProps {
  category: string;
  /** REST items already claimed by the menu hierarchy for this category (filtered out). */
  claimed: Set<string>;
  active: boolean;
  authoritativeValues: AuthoritativeConfigValueState;
  writeLeaf: (category: string, item: string, value: string | number) => Promise<boolean>;
  /** Extra filter on top of `!claimed` — used to scope items by smart-routing target. */
  accept?: (item: string) => boolean;
}

/**
 * Renders the leftover items of one live REST category — live items the hierarchy did
 * NOT claim (`live − claimed`), further filtered by `accept`. Used both for a menu
 * page's smart-routed "Advanced" sub-section (accept = routes-to-this-page) and for the
 * residual Advanced section (accept = routes-nowhere). Self-hides when it has no items.
 * Computed purely from live data; Layer A relabels where shared, else humanizes.
 */
export function FallbackCategoryBlock({
  category,
  claimed,
  active,
  authoritativeValues,
  writeLeaf,
  accept,
}: FallbackCategoryBlockProps) {
  const { data } = useC64Category(category, active, BLOCK_QUERY_OPTIONS);
  const liveItems = useMemo(() => readCategoryItems(data, category), [data, category]);

  const leftover = useMemo(
    () => Object.keys(liveItems).filter((item) => !claimed.has(item) && (accept ? accept(item) : true)),
    [liveItems, claimed, accept],
  );

  if (leftover.length === 0) return null;

  return (
    <div data-testid={`config-fallback-category-${category.toLowerCase().replace(/\s+/g, "-")}`}>
      <h4 className="px-1 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {category}
      </h4>
      <div className="divide-y divide-border" data-testid="config-group-list">
        {leftover.map((item) => {
          const overlay = resolveOverlayEntry(category, item);
          const live = liveItems[item];
          return (
            <ConfigLeafRow
              key={`${category}:${item}`}
              category={category}
              item={item}
              label={overlay?.label ?? humanizeRestName(item)}
              formatterId={overlay?.formatterId}
              value={live.value}
              options={live.options}
              details={live.details}
              authoritativeValues={authoritativeValues}
              writeLeaf={writeLeaf}
            />
          );
        })}
      </div>
    </div>
  );
}
