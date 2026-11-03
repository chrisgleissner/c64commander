/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Search } from "lucide-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { t } from "@/lib/i18n";
import { requestSearchOpen } from "@/lib/search/overlayState";

/**
 * The first of search's three doors, at the top of Home (spec.md D3 and section 5.7).
 *
 * A button that looks like a field, not a field. Tapping it expands into the overlay rather than
 * searching in place, so the results get the whole screen instead of the strip left over above the
 * on-screen keyboard — and the app bar is left alone, where the title zone already wraps at the
 * smallest screen and largest text size.
 */
export const HomeSearchField = ({ scope = "home" }: { scope?: "home" | "play" } = {}) => {
  const field = (
    <button
      type="button"
      onClick={() => requestSearchOpen({ source: "home-field" })}
      data-testid="home-search-field"
      aria-label={t("search.openFromHome", "Search the app")}
      className="flex min-h-11 w-full items-center gap-2 rounded-panel border border-border bg-card px-3 text-left text-sm text-muted-foreground"
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{t("search.placeholder", "Search the app")}</span>
      <kbd className="ml-auto hidden shrink-0 rounded-sm border border-border bg-muted px-1 py-0.5 font-sans text-xs font-semibold sm:inline">
        7
      </kbd>
    </button>
  );

  if (scope === "home") {
    return (
      <section
        aria-label="Search"
        data-testid="home-search-card"
        className="rounded-card border border-border bg-card p-4 shadow-elev-1"
      >
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold">Search</h2>
            <p className="text-xs text-muted-foreground">Find a page, setting or action</p>
          </div>
        </div>
        {field}
      </section>
    );
  }

  return (
    <CollapsibleSection
      scope={scope}
      id="search"
      title="Search"
      summary="Find a page, setting or action"
      icon={Search}
      defaultOpen
      testId={`${scope}-search-card`}
    >
      <div className="p-4 pt-0">{field}</div>
    </CollapsibleSection>
  );
};
