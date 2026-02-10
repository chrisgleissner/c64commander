import { SID_SOCKETS_ITEMS, SID_ADDRESSING_ITEMS } from '@/lib/config/configItems';
import { DriveDeviceClass } from '@/lib/drives/driveDevices';

export const DRIVE_A_HOME_ITEMS = ['Drive', 'Drive Bus ID', 'Drive Type'] as const;
export const DRIVE_B_HOME_ITEMS = ['Drive', 'Drive Bus ID', 'Drive Type'] as const;
export const U64_HOME_ITEMS = ['System Mode', 'Turbo Control', 'CPU Speed', 'Analog Video Mode', 'Digital Video Mode', 'HDMI Scan lines'] as const;
export const LED_STRIP_HOME_ITEMS = ['LedStrip Mode', 'Fixed Color', 'Strip Intensity', 'LedStrip SID Select', 'Color tint'] as const;
export const SID_AUDIO_ITEMS = [
    'Vol Socket 1',
    'Vol Socket 2',
    'Vol UltiSid 1',
    'Vol UltiSid 2',
    'Pan Socket 1',
    'Pan Socket 2',
    'Pan UltiSID 1',
    'Pan UltiSID 2',
] as const;
export const SID_DETECTED_ITEMS = ['SID Detected Socket 1', 'SID Detected Socket 2'] as const;
export const ULTISID_PROFILE_ITEMS = ['UltiSID 1 Filter Curve', 'UltiSID 2 Filter Curve'] as const;
export const SID_SOCKET_SHAPING_ITEMS = [
    'SID Socket 1 1K Ohm Resistor',
    'SID Socket 2 1K Ohm Resistor',
    'SID Socket 1 Capacitors',
    'SID Socket 2 Capacitors',
] as const;
export const ULTISID_SHAPING_ITEMS = [
    'UltiSID 1 Filter Resonance',
    'UltiSID 2 Filter Resonance',
    'UltiSID 1 Combined Waveforms',
    'UltiSID 2 Combined Waveforms',
    'UltiSID 1 Digis Level',
    'UltiSID 2 Digis Level',
] as const;
export const HOME_SID_SOCKET_ITEMS = [...SID_SOCKETS_ITEMS, ...SID_DETECTED_ITEMS, ...SID_SOCKET_SHAPING_ITEMS] as const;
export const HOME_ULTISID_ITEMS = [...ULTISID_PROFILE_ITEMS, ...ULTISID_SHAPING_ITEMS] as const;
export const HOME_SID_ADDRESSING_ITEMS = [
    ...SID_ADDRESSING_ITEMS,
    'SID Socket 1 Address',
    'SID Socket 2 Address',
] as const;
export const DISK_BUS_ID_DEFAULTS = [8, 9, 10, 11];
export const PRINTER_BUS_ID_DEFAULTS = [4, 5];
export const PHYSICAL_DRIVE_TYPE_DEFAULTS = ['1541', '1571', '1581'];
export const EMPTY_SELECT_VALUE = '__empty__';
export const EMPTY_SELECT_LABEL = 'Default';
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
    { class: 'PHYSICAL_DRIVE_A', category: 'Drive A Settings', enabledItem: 'Drive', busItem: 'Drive Bus ID', typeItem: 'Drive Type', testIdSuffix: 'a', label: 'Drive A' },
    { class: 'PHYSICAL_DRIVE_B', category: 'Drive B Settings', enabledItem: 'Drive', busItem: 'Drive Bus ID', typeItem: 'Drive Type', testIdSuffix: 'b', label: 'Drive B' },
    { class: 'SOFT_IEC_DRIVE', category: 'SoftIEC Drive Settings', enabledItem: 'IEC Drive', busItem: 'Soft Drive Bus ID', testIdSuffix: 'soft-iec', label: 'Soft IEC Drive' },
];

export const PRINTER_CONTROL_SPEC: DriveControlSpec = {
    class: 'PRINTER',
    category: 'Printer Settings',
    enabledItem: 'IEC printer',
    busItem: 'Bus ID',
    testIdSuffix: 'printer',
    label: 'Printer',
};

export const PRINTER_HOME_ITEMS = [
    'IEC printer',
    'Bus ID',
    'Output file',
    'Output type',
    'Ink density',
    'Page top margin (default is 5)',
    'Page height (default is 60)',
    'Emulation',
    'Commodore charset',
    'Epson charset',
    'IBM table 2',
] as const;
