/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { reportUserError } from "@/lib/uiErrors";

type Props = { children: React.ReactNode; operation: string; title: string; description: string };

/**
 * Keeps a dialog whose code loads on demand from taking the app down with it.
 *
 * Without it a failed load (for example a chunk that no longer exists after a redeploy, in an old
 * tab) reaches the app-wide boundary and replaces everything with "Something went wrong". Here the
 * failure is reported once as a toast and the dialog simply does not appear.
 */
export class LazyDialogBoundary extends React.Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    reportUserError({
      operation: this.props.operation,
      title: this.props.title,
      description: this.props.description,
      error,
    });
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
