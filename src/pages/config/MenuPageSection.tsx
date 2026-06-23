/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, FolderOpen, RefreshCw } from "lucide-react";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import { Button } from "@/components/ui/button";
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
  const sectionId = `config-menu-section-${slug}`;

  const handleRefresh = () => {
    for (const category of restCategories) {
      void queryClient.invalidateQueries({ queryKey: ["c64-category", category] });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl overflow-hidden"
    >
      <button
        ref={headerFocusRef}
        onClick={wrapUserEvent(
          () => setIsOpen((open) => !open),
          "toggle",
          "ConfigSection",
          { title: page.label },
          "ConfigHeader",
        )}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        data-testid={`config-menu-page-${slug}`}
        aria-expanded={isOpen}
        aria-controls={sectionId}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-col">
            {groupLabel ? (
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{groupLabel}</span>
            ) : null}
            <span className="font-medium text-sm">{page.label}</span>
          </div>
        </div>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            id={sectionId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border-t border-border px-4 pt-2 pb-3">
              <div className="flex items-center justify-end py-2" data-testid="config-group-actions">
                <Button variant="ghost" size="sm" onClick={handleRefresh} className="text-xs">
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
                  <h4 className="px-1 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
