/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, RefreshCw } from "lucide-react";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import type { AuthoritativeConfigValueState } from "@/hooks/useAuthoritativeConfigValueState";
import {
  advancedCategoriesForPage,
  claimedItemsForCategory,
  routeAdvancedItem,
  type MenuHierarchy,
  type MenuNode,
} from "@/lib/config/menuMapping";
import { buildMenuBlocks } from "./menuBlocks";
import { MenuBlock } from "./MenuBlock";
import { FallbackCategoryBlock } from "./FallbackCategoryBlock";
import { useConfigLeafWrite } from "./useConfigLeafWrite";

interface MenuPageSectionProps {
  page: MenuNode;
  groupLabel: string | null;
  hierarchy: MenuHierarchy;
  family: string;
  authoritativeValues: AuthoritativeConfigValueState;
  markChanged: () => void;
  focusOrder: number;
}

/**
 * A menu page rendered as a collapsible. Its body is a list of single-category blocks
 * (intro group + one per section), each lazily fetching its REST category on expand. A
 * single page may therefore read from several REST categories (e.g. "LED lighting" pulls
 * U64 Specific Settings + LED Strip Settings + Keyboard Lighting), preserving the lazy,
 * routing-epoch-keyed fetch behavior. All edits keep the canonical REST `{category,item}`.
 */
export function MenuPageSection({
  page,
  groupLabel,
  hierarchy,
  family,
  authoritativeValues,
  markChanged,
  focusOrder,
}: MenuPageSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const { writeLeaf } = useConfigLeafWrite(authoritativeValues, markChanged);

  const blocks = useMemo(() => buildMenuBlocks(page), [page]);
  // Categories whose unclaimed (advanced/REST-only) items smart-route ONTO this page.
  const advancedCategories = useMemo(
    () => advancedCategoriesForPage(hierarchy, family, page.label),
    [hierarchy, family, page.label],
  );
  const restCategories = useMemo(
    () =>
      Array.from(new Set(blocks.map((block) => block.category).filter((category): category is string => !!category))),
    [blocks],
  );

  const slug = page.label.toLowerCase().replace(/\s+/g, "-");
  const headerFocusRef = useFocusItem<HTMLButtonElement>({
    id: `config-menu-page-${slug}`,
    order: focusOrder,
    group: "config-categories",
  });
  // The Refresh CTA only exists while the page is open, so (like the legacy
  // CategorySection) register it under the actions group only then — an empty id
  // opts out when collapsed. Keeps keypad/D-pad/T9 users able to reach Refresh.
  const refreshFocusRef = useFocusItem<HTMLButtonElement>({
    id: isOpen ? `config-refresh-${slug}` : "",
    order: focusOrder + 2,
    group: "config-group-actions",
  });
  const sectionId = `config-menu-section-${slug}`;

  // Every REST category whose values are rendered on this page: the block categories
  // plus the advanced categories whose unclaimed items smart-route onto this page.
  const renderedCategories = useMemo(
    () => Array.from(new Set([...restCategories, ...advancedCategories])),
    [restCategories, advancedCategories],
  );

  const handleRefresh = () => {
    for (const category of renderedCategories) {
      void queryClient.invalidateQueries({ queryKey: ["c64-category", category] });
      // Refresh is an explicit "re-sync from device truth": drop the page-shared
      // optimistic pins for this category so a value changed out-of-band reconciles
      // to the device value instead of staying latched (a pin would never echo its
      // pinned value back through a Refresh, which fetches the device's value). The
      // store is page-scoped (canonical `category::item` keys), so clear per category
      // — `restCategories` is plural because one menu page reads several (BUG-033).
      authoritativeValues.clearMatching(`${category}::`);
    }
  };

  return (
    <CollapsibleSection
      scope="config"
      id={slug}
      title={page.label}
      summary={groupLabel ?? undefined}
      icon={FolderOpen}
      headerRef={headerFocusRef}
      toggleTestId={`config-menu-page-${slug}`}
      bodyId={sectionId}
      onOpenChange={setIsOpen}
      onToggleClick={wrapUserEvent(() => undefined, "toggle", "ConfigSection", { title: page.label }, "ConfigHeader")}
    >
      <div className="flex items-center justify-end py-2" data-testid="config-group-actions">
        <Button ref={refreshFocusRef} variant="ghost" size="sm" onClick={handleRefresh} className="text-xs">
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh
        </Button>
      </div>
      {blocks.map((block) => (
        <MenuBlock
          key={block.key}
          block={block}
          active={isOpen}
          authoritativeValues={authoritativeValues}
          writeLeaf={writeLeaf}
        />
      ))}
      {advancedCategories.length > 0 ? (
        <div data-testid={`config-page-advanced-${slug}`}>
          <h4 className="px-1 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
            Advanced
          </h4>
          {advancedCategories.map((category) => (
            <FallbackCategoryBlock
              key={`advanced:${category}`}
              category={category}
              claimed={claimedItemsForCategory(hierarchy, category)}
              accept={(item) => routeAdvancedItem(hierarchy, family, category, item) === page.label}
              active={isOpen}
              authoritativeValues={authoritativeValues}
              writeLeaf={writeLeaf}
            />
          ))}
        </div>
      ) : null}
    </CollapsibleSection>
  );
}
