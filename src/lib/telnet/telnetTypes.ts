/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** 60×24 Telnet screen dimensions matching firmware Screen_VT100 */
export const TELNET_SCREEN_WIDTH = 60;
export const TELNET_SCREEN_HEIGHT = 24;

/** Default Telnet port for C64 Ultimate */
export const TELNET_DEFAULT_PORT = 23;

/** VT100 key sequences sent to firmware */
export const TELNET_KEYS = {
    F1: '\x1b[11~',
    F5: '\x1b[15~',
    F6: '\x1b[17~',
    UP: '\x1b[A',
    DOWN: '\x1b[B',
    RIGHT: '\x1b[C',
    LEFT: '\x1b[D',
    ENTER: '\r',
    ESCAPE: '\x1b',
    HOME: '\x1b[1~',
    PLUS: '+',
    MINUS: '-',
} as const;

export type TelnetKeyName = keyof typeof TELNET_KEYS;

/** Screen cell with character, attribute, and color */
export interface ScreenCell {
    char: string;
    reverse: boolean;
    color: number;
}

/** Screen types the parser can classify */
export type ScreenType =
    | 'file_browser'
    | 'action_menu'
    | 'search_form'
    | 'search_results'
    | 'file_entries'
    | 'unknown';

/** A single menu item extracted from the screen */
export interface MenuItem {
    label: string;
    selected: boolean;
    enabled: boolean;
}

/** A parsed menu overlay detected on screen */
export interface ParsedMenu {
    level: number;
    items: MenuItem[];
    selectedIndex: number;
    bounds: { x: number; y: number; width: number; height: number };
}

/** Form field types for CommoServe */
export type FormFieldType = 'text' | 'dropdown' | 'submit';

/** A parsed form field from the CommoServe search form */
export interface FormField {
    label: string;
    value: string;
    type: FormFieldType;
    selected: boolean;
    isEmpty: boolean;
}

/** A parsed CommoServe/Assembly64 form */
export interface ParsedForm {
    title: string;
    fields: FormField[];
    selectedIndex: number;
    bounds: { x: number; y: number; width: number; height: number };
}

/** Complete parsed screen state */
export interface TelnetScreen {
    width: typeof TELNET_SCREEN_WIDTH;
    height: typeof TELNET_SCREEN_HEIGHT;
    cells: ScreenCell[][];
    menus: ParsedMenu[];
    form: ParsedForm | null;
    selectedItem: string | null;
    titleLine: string;
    screenType: ScreenType;
}

/** Navigation state machine states */
export type NavigatorState =
    | 'IDLE'
    | 'OPENING_MENU'
    | 'SCANNING_MENU'
    | 'NAVIGATING_TO_CATEGORY'
    | 'ENTERING_SUBMENU'
    | 'SCANNING_SUBMENU'
    | 'NAVIGATING_TO_ACTION'
    | 'EXECUTING'
    | 'VERIFYING'
    | 'COMPLETE'
    | 'ERROR';

/** Menu path for navigation: [categoryLabel, actionLabel] */
export type MenuPath = [string, string];

/** Transport abstraction for TCP socket communication */
export interface TelnetTransport {
    connect(host: string, port: number): Promise<void>;
    disconnect(): Promise<void>;
    send(data: Uint8Array): Promise<void>;
    read(timeoutMs: number): Promise<Uint8Array>;
    isConnected(): boolean;
}

/** Session-level Telnet interface */
export interface TelnetSessionApi {
    connect(host: string, port: number, password?: string): Promise<void>;
    sendKey(key: TelnetKeyName): Promise<void>;
    sendRaw(data: string): Promise<void>;
    readScreen(timeoutMs?: number): Promise<TelnetScreen>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
}

/** Telnet action definition */
export interface TelnetAction {
    id: string;
    label: string;
    menuPath: MenuPath;
    subsystem: string;
}

