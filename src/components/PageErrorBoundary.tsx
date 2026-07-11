/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";

import { Button } from "@/components/ui/button";
import { addErrorLog } from "@/lib/logging";
import { t } from "@/lib/i18n";

/**
 * Page-level error boundary for a single tab/route slot.
 *
 * A render-time exception inside one page is recoverable: the fallback exposes
 * a "Try again" button that clears the error and re-renders the child, and an
 * inactive→active transition also resets it (so swiping away and back recovers
 * the slot). `active === false` renders nothing so an errored inactive slot
 * stays invisible until it becomes active.
 *
 * HARD19-033 consolidated this single implementation; SwipeNavigationLayer used
 * to carry a divergent copy with no recovery action that told the user to reload
 * the whole app. This module is the one boundary both App.tsx and
 * SwipeNavigationLayer render (it also lives here, rather than in App.tsx, to
 * avoid an App ↔ SwipeNavigationLayer import cycle).
 */
export class PageErrorBoundary extends React.Component<
  { children: React.ReactNode; active?: boolean },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: { children: React.ReactNode; active?: boolean }) {
    if (!prevProps.active && this.props.active && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    addErrorLog("Page render error", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.active === false) {
        return null;
      }

      return (
        <div
          className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-6 py-10"
          data-testid="page-error-boundary-fallback"
        >
          <div className="max-w-sm rounded-xl border border-border bg-card p-5 text-center shadow">
            <p className="text-sm font-semibold text-foreground">{t("app.error.title", "Something went wrong")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("app.error.description", "The app hit an unexpected error. Please reopen the page or try again.")}
            </p>
            <Button size="sm" className="mt-3" onClick={() => this.setState({ hasError: false })}>
              {t("app.error.tryAgain", "Try again")}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
