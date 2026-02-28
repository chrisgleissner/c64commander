import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    toastSpy,
    reportUserErrorSpy,
    c64ApiMockRef,
    queryClientMockRef,
    updateConfigValueSpy,
    resolveConfigValueSpy,
} = vi.hoisted(() => ({
    toastSpy: vi.fn(),
    reportUserErrorSpy: vi.fn(),
    c64ApiMockRef: {
        current: {
            setConfigValue: vi.fn().mockResolvedValue({}),
            mountDrive: vi.fn().mockResolvedValue({}),
            getDrives: vi.fn().mockResolvedValue({ drives: [] }),
        },
    },
    queryClientMockRef: {
        current: {
            invalidateQueries: vi.fn().mockResolvedValue(undefined),
            fetchQuery: vi.fn().mockResolvedValue(undefined),
        },
    },
    updateConfigValueSpy: vi.fn().mockResolvedValue(undefined),
    resolveConfigValueSpy: vi.fn((_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback),
}));

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => queryClientMockRef.current,
}));

vi.mock('@/lib/c64api', () => ({
    getC64API: () => c64ApiMockRef.current,
}));

vi.mock('@/hooks/useActionTrace', () => ({
    useActionTrace: () => Object.assign((fn: (...args: any[]) => any) => fn, { scope: vi.fn() }),
}));

vi.mock('@/hooks/use-toast', () => ({
    toast: toastSpy,
    useToast: () => ({ toasts: [], dismiss: vi.fn() }),
}));

vi.mock('@/lib/uiErrors', () => ({
    reportUserError: reportUserErrorSpy,
}));

