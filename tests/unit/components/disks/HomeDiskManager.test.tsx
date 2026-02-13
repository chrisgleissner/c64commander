/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { HomeDiskManager } from '@/components/disks/HomeDiskManager';

// Mock child components
vi.mock('@/components/lists/SelectableActionList', () => ({
  SelectableActionList: ({ items, headerActions, onRemoveSelected }: any) => (
    <div data-testid="mock-action-list">
      <div data-testid="header-actions">{headerActions}</div>
      {onRemoveSelected && <button onClick={onRemoveSelected}>Delete Selected</button>}
      {items.map((item: any) => (
        <div key={item.id} data-testid={`disk-item-${item.id}`}>
          <span data-testid="disk-title">{item.title}</span>
          {/* Primary Action (Mount) */}
          {item.onAction && <button onClick={item.onAction}>Mount</button>}

          {/* Menu Actions */}
          {item.menuItems?.map((menu: any, idx: number) => (
            menu.type === 'action' ? (
              <button key={idx} onClick={menu.onSelect}>{menu.label}</button>
            ) : null
          ))}

          {/* Selection */}
          <button
            data-testid={`select-${item.id}`}
            onClick={() => item.onSelectToggle && item.onSelectToggle(!item.selected)}
          >
            {item.selected ? 'Selected' : 'Select'}
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/itemSelection/ItemSelectionDialog', () => ({
  ItemSelectionDialog: ({ open, onClose }: any) => open ? <div data-testid="item-selection-dialog"><button onClick={onClose}>Close</button></div> : null,
}));

vi.mock('@/components/itemSelection/AddItemsProgressOverlay', () => ({
  AddItemsProgressOverlay: () => <div data-testid="progress-overlay" />,
}));

// Mock hooks
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    fetchQuery: vi.fn().mockResolvedValue(undefined),
  }),
}));

const useDiskLibraryMock = {
  disks: [],
  runtimeFiles: {},
  addDisks: vi.fn(),
  updateDiskGroup: vi.fn(),
  updateDiskName: vi.fn(),
  removeDisk: vi.fn(),
  bulkRemoveDisks: vi.fn(),
};

vi.mock('@/hooks/useDiskLibrary', () => ({
  useDiskLibrary: () => useDiskLibraryMock,
}));

const mockStatus = {
  isConnected: true,
  deviceInfo: { unique_id: 'test-device' }
};

const mockDrivesData = {
  drives: [
    { a: { bus_id: 8, enabled: true } },
    { b: { bus_id: 9, enabled: true } }
  ]
};

const useC64ConnectionMock = {
  status: mockStatus,
};
const useC64DrivesMock = {
  data: mockDrivesData
};

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => useC64ConnectionMock,
  useC64Drives: () => useC64DrivesMock,
  useC64ConfigItems: () => ({ data: undefined }),
}));

const mockAddSourceFromPicker = vi.fn();
const mockAddSourceFromFiles = vi.fn();

vi.mock('@/hooks/useLocalSources', () => ({
  useLocalSources: () => ({
    sources: [],
    addSourceFromPicker: mockAddSourceFromPicker,
    addSourceFromFiles: mockAddSourceFromFiles,
  }),
}));

vi.mock('@/hooks/useListPreviewLimit', () => ({
  useListPreviewLimit: () => ({ limit: 100 })
}));

vi.mock('@/hooks/useActionTrace', () => ({
  useActionTrace: () => ((fn: any) => fn)
}));

// Mock API
const mockMountDisk = vi.fn().mockResolvedValue(undefined);
const mockDriveCommand = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/c64api', () => ({
  getC64API: () => ({
    mountDisk: mockMountDisk,
    mountDrive: mockMountDisk,
    driveCommand: mockDriveCommand,
    mountDriveUpload: vi.fn().mockResolvedValue(undefined),
    getBaseUrl: () => 'http://test-device',
    getDeviceHost: () => 'test-device',
    unmountDrive: vi.fn().mockResolvedValue(undefined),
  })
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open, onOpenChange }: any) => open ? (
    <div data-testid="dialog" role="dialog">
      {children}
      {/* Helper to close dialog since we can't click overlay in simplified mock */}
      <button data-testid="close-dialog" onClick={() => onOpenChange(false)}>Close Dialog</button>
    </div>
  ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input {...props} />
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn()
}));

