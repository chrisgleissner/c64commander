/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { SID_SOCKETS_ITEMS, SID_ADDRESSING_ITEMS } from "@/lib/config/configItems";
import { DriveDeviceClass } from "@/lib/drives/driveDevices";
import { LIGHTING_SUMMARY_ITEMS } from "@/lib/lighting/constants";
import { VISIBLE_C64_QUERY_OPTIONS } from "@/hooks/useC64Connection";

// Firmware option domains mirrored from the C64U/U64 menu payloads used by the Home summary controls.
export const HOME_CPU_SPEED_OPTIONS = [
  "1",
  "2",
  "3",
  "4",
  "6",
  "8",
  "10",
  "12",
  "14",
  "16",
  "20",
  "24",
  "32",
  "40",
  "48",
  "64",
] as const;
const HOME_CONFIG_OPTION_DOMAINS = new Map<string, string[]>([
  ["U64 Specific Settings::System Mode", ["PAL", "NTSC"]],
  ["U64 Specific Settings::Analog Video Mode", ["CVBS + SVideo", "RGB"]],
  [
    "U64 Specific Settings::HDMI Scan Resolution",
    [
      "SD (480p/576p)",
      "HDTV 720p50",
      "HDTV 720p60",
      "HDTV 1080p50",
      "HDTV 1080p60",
      "PC 640 x 480",
      "PC 800 x 600",
      "PC 1024 x 768",
      "PC 1280 x 1024",
    ],
  ],
  ["U64 Specific Settings::Digital Video Mode", ["Auto", "HDMI", "DVI"]],
  ["U64 Specific Settings::HDMI Scan lines", ["Disabled", "Enabled"]],
  [
    "U64 Specific Settings::Serial Bus Mode",
    ["All Connected", "C64 <-> Internal", "Ext. <-> Int.", "C64 <-> External"],
  ],
  ["U64 Specific Settings::Joystick Swapper", ["Normal", "Swapped", "WASD Port 2", "WASD Port 1"]],
  ["U64 Specific Settings::Turbo Control", ["Off", "Manual", "C64U Turbo Registers", "TurboEnable Bit"]],
  ["U64 Specific Settings::CPU Speed", [...HOME_CPU_SPEED_OPTIONS]],
  ["U64 Specific Settings::Badline Timing", ["Disabled", "Enabled"]],
  ["U64 Specific Settings::SuperCPU Detect (D0BC)", ["Disabled", "Enabled"]],
  ["U64 Specific Settings::UserPort Power Enable", ["Disabled", "Enabled"]],
  ["C64 and Cartridge Settings::Cartridge Preference", ["Auto", "Internal", "External", "Manual"]],
  ["C64 and Cartridge Settings::RAM Expansion Unit", ["Disabled", "Enabled", "GeoRAM Mode"]],
  ["C64 and Cartridge Settings::REU Size", ["128 KB", "256 KB", "512 KB", "1 MB", "2 MB", "4 MB", "8 MB", "16 MB"]],
  ["User Interface Settings::Interface Type", ["Freeze", "Overlay on HDMI"]],
  ["User Interface Settings::Navigation Style", ["Quick Search", "WASD Cursors"]],
  [
    "User Interface Settings::Color Scheme",
    ["Commodore Blue", "Ultimate Black", "Commodore 1", "Commodore 2", "Commodore 3"],
  ],
]);

export const resolveHomeConfigOptions = (
  category: string,
  itemName: string,
  options: string[],
  fallbackValue: string,
) => (options.length ? options : (HOME_CONFIG_OPTION_DOMAINS.get(`${category}::${itemName}`) ?? [fallbackValue]));

export const HOME_SUMMARY_QUERY_OPTIONS = {
  ...VISIBLE_C64_QUERY_OPTIONS,
  skipEnrichment: true,
} as const;

