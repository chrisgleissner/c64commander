/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  AudioLines,
  Cable,
  Clock,
  Cpu,
  FolderOpen,
  Gamepad2,
  Gauge,
  HardDrive,
  Keyboard,
  Lightbulb,
  MemoryStick,
  Monitor,
  Network,
  Printer,
  Radio,
  Tv,
  Volume2,
  Wifi,
  type LucideIcon,
} from "lucide-react";

const CATEGORY_ICON_RULES: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/wi-?fi/i, Wifi],
  [/ethernet|network/i, Network],
  [/mixer/i, Volume2],
  [/sid|audio/i, AudioLines],
  [/led|lighting/i, Lightbulb],
  [/keyboard/i, Keyboard],
  [/printer/i, Printer],
  [/drive/i, HardDrive],
  [/clock/i, Clock],
  [/stream/i, Radio],
  [/modem/i, Cable],
  [/memory|\broms?\b/i, MemoryStick],
  [/turbo/i, Gauge],
  [/video/i, Tv],
  [/joystick|controller/i, Gamepad2],
  [/user interface/i, Monitor],
  [/u64|c64|cartridge/i, Cpu],
];

export const configCategoryIcon = (categoryName: string): LucideIcon =>
  CATEGORY_ICON_RULES.find(([pattern]) => pattern.test(categoryName))?.[1] ?? FolderOpen;
