/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Ask for the C64's ROMs at the moment they turn out to be needed.
 *
 * Reading them from the connected machine is on by default, so this is only for someone who has
 * turned it off and then asked for on-device playback anyway. Rather than leaving them to work out
 * why it sounds wrong — or, before the fallback existed, why it made no sound at all — the prompt
 * appears where the problem is, and its one button does both halves of the fix: turns the setting
 * back on, and reads the images.
 *
 * It is deliberately an offer and not an action. The user turned this off, and the obligation that
 * made them do so — only connect to machines you own or are permitted to use — is theirs, not the
 * app's, to discharge.
 */

import { createElement } from "react";

import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { saveLocalEngineAutoRoms } from "@/lib/config/appSettings";
import { ensureSystemRoms } from "@/lib/roms/ensureSystemRoms";

/** Shown once per session: a second copy tells the listener nothing the first did not. */
let prompted = false;

export const resetSystemRomPromptForTests = () => {
  prompted = false;
};

export const promptForSystemRoms = (): void => {
  if (prompted) return;
  prompted = true;
  toast({
    title: "On-device playback needs the C64 ROMs",
    description:
      "Reading them from the machine you're connected to is switched off, so this is playing with " +
      "the lighter SID emulation. Only do this with a machine you own or are permitted to use.",
    action: createElement(
      ToastAction,
      {
        altText: "Read the C64 ROMs from the connected machine",
        onClick: () => {
          saveLocalEngineAutoRoms(true);
          void ensureSystemRoms();
        },
      },
      "Read them now",
    ),
  });
};