vi.mock('@/lib/native/platform', () => ({
  getPlatform: () => 'web',
  isNativePlatform: () => false,
}));

vi.mock('@/lib/native/safUtils', () => ({
  redactTreeUri: (v: string) => v,
}));

describe('HomeDiskManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset hooks return values
    useC64ConnectionMock.status = { isConnected: true, deviceInfo: { unique_id: 'test-device' } };
    useC64DrivesMock.data = mockDrivesData as any;
    useDiskLibraryMock.disks = [
      { id: 'local/disk1.d64', name: 'disk1.d64', path: '/disk1.d64', location: 'local' },
      { id: 'ultimate/disk2.d64', name: 'disk2.d64', path: '/disk2.d64', location: 'ultimate' },
    ] as any;
    useDiskLibraryMock.runtimeFiles = {
      'local/disk1.d64': new File([''], 'disk1.d64'),
    };
  });

  const renderComponent = () => render(<HomeDiskManager />);

  it('renders drives and disk list', () => {
    renderComponent();
    expect(screen.getByText('Drive A')).toBeInTheDocument();
    expect(screen.getByText('Drive B')).toBeInTheDocument();
    expect(screen.queryByText(/^Printer$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset printer/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('No disk mounted').length).toBeGreaterThan(0);
    expect(screen.getByText('disk1.d64')).toBeInTheDocument();
    expect(screen.getByText('disk2.d64')).toBeInTheDocument();
  });

  it('shows mounted disk label with name when disk is present', () => {
    useC64DrivesMock.data = {
      drives: [
        { a: { bus_id: 8, enabled: true, image_file: 'mounted-demo.d64', image_path: '/' } },
        { b: { bus_id: 9, enabled: true } },
      ],
    } as any;

    renderComponent();

    expect(screen.getByText('mounted-demo.d64')).toBeInTheDocument();
  });

  it('suppresses non-actionable Soft IEC service error baseline text', () => {
    useC64DrivesMock.data = {
      drives: [
        { a: { bus_id: 8, enabled: true } },
        { b: { bus_id: 9, enabled: true } },
        { softiec: { bus_id: 11, enabled: true, last_error: 'service error reported' } },
      ],
    } as any;

    renderComponent();

    expect(screen.queryByText(/service error reported/i)).not.toBeInTheDocument();
  });

  it('renders actionable Soft IEC errors from device state', () => {
    useC64DrivesMock.data = {
      drives: [
        { a: { bus_id: 8, enabled: true } },
        { b: { bus_id: 9, enabled: true } },
        { softiec: { bus_id: 11, enabled: true, last_error: 'Directory unavailable' } },
      ],
    } as any;

    renderComponent();

    expect(screen.getByText('Directory unavailable')).toBeInTheDocument();
  });

  it('renders DOS status as message line above raw line without details overlay', () => {
    useC64DrivesMock.data = {
      drives: [
        { a: { bus_id: 8, enabled: true } },
        { b: { bus_id: 9, enabled: true } },
        { softiec: { bus_id: 11, enabled: true, last_error: '74,DRIVE NOT READY,00,00' } },
      ],
    } as any;

    renderComponent();

    expect(screen.getByTestId('drive-status-message-soft-iec')).toHaveTextContent('DRIVE NOT READY');
    expect(screen.getByTestId('drive-status-raw-soft-iec')).toHaveTextContent('74,DRIVE NOT READY,00,00');
    expect(screen.queryByTestId('drive-status-details-text')).not.toBeInTheDocument();
    expect(screen.queryByText('Message:')).not.toBeInTheDocument();
    expect(screen.queryByText('Details:')).not.toBeInTheDocument();
  });

  it('handles mount flow', async () => {
    renderComponent();

    // Find disk 2 (Ultimate)
    const item = screen.getByTestId('disk-item-ultimate/disk2.d64');
    const mountBtn = within(item).getByText('Mount');
    fireEvent.click(mountBtn);

    // Expect dialog to open
    const dialog = screen.getByTestId('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Mount disk2.d64/)).toBeInTheDocument();

    // Click Drive A button in dialog
    // Drives in the dialog are rendered as Buttons with "Drive A (#8)" label, etc.
    const driveABtn = within(dialog).getByText(/Drive A/);
    fireEvent.click(driveABtn);

    await waitFor(() => {
      expect(mockMountDisk).toHaveBeenCalledWith('a', '/disk2.d64', 'd64', 'readwrite');
    });
  });

  it('handles rename flow', () => {
    renderComponent();
    const item = screen.getByTestId('disk-item-local/disk1.d64');
    fireEvent.click(within(item).getByText('Rename disk…'));

    const dialog = screen.getByTestId('dialog');
    expect(within(dialog).getByText('Rename disk')).toBeInTheDocument();

    const input = within(dialog).getByDisplayValue('disk1.d64');
    fireEvent.change(input, { target: { value: 'cool-disk.d64' } });

    fireEvent.click(within(dialog).getByText('Save'));

    expect(useDiskLibraryMock.updateDiskName).toHaveBeenCalledWith('local/disk1.d64', 'cool-disk.d64');
  });

  it('handles group assignment', () => {
    renderComponent();
    const item = screen.getByTestId('disk-item-local/disk1.d64');
    fireEvent.click(within(item).getByText('Set group…'));

    const dialog = screen.getByTestId('dialog');
    expect(within(dialog).getByText('Set group')).toBeInTheDocument();

    const input = within(dialog).getByPlaceholderText('Enter a group name');
    fireEvent.change(input, { target: { value: 'Games' } });

    fireEvent.click(within(dialog).getByText('Create & assign'));

    expect(useDiskLibraryMock.updateDiskGroup).toHaveBeenCalledWith('local/disk1.d64', 'Games');
  });

  it('handles deletion flow', () => {
    renderComponent();
    const item = screen.getByTestId('disk-item-local/disk1.d64');
    fireEvent.click(within(item).getByText('Remove from collection'));

    const dialog = screen.getByTestId('dialog');
    expect(within(dialog).getByText('Remove disk?')).toBeInTheDocument();
    expect(within(dialog).getByText('Remove')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText('Remove'));

    // Since handleDeleteDisk is internal, we can check if removeDisk was called
    // But handleDeleteDisk calls diskLibrary.removeDisk
    expect(useDiskLibraryMock.removeDisk).toHaveBeenCalledWith('local/disk1.d64');
  });

  it('handles bulk delete', async () => {
    renderComponent();
    // Select both items
    const item1 = screen.getByTestId('disk-item-local/disk1.d64');
    const item2 = screen.getByTestId('disk-item-ultimate/disk2.d64');

    fireEvent.click(within(item1).getByText('Select'));
    fireEvent.click(within(item2).getByText('Select'));

    const deleteBtn = screen.getByText('Delete Selected');
    fireEvent.click(deleteBtn);

    const dialog = screen.getByTestId('dialog');
    expect(within(dialog).getByText(/Remove selected disks\?/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText('Remove'));

    // handleBulkDelete calls removeDisk individually for selected items (and unmounts if needed)
    await waitFor(() => {
      expect(useDiskLibraryMock.removeDisk).toHaveBeenCalledTimes(2);
      expect(useDiskLibraryMock.removeDisk).toHaveBeenCalledWith('local/disk1.d64');
      expect(useDiskLibraryMock.removeDisk).toHaveBeenCalledWith('ultimate/disk2.d64');
    });
  });

  it('opens item browser', () => {
    renderComponent();
    // The mock renders headerActions. The button text is 'Add disks' or 'Add more disks'.
    const addBtn = screen.getByText(/Add.*disks/i);
    fireEvent.click(addBtn);
    expect(screen.getByTestId('item-selection-dialog')).toBeInTheDocument();
  });
});
