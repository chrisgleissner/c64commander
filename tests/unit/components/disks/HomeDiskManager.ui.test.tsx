import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HomeDiskManager } from '@/components/disks/HomeDiskManager';
import { useC64ConfigItems, useC64Connection, useC64Drives } from '@/hooks/useC64Connection';
import { useDiskLibrary } from '@/hooks/useDiskLibrary';
import { getC64API } from '@/lib/c64api';
import { toast } from '@/hooks/use-toast';
import { reportUserError } from '@/lib/uiErrors';
import { mountDiskToDrive } from '@/lib/disks/diskMount';

// Helpers
const createMockDisk = (overrides: any = {}) => ({
  id: 'test-disk',
  name: 'disk.d64',
  path: '/disk.d64',
  location: 'ultimate',
  group: null,
  importedAt: new Date().toISOString(),
  ...overrides,
});

const createMockDrive = (overrides: any = {}) => ({
  bus_id: 1,
  enabled: true,
  image_file: '',
  image_path: '',
  status: 'ready',
  ...overrides,
});

// Mocks
vi.mock('@/hooks/useC64Connection');
vi.mock('@/hooks/useDiskLibrary');
vi.mock('@/lib/c64api');
vi.mock('@/hooks/use-toast');
vi.mock('@/lib/uiErrors');
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    fetchQuery: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('@/lib/disks/diskMount', () => ({
  mountDiskToDrive: vi.fn(),
}));
vi.mock('@/hooks/useActionTrace', () => ({
  useActionTrace: () => (fn: any) => fn,
}));

// Mock child components that are complex
vi.mock('@/components/itemSelection/ItemSelectionDialog', () => ({
  ItemSelectionDialog: ({ open }: any) => (open ? <div data-testid="item-selection-dialog">Item Selection Dialog</div> : null),
}));
vi.mock('@/components/itemSelection/AddItemsProgressOverlay', () => ({
  AddItemsProgressOverlay: ({ visible }: any) => (visible ? <div data-testid="progress-overlay">Progress Overlay</div> : null),
}));
vi.mock('@/components/lists/SelectableActionList', () => ({
  SelectableActionList: ({ items, headerActions, onRemoveSelected, onToggleSelectAll }: any) => (
    <div data-testid="mock-action-list">
      <div data-testid="header-actions">{headerActions}</div>
      <button onClick={onToggleSelectAll}>Select all</button>
      {onRemoveSelected && <button onClick={onRemoveSelected}>Remove selected items</button>}
      <ul>
        {items.map((item: any, i: number) => (
          <li key={item.id || i}>
             {item.variant === 'header' ? (
                <span data-testid="list-header">{item.title}</span>
             ) : (
                <div data-testid={`disk-item-${item.id}`}>
                   <span>{item.title}</span>
                   {/* Render Menu Items to check formatting */}
                   <div data-testid={`menu-${item.id}`}>
                      {item.menuItems?.map((m: any, idx: number) => (
                         <div key={idx} role="listitem">
                             <span>{m.label}</span>
                             <span>{m.value}</span>
                         </div>
                      ))}
                   </div>
                   {/* Render Action to click mount */}
                   <button onClick={item.onAction}>{item.actionLabel}</button>
                </div>
             )}
          </li>
        ))}
      </ul>
    </div>
  ),
}));