vi.mock('@/hooks/useC64Connection', () => ({
    useC64ConfigItems: () => ({ data: undefined }),
    useC64Drives: () => ({ data: { drives: [] }, refetch: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('@/hooks/useDiagnosticsActivity', () => ({
    useDiagnosticsActivity: () => ({ restInFlight: 0, setRestInFlight: vi.fn() }),
}));

vi.mock('@/lib/diagnostics/diagnosticsOverlayState', () => ({
    isDiagnosticsOverlayActive: () => false,
    subscribeDiagnosticsOverlay: () => () => { },
    shouldSuppressDiagnosticsSideEffects: () => false,
}));

// Mock ConfigActionsContext
vi.mock('@/pages/home/hooks/ConfigActionsContext', async () => {
    const React = await import('react');
    return {
        useSharedConfigActions: () => ({
            configOverrides: {},
            configWritePending: {},
            updateConfigValue: updateConfigValueSpy,
            resolveConfigValue: resolveConfigValueSpy,
        }),
        ConfigActionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    };
});

// Mock useDriveData
const refetchDrivesSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/pages/home/hooks/useDriveData', () => ({
    useDriveData: () => ({
        refetchDrives: refetchDrivesSpy,
        driveASettingsCategory: undefined,
        driveBSettingsCategory: undefined,
        softIecConfig: undefined,
        driveSummaryItems: [
            { key: 'a', label: 'Drive A', mountedLabel: 'game.d64', isMounted: true },
            { key: 'b', label: 'Drive B', mountedLabel: 'No disk mounted', isMounted: false },
            { key: 'softiec', label: 'Soft IEC', mountedLabel: '/USB0/', isMounted: false },
        ],
        drivesByClass: new Map(),
    }),
}));

// Mock DriveCard to expose callback props
vi.mock('@/pages/home/DriveCard', () => ({
    DriveCard: (props: any) => (
        <div data-testid={`drive-card-${props.testIdSuffix}`}>
            <span data-testid="drive-name">{props.name}</span>
            <span data-testid="drive-enabled">{props.enabled ? 'Enabled' : 'Disabled'}</span>
            <span data-testid="drive-bus">{props.busIdValue}</span>
            {props.typeValue && <span data-testid="drive-type">{props.typeValue}</span>}
            <span data-testid="drive-mounted">{props.mountedPath ?? 'none'}</span>
            <span data-testid="drive-status">{props.statusSummary}</span>
            <button data-testid="drive-toggle" onClick={props.onToggle}>Toggle</button>
            <button data-testid="drive-bus-change" onClick={() => props.onBusIdChange?.('9')}>ChangeBus</button>
            {props.onTypeChange && (
                <button data-testid="drive-type-change" onClick={() => props.onTypeChange?.('1571')}>ChangeType</button>
            )}
            <button data-testid="drive-mount-click" onClick={props.onMountedPathClick}>Mount</button>
            <button data-testid="drive-status-click" onClick={props.onStatusClick}>StatusClick</button>
        </div>
    ),
}));

vi.mock('@/components/SectionHeader', () => ({
    SectionHeader: (props: any) => (
        <div data-testid={props.resetTestId}>
            <span>{props.title}</span>
            <button onClick={props.resetAction} disabled={props.resetDisabled} data-testid="drives-reset-btn">Reset</button>
        </div>
    ),
}));

// Mock ItemSelectionDialog
vi.mock('@/components/itemSelection/ItemSelectionDialog', () => ({
    ItemSelectionDialog: (props: any) => (
        <div data-testid="item-selection-dialog" data-open={props.open}>
            {props.open && (
                <button
                    data-testid="confirm-mount"
                    onClick={() => props.onConfirm?.(null, [{ path: '/USB0/games/test.d64' }])}
                >
                    Confirm
                </button>
            )}
        </div>
    ),
}));

// Mock Dialog components
vi.mock('@/components/ui/dialog', () => ({
    Dialog: ({ children, open }: any) => <div data-testid="dialog" data-open={open}>{children}</div>,
    DialogContent: ({ children }: any) => <div>{children}</div>,
    DialogDescription: ({ children }: any) => <div>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/lib/sourceNavigation/ftpSourceAdapter', () => ({
    createUltimateSourceLocation: () => ({ type: 'ultimate', label: 'C64U' }),
}));

vi.mock('@/lib/sourceNavigation/sourceTerms', () => ({
    SOURCE_LABELS: { c64u: 'C64 Ultimate' },
}));

import { DriveManager } from '@/pages/home/components/DriveManager';

describe('DriveManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const defaultProps = {
        isConnected: true,
        handleAction: vi.fn().mockImplementation(async (action: () => Promise<void>) => { await action(); }),
        machineTaskBusy: false,
        machineTaskId: null as string | null,
        onResetDrives: vi.fn().mockImplementation(async (cb: () => Promise<void>) => { await cb(); }),
    };

    it('renders Drives section header', () => {
        render(<DriveManager {...defaultProps} />);
        expect(screen.getByText('Drives')).toBeDefined();
    });

    it('renders drive cards for all DRIVE_CONTROL_SPECS', () => {
        render(<DriveManager {...defaultProps} />);
        expect(screen.getByTestId('drive-card-a')).toBeDefined();
        expect(screen.getByTestId('drive-card-b')).toBeDefined();
        expect(screen.getByTestId('drive-card-soft-iec')).toBeDefined();
    });

    describe('handleEnabledToggle', () => {
        it('calls updateConfigValue to disable Drive A', async () => {
            render(<DriveManager {...defaultProps} />);
            const cards = screen.getAllByTestId('drive-toggle');
            fireEvent.click(cards[0]); // Drive A toggle
            await vi.waitFor(() => {
                expect(updateConfigValueSpy).toHaveBeenCalledWith(
                    'Drive A Settings',
                    'Drive',
                    expect.stringMatching(/Enabled|Disabled/),
                    'HOME_DRIVE_ENABLED',
                    expect.stringContaining('Drive A'),
                    { refreshDrives: true },
                );
            });
        });

        it('calls updateConfigValue to toggle Drive B', async () => {
            render(<DriveManager {...defaultProps} />);
            const cards = screen.getAllByTestId('drive-toggle');
            fireEvent.click(cards[1]); // Drive B toggle
            await vi.waitFor(() => {
                expect(updateConfigValueSpy).toHaveBeenCalledWith(
                    'Drive B Settings',
                    'Drive',
                    expect.stringMatching(/Enabled|Disabled/),
                    'HOME_DRIVE_ENABLED',
                    expect.stringContaining('Drive B'),
                    { refreshDrives: true },
                );
            });
        });

        it('calls updateConfigValue to toggle Soft IEC', async () => {
            render(<DriveManager {...defaultProps} />);
            const cards = screen.getAllByTestId('drive-toggle');
            fireEvent.click(cards[2]); // Soft IEC toggle
            await vi.waitFor(() => {
                expect(updateConfigValueSpy).toHaveBeenCalledWith(
                    'SoftIEC Drive Settings',
                    'IEC Drive',
                    expect.stringMatching(/Enabled|Disabled/),
                    'HOME_DRIVE_ENABLED',
                    expect.any(String),
                    { refreshDrives: true },
                );
            });
        });
    });

    describe('bus ID change', () => {
        it('calls updateConfigValue for bus ID change on Drive A', () => {
            render(<DriveManager {...defaultProps} />);
            const btns = screen.getAllByTestId('drive-bus-change');
            fireEvent.click(btns[0]);
            expect(updateConfigValueSpy).toHaveBeenCalledWith(
                'Drive A Settings',
                'Drive Bus ID',
                9,
                'HOME_DRIVE_BUS',
                expect.stringContaining('bus ID updated'),
                { refreshDrives: true },
            );
        });
    });

    describe('type change', () => {
        it('calls updateConfigValue for type change on Drive A', () => {
            render(<DriveManager {...defaultProps} />);
            const btns = screen.getAllByTestId('drive-type-change');
            fireEvent.click(btns[0]);
            expect(updateConfigValueSpy).toHaveBeenCalledWith(
                'Drive A Settings',
                'Drive Type',
                '1571',
                'HOME_DRIVE_TYPE',
                expect.stringContaining('type updated'),
                { refreshDrives: true },
            );
        });
    });

    describe('mount selection flow', () => {
        it('opens mount dialog and handles path mount for Soft IEC', async () => {
            render(<DriveManager {...defaultProps} />);
            // Click mount on Soft IEC (index 2)
            const mountBtns = screen.getAllByTestId('drive-mount-click');
            fireEvent.click(mountBtns[2]);
            // Dialog should now be open
            await vi.waitFor(() => {
                const dialog = screen.getByTestId('item-selection-dialog');
                expect(dialog.getAttribute('data-open')).toBe('true');
            });
            // Confirm the mount
            fireEvent.click(screen.getByTestId('confirm-mount'));
            await vi.waitFor(() => {
                expect(updateConfigValueSpy).toHaveBeenCalledWith(
                    'SoftIEC Drive Settings',
                    'Default Path',
                    '/USB0/games/test.d64',
                    'HOME_SOFT_IEC_PATH',
                    'Soft IEC path updated',
                );
            });
        });

        it('handles disk mount for physical Drive A', async () => {
            render(<DriveManager {...defaultProps} />);
            const mountBtns = screen.getAllByTestId('drive-mount-click');
            fireEvent.click(mountBtns[0]); // Drive A
            await vi.waitFor(() => {
                const dialog = screen.getByTestId('item-selection-dialog');
                expect(dialog.getAttribute('data-open')).toBe('true');
            });
            fireEvent.click(screen.getByTestId('confirm-mount'));
            await vi.waitFor(() => {
                expect(c64ApiMockRef.current.mountDrive).toHaveBeenCalledWith('a', '/USB0/games/test.d64');
            });
        });

        it('handles disk mount for physical Drive B', async () => {
            render(<DriveManager {...defaultProps} />);
            const mountBtns = screen.getAllByTestId('drive-mount-click');
            fireEvent.click(mountBtns[1]); // Drive B
            await vi.waitFor(() => {
                const dialog = screen.getByTestId('item-selection-dialog');
                expect(dialog.getAttribute('data-open')).toBe('true');
            });
            fireEvent.click(screen.getByTestId('confirm-mount'));
            await vi.waitFor(() => {
                expect(c64ApiMockRef.current.mountDrive).toHaveBeenCalledWith('b', '/USB0/games/test.d64');
            });
        });
    });

    describe('reset drives', () => {
        it('calls onResetDrives with refetch callback', async () => {
            render(<DriveManager {...defaultProps} />);
            fireEvent.click(screen.getByTestId('drives-reset-btn'));
            await vi.waitFor(() => {
                expect(defaultProps.onResetDrives).toHaveBeenCalled();
            });
        });

        it('disables reset when disconnected', () => {
            render(<DriveManager {...defaultProps} isConnected={false} />);
            expect(screen.getByTestId('drives-reset-btn')).toBeDisabled();
        });

        it('disables reset when machineTaskBusy', () => {
            render(<DriveManager {...defaultProps} machineTaskBusy={true} />);
            expect(screen.getByTestId('drives-reset-btn')).toBeDisabled();
        });
    });

    describe('status dialog', () => {
        it('opens status details dialog on status click', () => {
            render(<DriveManager {...defaultProps} />);
            const statusBtns = screen.getAllByTestId('drive-status-click');
            fireEvent.click(statusBtns[0]);
            // Dialog becomes open
            const dialogs = screen.getAllByTestId('dialog');
            const statusDialog = dialogs.find(d => d.getAttribute('data-open') === 'true');
            expect(statusDialog).toBeDefined();
        });
    });

    describe('drive rendering', () => {
        it('shows default status OK for drives without errors', () => {
            render(<DriveManager {...defaultProps} />);
            const statuses = screen.getAllByTestId('drive-status');
            expect(statuses[0].textContent).toBe('OK');
        });

        it('shows correct bus ID defaults', () => {
            render(<DriveManager {...defaultProps} />);
            const buses = screen.getAllByTestId('drive-bus');
            expect(buses[0].textContent).toBe('8');  // Drive A default
            expect(buses[1].textContent).toBe('9');  // Drive B default
            expect(buses[2].textContent).toBe('11'); // Soft IEC default
        });

        it('shows Soft IEC default path from resolveConfigValue', () => {
            resolveConfigValueSpy.mockImplementation(
                (_payload: unknown, _category: string, itemName: string, fallback: string | number) => {
                    if (itemName === 'Default Path') return '/SD/';
                    return fallback;
                },
            );
            render(<DriveManager {...defaultProps} />);
            const mounted = screen.getAllByTestId('drive-mounted');
            expect(mounted[2].textContent).toBe('/SD/');
        });
    });
});
