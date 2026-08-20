/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { Layers } from "lucide-react";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import { CollapsibleSection } from "@/components/CollapsibleSection";
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
    <CollapsibleSection
      scope="config"
      id="advanced-fallback"
      title="Advanced (REST-only) settings"
      summary="Everything not on a menu page"
      icon={Layers}
      testId="config-advanced-fallback"
      toggleTestId="config-advanced-fallback-toggle"
      bodyId={sectionId}
      onOpenChange={setIsOpen}
      onToggleClick={wrapUserEvent(
        () => undefined,
        "toggle",
        "ConfigSection",
        { title: "Advanced (REST-only) settings" },
        "ConfigHeader",
      )}
    >
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
    </CollapsibleSection>
  );
}