describe('HomeDiskManager UI & Interactions', () => {
    const mockApi = {
        driveOn: vi.fn(),
        driveOff: vi.fn(),
        resetDrive: vi.fn(),
        mountDisk: vi.fn(),
        unmountDrive: vi.fn(),
        getBaseUrl: () => 'http://mock-host',
        getDeviceHost: () => 'mock-host',
    };

    const mockRemoveDisk = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (getC64API as any).mockReturnValue(mockApi);
        (useC64Connection as any).mockReturnValue({
            status: { isConnected: true, state: 'ready', deviceInfo: { unique_id: 'test-device' } },
        });
        (useDiskLibrary as any).mockReturnValue({
            disks: [],
            runtimeFiles: {},
            removeDisk: mockRemoveDisk,
        });
        (useC64Drives as any).mockReturnValue({
            data: { drives: [{ a: createMockDrive() }, { b: createMockDrive() }] },
        });
        (useC64ConfigItems as any).mockReturnValue({ data: undefined });
    });

    it('renders drive power toggle and handles error', async () => {
        const driveA = createMockDrive();
        driveA.enabled = true;
        (useC64Drives as any).mockReturnValue({
            data: { drives: [{ a: driveA }, { b: createMockDrive() }] },
        });

        render(<HomeDiskManager />);

        const toggleBtn = screen.getByTestId('drive-power-toggle-a');
        expect(toggleBtn).toHaveTextContent('Turn Off');

        // Mock error
        mockApi.driveOff.mockRejectedValueOnce(new Error('Power error'));

        fireEvent.click(toggleBtn);

        await waitFor(() => {
            expect(mockApi.driveOff).toHaveBeenCalledWith('a');
            expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
                operation: 'DRIVE_POWER',
                title: 'Drive power toggle failed',
            }));
            // Should revert to 'Turn Off' visually after error? 
            // The state optimistic update happens, then catch block reverts it.
            expect(toggleBtn).not.toBeDisabled(); 
        });
    });

    it('resets an individual drive from its card control', async () => {
        render(<HomeDiskManager />);
        fireEvent.click(screen.getByTestId('drive-reset-a'));
        await waitFor(() => {
            expect(mockApi.resetDrive).toHaveBeenCalledWith('a');
            expect(toast).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Drive A reset',
            }));
        });
    });

    it('displays formated keys and dates in disk details', async () => {
        const disk = createMockDisk({
            id: 'disk-1',
            name: 'Game.d64',
            path: '/Game.d64',
            sizeBytes: 150000, // ~146 KB
            modifiedAt: '2023-01-01T12:00:00Z'
        });
        
        (useDiskLibrary as any).mockReturnValue({
            disks: [disk],
            runtimeFiles: {},
            removeDisk: mockRemoveDisk,
        });

        render(<HomeDiskManager />);

        // Instead of clicking menu, we just inspect the rendered mock menu items
        const menuContainer = screen.getByTestId(`menu-${disk.id}`);
        
        // KB check
        expect(within(menuContainer).getByText(/146(.5)? KB/)).toBeInTheDocument(); 
        // Date check - flexible matching
        expect(within(menuContainer).getByText(/Jan/)).toBeInTheDocument();
        expect(within(menuContainer).getByText(/2023/)).toBeInTheDocument();
    });

    it('handles bulk delete of disks', async () => {
        const disk1 = createMockDisk({ id: 'd1', name: 'Disk 1' });
        const disk2 = createMockDisk({ id: 'd2', name: 'Disk 2' });
        
        (useDiskLibrary as any).mockReturnValue({
            disks: [disk1, disk2],
            runtimeFiles: {},
            removeDisk: mockRemoveDisk,
        });

        render(<HomeDiskManager />);

        // Select both disks
        // Assuming ActionList exposes selection checkboxes.
        // Need to find the checkboxes. They are usually labeled or in the list item.
        // The implementation uses `SelectableActionList`.
        
        // Find toggle select all
        const selectAll = screen.getByText('Select all');
        fireEvent.click(selectAll);

        // Click remove selected
        const removeSelected = screen.getByText('Remove selected items');
        fireEvent.click(removeSelected);

        // Should be in dialog now
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText(/This removes 2 disk\(s\)/)).toBeInTheDocument();

        // Confirm
        const confirmBtn = within(dialog).getByRole('button', { name: 'Remove' });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(mockRemoveDisk).toHaveBeenCalledTimes(2);
            expect(mockRemoveDisk).toHaveBeenCalledWith('d1');
            expect(mockRemoveDisk).toHaveBeenCalledWith('d2');
        });
    });

     it('handles bulk delete with mounted disks (auto-eject)', async () => {
        const disk1 = createMockDisk({ id: 'd1', name: 'Disk 1', path: '/disk1. d64' }); // Note spacing/chars must match normalization logic usually
        // Using strict simple path for safety
        const disk1Clean = createMockDisk({ id: 'd1', name: 'Disk 1', path: '/disk1.d64' });
        
        // Drive A has this disk mounted
        const driveA = createMockDrive();
        driveA.image_file = 'disk1.d64';
        driveA.image_path = '/';
        
        (useC64Drives as any).mockReturnValue({
             data: { drives: [{ a: driveA }, { b: createMockDrive() }] },
        });

        // Need to mock resolveMountedDiskId logic by having the disk in library match the drive path
        // library disk1 path is /disk1.d64. Drive path is / + disk1.d64. Matches.
        // So disk1 is considered mounted on A.

        (useDiskLibrary as any).mockReturnValue({
            disks: [disk1Clean],
            runtimeFiles: {},
            removeDisk: mockRemoveDisk,
        });

        render(<HomeDiskManager />);

        // Select disk
        const selectAll = screen.getByText('Select all');
        fireEvent.click(selectAll);

        // Click remove
        const removeSelected = screen.getByText('Remove selected items');
        fireEvent.click(removeSelected);

        // Confirm
        const dialog = screen.getByRole('dialog');
        const confirmBtn = within(dialog).getByRole('button', { name: 'Remove' });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(mockApi.unmountDrive).toHaveBeenCalledWith('a');
            expect(mockRemoveDisk).toHaveBeenCalledWith('d1');
        });
    });

    it('displays folder headers in disk list', () => {
        const disk1 = createMockDisk({ id: 'd1', name: 'File1', path: '/folder/File1' });
        const disk2 = createMockDisk({ id: 'd2', name: 'File2', path: '/other/File2' });

        (useDiskLibrary as any).mockReturnValue({
            disks: [disk1, disk2],
            runtimeFiles: {},
        });

        render(<HomeDiskManager />);

        expect(screen.getByText('/folder/')).toBeInTheDocument();
        expect(screen.getByText('/other/')).toBeInTheDocument();
    });

    it('handles mount failure with error report', async () => {
        const disk = createMockDisk({ id: 'd1', name: 'Disk 1' });
        
        (useDiskLibrary as any).mockReturnValue({
            disks: [disk],
            runtimeFiles: {},
        });

        render(<HomeDiskManager />);

        (mountDiskToDrive as any).mockRejectedValueOnce(new Error('Mount failed'));

        // Click mount button via the mocked list item action
        const mountBtn = screen.getByRole('button', { name: `Mount` }); 
        fireEvent.click(mountBtn);

        // It sets activeDisk. Since we clicked "Mount" on the item, 
        // HomeDiskManager sets activeDisk(entry). 
        // This opens the dialog "Mount {disk.name}".
        
        // Wait for dialog
        const dialog = await screen.findByRole('dialog');
        const driveABtn = within(dialog).getByRole('button', { name: /Drive A/ });
        fireEvent.click(driveABtn);

        await waitFor(() => {
             expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
                operation: 'DISK_MOUNT',
                title: 'Mount failed',
            }));
        });
    });

    it('eject failure reports error', async () => {
         const driveA = createMockDrive();
         driveA.image_file = 'test.d64';
         
         (useC64Drives as any).mockReturnValue({
            data: { drives: [{ a: driveA }, { b: createMockDrive() }] },
        });

        render(<HomeDiskManager />);

        mockApi.unmountDrive.mockRejectedValueOnce(new Error('Eject failed'));

        const ejectBtn = screen.getByRole('button', { name: 'Drive A Eject disk' });
        fireEvent.click(ejectBtn);

         await waitFor(() => {
             expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
                operation: 'DISK_EJECT',
                title: 'Eject failed',
            }));
        });
    });
});
