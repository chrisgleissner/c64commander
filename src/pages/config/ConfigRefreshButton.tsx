/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { forwardRef, type Ref } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export const ConfigRefreshButton = forwardRef<
  HTMLButtonElement,
  { categoryLabel: string; slug: string; onRefresh: () => void }
>(({ categoryLabel, slug, onRefresh }, ref) => (
  <Button
    ref={ref}
    variant="ghost"
    size="icon"
    onClick={onRefresh}
    className="size-11 shrink-0"
    aria-label="Refresh"
    title={`Refresh ${categoryLabel}`}
    data-testid={`config-refresh-${slug}`}
  >
    <RefreshCw className="h-4 w-4" />
  </Button>
));
ConfigRefreshButton.displayName = "ConfigRefreshButton";

export const configRefreshAction = (
  isOpen: boolean,
  buttonRef: Ref<HTMLButtonElement>,
  categoryLabel: string,
  slug: string,
  onRefresh: () => void,
) =>
  isOpen ? (
    <ConfigRefreshButton ref={buttonRef} categoryLabel={categoryLabel} slug={slug} onRefresh={onRefresh} />
  ) : undefined;
