/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useFocusItem } from "@/hooks/useFocusNavigation";
import { t } from "@/lib/i18n";

const ignoreActivation = () => {};

/**
 * Shown while a page's code loads. It is a keypad ring stop: without one, the ring fell onto the
 * Home tab for as long as the page took to load, the guidance bar said "Home", and OK went there.
 */
export const PageLoadingFallback = () => {
  const focusRef = useFocusItem<HTMLDivElement>({ id: "page-loading", order: 0, onActivate: ignoreActivation });
  return (
    <div
      ref={focusRef}
      role="status"
      tabIndex={-1}
      data-testid="page-loading"
      className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-6 py-10 text-sm text-muted-foreground outline-none"
    >
      {t("app.loadingScreen", "Loading screen...")}
    </div>
  );
};
