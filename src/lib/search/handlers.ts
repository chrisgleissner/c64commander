/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { requestDeviceSwitcherOpen, requestQuickMenuOpen } from "@/lib/input/keypadCommands";
import { remoteInputRequestBus, transportCommandBus } from "@/lib/input/latchedCommandBus";
import { startGameMode } from "@/lib/remoteInput/gameModeLaunch";
import { requestTourStart } from "@/lib/tour/tourState";
import { requestSectionsBulk } from "@/lib/ui/collapsibleSectionStore";

/**
 * What an `action` entry actually does.
 *
 * Tier 0 is generated from YAML, and a generated data module cannot hold a closure, so an action
 * target names a handler id which is resolved here at run time (spec.md section 5.2). Two contract
 * tests hold the map to the index from both ends: every id the index names resolves, and every
 * handler here is named by at least one entry.
 */

export interface SearchHandlerContext {
  /** react-router's navigate, narrowed to what a handler needs. */
  navigate: (path: string) => void;
  currentPath: string;
}

export type SearchHandler = (ctx: SearchHandlerContext) => void;

/**
 * Play owns the transport and the sheets. Radio, Resume, Recent, Find a tune and Liked tunes all
 * navigate with a parameter rather than hoisting their owner into a provider: `useSidRadio` feeds
 * the Play page's playback engine, and a second owner of that transport is how two stations end up
 * running at once.
 */
const toPlay =
  (param: string): SearchHandler =>
  (ctx) => {
    ctx.navigate(`/play?${param}=1`);
  };

export const SEARCH_HANDLERS: Readonly<Record<string, SearchHandler>> = {
  startSidRadio: toPlay("radio"),
  resumePlaybackSession: toPlay("resume"),
  openRecentlyPlayed: toPlay("recent"),
  openFindATune: toPlay("find"),
  openLikedTunes: toPlay("liked"),

  mediaPlayPause: (ctx) => {
    transportCommandBus.publish("playPause");
    if (ctx.currentPath !== "/play") ctx.navigate("/play");
  },
  mediaNext: (ctx) => {
    transportCommandBus.publish("next");
    if (ctx.currentPath !== "/play") ctx.navigate("/play");
  },

  openDiagnostics: () => requestDiagnosticsOpen("settings"),
  openKeyExplorer: () => requestDiagnosticsOpen("settings", "key-explorer"),
  openDeviceSwitcher: () => requestDeviceSwitcherOpen(),
  openQuickMenu: () => requestQuickMenuOpen("pointer"),

  expandAllSections: () => requestSectionsBulk(true),
  collapseAllSections: () => requestSectionsBulk(false),

  startTour: () => requestTourStart(),

  startGameMode: (ctx) => {
    // The sheet is mounted by Home and Play only, so a request raised anywhere else needs a page
    // that can answer it. The latch outlives the navigation, so the request cannot be dropped.
    if (ctx.currentPath !== "/" && ctx.currentPath !== "/play") ctx.navigate("/");
    void startGameMode();
  },
  openRemoteInput: (ctx) => {
    remoteInputRequestBus.publish("open");
    if (ctx.currentPath !== "/" && ctx.currentPath !== "/play") ctx.navigate("/");
  },
};

export const resolveSearchHandler = (handlerId: string): SearchHandler | null => SEARCH_HANDLERS[handlerId] ?? null;
