/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** Every word the mode switch shows, in one place so the copy rules can be tested against it. */
export const MODE_NAMES = {
  fullApp: "Full App",
  demoMode: "Demo Mode",
  sidPlayer: "SID Player",
} as const;

export const MODE_COPY = {
  enter: {
    title: "Use SID Player?",
    body:
      "SID Player keeps what works without a C64 Ultimate: playback on this phone, playlists, HVSC, SID Radio and " +
      "search. Machine controls, disks, config and Live View are put away. Your playlists, settings and saved " +
      "devices are kept. You can leave SID Player at any time from Settings or the menu.",
    compactBody: "Music on this phone only. You can switch back.",
    confirm: "Use SID Player",
    switching: "Switching to SID Player…",
    cancel: "Cancel",
  },
  leave: {
    title: "Leave SID Player?",
    body: "Full App looks for your C64 Ultimate and shows its controls again. Nothing you saved is changed.",
    compactBody: "Show the C64 Ultimate controls again?",
    confirmFullApp: "Full App",
    confirmDemoMode: "Demo Mode",
    cancel: "Cancel",
  },
  firstRun: {
    title: "No C64 Ultimate found",
    body:
      "Use SID Player to play C64 music on this phone. Is your C64 Ultimate switched on? Retry once it is. You can " +
      "change this later in Settings.",
    compactBody: "Play C64 music on this phone, or retry.",
    noNetworkBody:
      "This phone has no network. Use SID Player to play C64 music on this phone, or turn on Wi-Fi and retry. You can change this later in Settings.",
    noNetworkCompactBody: "No network. Play C64 music on this phone.",
    useSidPlayer: "Use SID Player",
    tryDemoMode: "Try Demo Mode",
    retry: "Retry connection",
  },
  sheet: {
    title: "SID Player",
    body: "Music on this phone only. Your C64 Ultimate controls are hidden.",
  },
  settings: {
    title: "App mode",
    summary: "Full App, Demo Mode or SID Player",
    description: "Choose how the app starts. Your playlists and settings are kept when you switch.",
  },
  menu: {
    use: "Use SID Player",
    quick: "SID Player",
    leave: "Leave SID Player",
  },
} as const;
