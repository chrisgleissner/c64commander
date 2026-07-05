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
import type { DeviceConfigItemRef } from "./hooks/useDeviceConfigOptionDomains";

/**
 * Resolve the choices to render for a Home summary dropdown. Permitted values ALWAYS come from
 * the concrete device: `liveOptions` are the enum from the (rarely-enriched) category read, and
 * `domainOptions` are the device-reported `values` fetched per-item by
 * {@link useDeviceConfigOptionDomains}. Only when the device has told us nothing yet do we fall
 * back to the device's *current* value as the sole choice — we never fabricate a model-specific
 * option list, because those diverge across hardware (e.g. "C64U Turbo Registers" vs
 * "U64 Turbo Registers", or entirely different Color Scheme / LED pattern labels).
 */
export const resolveHomeConfigOptions = (
  liveOptions: string[],
  domainOptions: string[] | undefined,
  fallbackValue: string,
) => {
  if (liveOptions.length) return liveOptions;
  if (domainOptions && domainOptions.length) return domainOptions;
  return fallbackValue ? [fallbackValue] : [];
};

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

// Every Home summary dropdown whose permitted values must be interrogated from the concrete
// device (the enum `values`), rather than assumed. Fed to useDeviceConfigOptionDomains.
export const HOME_OPTION_DOMAIN_REFS: readonly DeviceConfigItemRef[] = [
  ...U64_HOME_ITEMS.map((item) => ({ category: "U64 Specific Settings", item })),
  ...C64_CARTRIDGE_HOME_ITEMS.map((item) => ({ category: "C64 and Cartridge Settings", item })),
  ...USER_INTERFACE_HOME_ITEMS.map((item) => ({ category: "User Interface Settings", item })),
];
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
