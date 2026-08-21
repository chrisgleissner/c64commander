/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { Layers } from "lucide-react";

import { CollapsibleSection } from "@/components/CollapsibleSection";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import { claimedItemsForCategory, routeAdvancedItem, type MenuHierarchy } from "@/lib/config/menuMapping";
import type { AuthoritativeConfigValueState } from "@/hooks/useAuthoritativeConfigValueState";
import { FallbackCategoryBlock } from "./FallbackCategoryBlock";
import { useConfigLeafWrite } from "./useConfigLeafWrite";

interface UnroutedCategorySectionsProps {
  /** Categories smart routing could not place on a menu page. */
  categories: string[];
  hierarchy: MenuHierarchy;
  family: string;
  authoritativeValues: AuthoritativeConfigValueState;
  markChanged: () => void;
  focusOrder: number;
}

/**
 * The category's own name as a card title, in the sentence case the menu pages use.
 *
 * Only plain Capitalised words are lowered. `SoftIEC`, `C64U`, `SID` and anything else that is not
 * simply an initial capital keeps its own casing, because those are names rather than words:
 * "Data Streams" becomes "Data streams", "SoftIEC Drive Settings" becomes "SoftIEC drive settings".
 */
const asCardTitle = (category: string): string =>
  category
    .split(" ")
    .map((word, index) => (index === 0 || !/^[A-Z][a-z]+$/.test(word) ? word : word.toLowerCase()))
    .join(" ");

const slugify = (category: string): string =>
  category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * A card per REST category the device menu does not place on a page.
 *
 * These used to share one "Advanced (REST-only) settings" card, which read as a jumble sale: on a
 * C64U it held the mouse settings, both SID sockets' filter tuning, the Soft IEC drive, the tape
 * rate and the data streams, under a heading that told a reader nothing about any of them. Routing
 * now sends everything with an aligned page to that page, and whatever is left gets a card of its
 * own, titled with the category the device itself named.
 *
 * That keeps the guarantee that matters — no setting is ever hidden — while removing the bin they
 * were hidden IN. It also needs no maintenance: a category this app has never heard of gets a
 * correctly-labelled card the first time a device reports it.
 */
export function UnroutedCategorySections({
  categories,
  hierarchy,
  family,
  authoritativeValues,
  markChanged,
  focusOrder,
}: UnroutedCategorySectionsProps) {
  const { writeLeaf } = useConfigLeafWrite(authoritativeValues, markChanged);

  return (
    <>
      {categories.map((category, index) => (
        <UnroutedCategorySection
          key={category}
          category={category}
          hierarchy={hierarchy}
          family={family}
          authoritativeValues={authoritativeValues}
          writeLeaf={writeLeaf}
          focusOrder={focusOrder + index * 2}
        />
      ))}
    </>
  );
}

function UnroutedCategorySection({
  category,
  hierarchy,
  family,
  authoritativeValues,
  writeLeaf,
  focusOrder: _focusOrder,
}: {
  category: string;
  hierarchy: MenuHierarchy;
  family: string;
  authoritativeValues: AuthoritativeConfigValueState;
  writeLeaf: ReturnType<typeof useConfigLeafWrite>["writeLeaf"];
  focusOrder: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const slug = slugify(category);
  const title = asCardTitle(category);

  return (
    <CollapsibleSection
      scope="config"
      id={`unrouted-${slug}`}
      title={title}
      icon={Layers}
      testId={`config-unrouted-${slug}`}
      toggleTestId={`config-unrouted-toggle-${slug}`}
      bodyId={`config-unrouted-body-${slug}`}
      onOpenChange={setIsOpen}
      onToggleClick={wrapUserEvent(() => undefined, "toggle", "ConfigSection", { title }, "ConfigHeader")}
    >
      <FallbackCategoryBlock
        category={category}
        claimed={claimedItemsForCategory(hierarchy, category)}
        accept={(item) => routeAdvancedItem(hierarchy, family, category, item) === null}
        active={isOpen}
        authoritativeValues={authoritativeValues}
        writeLeaf={writeLeaf}
        hideHeading
      />
    </CollapsibleSection>
  );
}
