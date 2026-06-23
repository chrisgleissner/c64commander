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
import { ConfigLeafRow } from "./ConfigLeafRow";
import { DHCP_STATIC_FIELDS, type MenuBlockSpec } from "./menuBlocks";

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

const isDhcpEnabledValue = (value: string | number | undefined): boolean =>
  ["enabled", "on", "true", "yes", "1"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );

interface MenuBlockProps {
  block: MenuBlockSpec;
  active: boolean;
  authoritativeValues: AuthoritativeConfigValueState;
  writeLeaf: (category: string, item: string, value: string | number) => Promise<boolean>;
}

/**
 * Renders one single-category block of a menu page: lazily fetches its REST category,
 * resolves each declared leaf against live data (dropping stale pointers), and renders
 * the menu-labelled rows. Menu-only (action/status) entries render disabled. The
 * "Use DHCP" dependency is applied locally (matches the legacy CategorySection).
 */
export function MenuBlock({ block, active, authoritativeValues, writeLeaf }: MenuBlockProps) {
  const { category } = block;
  const { data, isLoading } = useC64Category(category ?? "", active && Boolean(category), BLOCK_QUERY_OPTIONS);

  const liveItems = useMemo(() => (category ? readCategoryItems(data, category) : {}), [data, category]);

  const dhcpEnabled = useMemo(() => {
    if (category !== "Ethernet Settings" && category !== "WiFi settings") return false;
    return isDhcpEnabledValue(liveItems["Use DHCP"]?.value);
  }, [category, liveItems]);

  // Resolve declared leaves against live data; drop stale pointers (never error).
  const resolved = useMemo(
    () => block.leaves.filter((leaf) => Object.prototype.hasOwnProperty.call(liveItems, leaf.item)),
    [block.leaves, liveItems],
  );

  const hasContent = resolved.length > 0 || block.menuOnly.length > 0;
  if (category && isLoading && resolved.length === 0 && block.menuOnly.length === 0) {
    return (
      <div className="py-3 text-center text-xs text-muted-foreground" data-testid="menu-block-loading">
        Loading…
      </div>
    );
  }
  if (!hasContent) return null;

  return (
    <div data-testid={block.title ? `config-subsection-${block.title.toLowerCase().replace(/\s+/g, "-")}` : undefined}>
      {block.title ? (
        <h4 className="px-1 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {block.title}
        </h4>
      ) : null}
      <div className="divide-y divide-border" data-testid="config-group-list">
        {resolved.map((leaf) => {
          const live = liveItems[leaf.item];
          const readOnly = dhcpEnabled && DHCP_STATIC_FIELDS.has(leaf.item);
          return (
            <ConfigLeafRow
              key={`${category}:${leaf.item}`}
              category={category as string}
              item={leaf.item}
              label={leaf.label}
              formatterId={leaf.formatterId}
              value={live.value}
              options={live.options}
              details={live.details}
              readOnly={readOnly}
              authoritativeValues={authoritativeValues}
              writeLeaf={writeLeaf}
            />
          );
        })}
        {block.menuOnly.map((entry) => (
          <div
            key={`menu-only-${entry.label}`}
            className="flex items-center justify-between py-3 opacity-60"
            data-testid="config-menu-only"
          >
            <span className="text-sm">{entry.label}</span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">On device</span>
          </div>
        ))}
      </div>
    </div>
  );
}
