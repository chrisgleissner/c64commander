/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore, type ReactNode } from "react";

import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { cn } from "@/lib/utils";
import { loadShowSectionDescriptions, subscribeShowSectionDescriptions } from "@/lib/ui/collapsibleSectionStore";

/** Whether secondary explanatory text is shown. See the store for why it is off by default. */
export const useShowDescriptions = (): boolean =>
  useSyncExternalStore(subscribeShowSectionDescriptions, loadShowSectionDescriptions, () => false);

/**
 * A line of secondary text explaining a control, hidden on the smallest screen unless asked for.
 *
 * These are the sentences under a label — "Manage devices here. Long press the header badge to
 * switch quickly." On a 320 CSS px column that one wraps to five lines and takes 40% of the
 * scrollable height to explain a control whose own label already names it. Settings renders around
 * sixty of them.
 *
 * Only the compact profile hides them: on a phone-sized screen they cost a line or two and earn it.
 * The same "Card descriptions" setting that shows card summaries brings them back.
 */
export const HelperText = ({ children, className }: { children: ReactNode; className?: string }) => {
  const show = useShowDescriptions();
  const { profile } = useDisplayProfile();
  const compact = profile === "compact";
  if (compact && !show) return null;
  return <p className={cn("text-xs leading-snug text-muted-foreground", className)}>{children}</p>;
};