export const DRIVE_A_HOME_ITEMS = ["Drive", "Drive Bus ID", "Drive Type"] as const;
export const DRIVE_B_HOME_ITEMS = ["Drive", "Drive Bus ID", "Drive Type"] as const;
export const U64_HOME_ITEMS = [
  "System Mode",
  "HDMI Scan Resolution",
  "Turbo Control",
  "CPU Speed",
  "Badline Timing",
  "SuperCPU Detect (D0BC)",
  "Analog Video Mode",
  "Digital Video Mode",
  "HDMI Scan lines",
  "Serial Bus Mode",
  "Joystick Swapper",
  "UserPort Power Enable",
] as const;
export const C64_CARTRIDGE_HOME_ITEMS = ["Cartridge Preference", "RAM Expansion Unit", "REU Size"] as const;
export const USER_INTERFACE_HOME_ITEMS = ["Interface Type", "Navigation Style", "Color Scheme"] as const;
export const LIGHTING_HOME_ITEMS = LIGHTING_SUMMARY_ITEMS;
export const LED_STRIP_HOME_ITEMS = LIGHTING_HOME_ITEMS;
export const KEYBOARD_LIGHTING_HOME_ITEMS = LIGHTING_HOME_ITEMS;
export const SID_AUDIO_ITEMS = [
  "Vol Master",
  "Vol Socket 1",
  "Vol Socket 2",
  "Vol UltiSid 1",
  "Vol UltiSid 2",
  "Pan Socket 1",
  "Pan Socket 2",
  "Pan UltiSID 1",
  "Pan UltiSID 2",
] as const;
export const SID_DETECTED_ITEMS = ["SID Detected Socket 1", "SID Detected Socket 2"] as const;
export const ULTISID_PROFILE_ITEMS = ["UltiSID 1 Filter Curve", "UltiSID 2 Filter Curve"] as const;
export const SID_SOCKET_SHAPING_ITEMS = [
  "SID Socket 1 1K Ohm Resistor",
  "SID Socket 2 1K Ohm Resistor",
  "SID Socket 1 Capacitors",
  "SID Socket 2 Capacitors",
] as const;
export const ULTISID_SHAPING_ITEMS = [
  "UltiSID 1 Filter Resonance",
  "UltiSID 2 Filter Resonance",
  "UltiSID 1 Combined Waveforms",
  "UltiSID 2 Combined Waveforms",
  "UltiSID 1 Digis Level",
  "UltiSID 2 Digis Level",
] as const;
export const HOME_SID_SOCKET_ITEMS = [
  ...SID_SOCKETS_ITEMS,
  ...SID_DETECTED_ITEMS,
  ...SID_SOCKET_SHAPING_ITEMS,
] as const;
export const HOME_ULTISID_ITEMS = [...ULTISID_PROFILE_ITEMS, ...ULTISID_SHAPING_ITEMS] as const;
export const HOME_SID_ADDRESSING_ITEMS = [
  ...SID_ADDRESSING_ITEMS,
  "SID Socket 1 Address",
  "SID Socket 2 Address",
] as const;
export const DISK_BUS_ID_DEFAULTS = [8, 9, 10, 11];
export const PRINTER_BUS_ID_DEFAULTS = [4, 5];
export const PHYSICAL_DRIVE_TYPE_DEFAULTS = ["1541", "1571", "1581"];
export const EMPTY_SELECT_VALUE = "__empty__";
export const EMPTY_SELECT_LABEL = "Default";
export const SID_SLIDER_DETENT_RANGE = 0.2;
export const SID_SLIDER_STEP = 0.01;

export type DriveControlSpec = {
  class: DriveDeviceClass;
  category: string;
  enabledItem: string;
  busItem: string;
  typeItem?: string;
  testIdSuffix: string;
  label: string;
};

export const DRIVE_CONTROL_SPECS: DriveControlSpec[] = [
  {
    class: "PHYSICAL_DRIVE_A",
    category: "Drive A Settings",
    enabledItem: "Drive",
    busItem: "Drive Bus ID",
    typeItem: "Drive Type",
    testIdSuffix: "a",
    label: "Drive A",
  },
  {
    class: "PHYSICAL_DRIVE_B",
    category: "Drive B Settings",
    enabledItem: "Drive",
    busItem: "Drive Bus ID",
    typeItem: "Drive Type",
    testIdSuffix: "b",
    label: "Drive B",
  },
  {
    class: "SOFT_IEC_DRIVE",
    category: "SoftIEC Drive Settings",
    enabledItem: "IEC Drive",
    busItem: "Soft Drive Bus ID",
    testIdSuffix: "soft-iec",
    label: "Soft IEC Drive",
  },
];

export const PRINTER_CONTROL_SPEC: DriveControlSpec = {
  class: "PRINTER",
  category: "Printer Settings",
  enabledItem: "IEC printer",
  busItem: "Bus ID",
  testIdSuffix: "printer",
  label: "Printer",
};

export const PRINTER_HOME_ITEMS = [
  "IEC printer",
  "Bus ID",
  "Output file",
  "Output type",
  "Ink density",
  "Page top margin (default is 5)",
  "Page height (default is 60)",
  "Emulation",
  "Commodore charset",
  "Epson charset",
  "IBM table 2",
] as const;