/** Telnet-only actions keyed by ID */
export const TELNET_ACTIONS: Record<string, TelnetAction> = {
    powerCycle: {
        id: 'powerCycle',
        label: 'Power Cycle',
        menuPath: ['Power & Reset', 'Power Cycle'],
        subsystem: 'C64',
    },
    rebootClearMemory: {
        id: 'rebootClearMemory',
        label: 'Reboot (Clear RAM)',
        menuPath: ['Power & Reset', 'Reboot (Clr Mem)'],
        subsystem: 'C64',
    },
    saveC64Memory: {
        id: 'saveC64Memory',
        label: 'Save C64 Memory',
        menuPath: ['Power & Reset', 'Save C64 Memory'],
        subsystem: 'C64',
    },
    saveReuMemory: {
        id: 'saveReuMemory',
        label: 'Save REU Memory',
        menuPath: ['Power & Reset', 'Save REU Memory'],
        subsystem: 'C64',
    },
    iecTurnOn: {
        id: 'iecTurnOn',
        label: 'IEC Turn On',
        menuPath: ['Software IEC', 'Turn On'],
        subsystem: 'IEC',
    },
    iecReset: {
        id: 'iecReset',
        label: 'IEC Reset',
        menuPath: ['Software IEC', 'Reset'],
        subsystem: 'IEC',
    },
    printerFlush: {
        id: 'printerFlush',
        label: 'Printer Flush',
        menuPath: ['Printer', 'Flush/Eject'],
        subsystem: 'Printer',
    },
    printerReset: {
        id: 'printerReset',
        label: 'Printer Reset',
        menuPath: ['Printer', 'Reset'],
        subsystem: 'Printer',
    },
    printerTurnOn: {
        id: 'printerTurnOn',
        label: 'Printer Turn On',
        menuPath: ['Printer', 'Turn On'],
        subsystem: 'Printer',
    },
    saveConfigToFile: {
        id: 'saveConfigToFile',
        label: 'Save Config to File',
        menuPath: ['Configuration', 'Save to File'],
        subsystem: 'Config',
    },
    clearFlashConfig: {
        id: 'clearFlashConfig',
        label: 'Clear Flash Config',
        menuPath: ['Configuration', 'Clear Flash Config'],
        subsystem: 'Config',
    },
};

/** Error types specific to Telnet operations */
export class TelnetError extends Error {
    constructor(
        message: string,
        public readonly code: TelnetErrorCode,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'TelnetError';
    }
}

export type TelnetErrorCode =
    | 'CONNECTION_FAILED'
    | 'AUTH_FAILED'
    | 'TIMEOUT'
    | 'MENU_NOT_FOUND'
    | 'ITEM_NOT_FOUND'
    | 'DESYNC'
    | 'DISCONNECTED'
    | 'NAVIGATION_FAILED'
    | 'ACTION_FAILED';

/** Menu fixture for the deterministic mock */
export interface MenuFixture {
    categories: Array<{
        label: string;
        actions: Array<{ label: string; enabled: boolean }>;
    }>;
}

/** Default menu fixture matching the C64 Ultimate firmware */
export const DEFAULT_MENU_FIXTURE: MenuFixture = {
    categories: [
        {
            label: 'Power & Reset',
            actions: [
                { label: 'Reset C64', enabled: true },
                { label: 'Reboot C64', enabled: true },
                { label: 'Reboot (Clr Mem)', enabled: true },
                { label: 'Power OFF', enabled: true },
                { label: 'Power Cycle', enabled: true },
                { label: 'Save C64 Memory', enabled: true },
                { label: 'Save REU Memory', enabled: true },
            ],
        },
        {
            label: 'Software IEC',
            actions: [
                { label: 'Turn On', enabled: true },
                { label: 'Reset', enabled: true },
                { label: 'Set dir. here', enabled: true },
            ],
        },
        {
            label: 'Printer',
            actions: [
                { label: 'Turn On', enabled: true },
                { label: 'Reset', enabled: true },
                { label: 'Flush/Eject', enabled: true },
            ],
        },
        {
            label: 'Configuration',
            actions: [
                { label: 'Save to File', enabled: true },
                { label: 'Clear Flash Config', enabled: true },
            ],
        },
        {
            label: 'Developer',
            actions: [
                { label: 'Clear Debug Log', enabled: true },
                { label: 'Save Debug Log', enabled: true },
                { label: 'Save EDID to file', enabled: true },
            ],
        },
    ],
};
