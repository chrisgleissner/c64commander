/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Layers } from "lucide-react";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import type { AuthoritativeConfigValueState } from "@/hooks/useAuthoritativeConfigValueState";
import { claimedItemsForCategory, routeAdvancedItem, type MenuHierarchy } from "@/lib/config/menuMapping";
import { FallbackCategoryBlock } from "./FallbackCategoryBlock";
import { useConfigLeafWrite } from "./useConfigLeafWrite";

interface AdvancedFallbackSectionProps {
  /** Residual categories only — those whose items smart-routing could not place on a
   * menu page (unknown/future categories with no owner, keyword, or default). */
  categories: string[];
  hierarchy: MenuHierarchy;
  family: string;
  authoritativeValues: AuthoritativeConfigValueState;
  markChanged: () => void;
  focusOrder: number;
}

/**
 * Residual "Advanced (REST-only) settings" — the device-universal safety net AFTER smart
 * routing has dissolved everything it can onto aligned menu pages. It renders ONLY the
 * homeless leftovers (items that route nowhere — an unknown/future category with no owner,
 * keyword, or default), so it never reads as a junk drawer. `ConfigBrowserPage` omits it
 * entirely when there are no such residual categories. Lazily fetched on expand.
 */
export function AdvancedFallbackSection({
  categories,
  hierarchy,
  family,
  authoritativeValues,
  markChanged,
  focusOrder: _focusOrder,
}: AdvancedFallbackSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { writeLeaf } = useConfigLeafWrite(authoritativeValues, markChanged);
  const sectionId = "config-advanced-fallback-body";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl overflow-hidden"
      data-testid="config-advanced-fallback"
    >
      <button
        onClick={wrapUserEvent(
          () => setIsOpen((open) => !open),
          "toggle",
          "ConfigSection",
          { title: "Advanced (REST-only) settings" },
          "ConfigHeader",
        )}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        data-testid="config-advanced-fallback-toggle"
        aria-expanded={isOpen}
        aria-controls={sectionId}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <Layers className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="font-medium text-sm">Advanced (REST-only) settings</span>
            <span className="text-[11px] text-muted-foreground">Everything not on a menu page</span>
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
              {categories.map((category) => (
                <FallbackCategoryBlock
                  key={category}
                  category={category}
                  claimed={claimedItemsForCategory(hierarchy, category)}
                  accept={(item) => routeAdvancedItem(hierarchy, family, category, item) === null}
                  active={isOpen}
                  authoritativeValues={authoritativeValues}
                  writeLeaf={writeLeaf}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
