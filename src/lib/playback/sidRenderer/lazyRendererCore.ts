/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SidRendererCore } from "./sidRendererContract";

/**
 * A renderer core whose code is imported on first use, so a renderer that only some platforms run
 * stays out of the startup bundle.
 *
 * The import starts with the first call and every call waits for it; a failed import fails that
 * call and the next one tries again. A core disposed before its code arrives is disposed as soon as
 * it does, so nothing it creates outlives the channel that asked for it.
 */
export const lazyRendererCore = (loadCore: () => Promise<SidRendererCore>): SidRendererCore => {
  let loading: Promise<SidRendererCore> | null = null;
  let loaded: SidRendererCore | null = null;
  let disposed = false;
  const core = (): Promise<SidRendererCore> => {
    loading ??= loadCore().then(
      (created) => {
        loaded = created;
        if (disposed) created.dispose();
        return created;
      },
      (error: unknown) => {
        loading = null;
        throw new Error(`Loading the SID renderer failed: ${(error as Error)?.message ?? String(error)}`, {
          cause: error,
        });
      },
    );
    return loading;
  };
  return {
    load: async (options) => (await core()).load(options),
    open: async (request) => (await core()).open(request),
    render: async (seconds) => (await core()).render(seconds),
    seek: async (positionSeconds) => (await core()).seek(positionSeconds),
    prerender: async (request, onSlice, isSuperseded) => (await core()).prerender(request, onSlice, isSuperseded),
    close: async () => (await core()).close(),
    dispose: () => {
      disposed = true;
      loaded?.dispose();
    },
  };
};
