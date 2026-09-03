/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from "@capacitor/core";
import { getActiveAction } from "@/lib/tracing/actionTrace";
import { resolveNativeTraceContext, type NativeTraceContext } from "@/lib/native/nativeTraceContext";

/**
 * Keeps the process alive and the CPU awake while the HVSC library is installed (HARD27-028).
 *
 * Separate from `BackgroundExecution` because that service is declared `mediaPlayback`, owns a
 * MediaSession and publishes now-playing metadata; a file transfer is a `dataSync` foreground
 * service with none of that. See DECISIONS.md D-27.
 */
export type LibraryInstallPlugin = {
  start: (options?: { traceContext?: NativeTraceContext }) => Promise<void>;
  stop: (options?: { traceContext?: NativeTraceContext }) => Promise<void>;
};

const plugin = registerPlugin<LibraryInstallPlugin>("LibraryInstall");

export const LIBRARY_INSTALL_PLUGIN_NAME = "LibraryInstall";

export const LibraryInstall: LibraryInstallPlugin = {
  start: (options) => plugin.start({ ...options, traceContext: resolveNativeTraceContext(getActiveAction()) }),
  stop: (options) => plugin.stop({ ...options, traceContext: resolveNativeTraceContext(getActiveAction()) }),
};
