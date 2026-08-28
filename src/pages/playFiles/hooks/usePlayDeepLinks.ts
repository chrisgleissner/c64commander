/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { transportCommandBus, type TransportCommand } from "@/lib/input/latchedCommandBus";

/**
 * What Home's tiles and the search overlay send Play here to do (spec.md sections 6.3 and 9.5).
 *
 * They navigate with a parameter rather than hoisting the station launcher, the archive search or
 * the transport into a provider. `useSidRadio` produces items into this page's playback engine, and
 * a second owner of that transport is how two stations end up running at once.
 *
 * The parameter is consumed once and then stripped from the URL, so a back-navigation to Play does
 * not reopen the sheet the user already dismissed.
 */

export interface PlayDeepLinkHandlers {
  readonly openRadioLauncher: () => void;
  readonly openRecentlyPlayed: () => void;
  readonly openFindATune: () => void;
  readonly openLikedTunes: () => void;
  readonly resumeSession: () => void;
}

const PARAM_TO_HANDLER: Readonly<Record<string, keyof PlayDeepLinkHandlers>> = {
  radio: "openRadioLauncher",
  recent: "openRecentlyPlayed",
  find: "openFindATune",
  liked: "openLikedTunes",
  resume: "resumeSession",
};

export const usePlayDeepLinks = (handlers: PlayDeepLinkHandlers): void => {
  const location = useLocation();
  const navigate = useNavigate();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (location.search === "") return;
    const params = new URLSearchParams(location.search);
    let consumed = false;
    for (const [param, handlerName] of Object.entries(PARAM_TO_HANDLER)) {
      if (params.get(param) !== "1") continue;
      params.delete(param);
      consumed = true;
      handlersRef.current[handlerName]();
    }
    if (!consumed) return;
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search === "" ? "" : `?${search}` }, { replace: true });
  }, [location.pathname, location.search, navigate]);
};

/**
 * F1 and F3, delivered here (spec.md section 9.5).
 *
 * The latch is drained on mount as well as subscribed to, because the key is pressed on a page that
 * has no transport and the app then navigates: a plain window event would be dispatched and gone
 * before this page mounted.
 */
/**
 * Delivers a latched transport command to the page that owns the transport.
 *
 * `ready` is what stops the command arriving before there is anything to run it on. Resume and the
 * F1/F3 keys publish from another page and navigate here, and Play restores its stored playlist in
 * an effect declared far below the one that drained the latch — so the command reached a page whose
 * playlist was still empty, and Play or Next did nothing at all. Held until the page says it is
 * ready; the latch's own expiry still drops it if that never happens.
 */
export const useTransportCommands = (run: (command: TransportCommand) => void, ready = true): void => {
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!ready) return undefined;
    const pending = transportCommandBus.takePending();
    if (pending !== null) runRef.current(pending);
    return transportCommandBus.subscribe((command) => {
      // Claimed here, so the drain above cannot deliver it a second time.
      transportCommandBus.takePending();
      runRef.current(command);
    });
  }, [ready]);
};
