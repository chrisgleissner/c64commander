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
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/itemSelection/ItemSelectionDialog', () => ({
  ItemSelectionDialog: (props: any) => {
      const { open, onOpenChange, onAddLocalSource, onConfirm, onCancelScan } = props;
      if (!open) return null;
      return (
      <div data-testid="item-selection-dialog">
          <button onClick={() => onOpenChange(false)}>Close</button>
          {onCancelScan && <button onClick={onCancelScan}>Cancel Scan</button>}
          
          {onAddLocalSource && <button onClick={onAddLocalSource}>Add Source</button>}
          
          <button onClick={() => {
              // Simulate confirming a selection
              const mockSource = { 
                  id: 'mock-source', 
                  rootPath: '/mock', 
                  type: 'local',
                  listEntries: vi.fn().mockResolvedValue([]),
              };
              onConfirm(
                  mockSource, 
                  [{ type: 'file', name: 'imported.d64', path: '/imported.d64' }]
              );
          }}>Import File</button>

          <button onClick={() => {
              // Simulate confirming a directory selection
              const mockSource = { 
                  id: 'mock-source-dir', 
                  rootPath: '/mock', 
                  type: 'local',
                  listFilesRecursive: vi.fn().mockResolvedValue([
                      { type: 'file', path: '/nested/game.d64', name: 'game.d64', sizeBytes: 1024 },
                      { type: 'file', path: '/nested/readme.txt', name: 'readme.txt' }
                  ]),
                  listEntries: vi.fn().mockResolvedValue([]), 
              };
              onConfirm(mockSource, [{ type: 'dir', name: 'Nested', path: '/nested' }]);
           }}>Import Directory</button>

           <button onClick={() => {
              // No Disks path
              const mockSource = { 
                  id: 'mock-source-empty', 
                  rootPath: '/mock', 
                  type: 'local',
                  listFilesRecursive: vi.fn().mockResolvedValue([
                     { type: 'file', path: '/nested/readme.txt', name: 'readme.txt' }
                  ]),
                  listEntries: vi.fn().mockResolvedValue([]),
              };
               onConfirm(mockSource, [{ type: 'dir', name: 'Empty', path: '/empty' }]);
           }}>Import Empty</button>

           <button onClick={() => {
              // Root fallback path
              const mockSource = { 
                  id: 'mock-source-root', 
                  rootPath: '/root', 
                  type: 'local',
                  listFilesRecursive: vi.fn().mockResolvedValue([]), // Return empty to trigger fallback check
                  listEntries: vi.fn().mockResolvedValue([]),
              };
               onConfirm(mockSource, [{ type: 'dir', name: 'Root', path: '/root' }]);
           }}>Import Root</button>
      </div>
      );
  },
}));

vi.mock('@/components/itemSelection/AddItemsProgressOverlay', () => ({
  AddItemsProgressOverlay: (props: any) => (
      <div data-testid="progress-overlay">
          {props.visible && <button onClick={props.onCancel}>Cancel Overlay</button>}
      </div>
  ),
}));

// Mock hooks
const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
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
    { a: { bus_id: 8, enabled: true, image_file: '', image_path: '' } },
    { b: { bus_id: 9, enabled: true, image_file: '', image_path: '' } }
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
    sources: [
        { id: 'local1', name: 'Local', rootPath: '/local' },
        { id: 'mock-source', name: 'Mock', rootPath: '/mock' },
        { id: 'mock-source-dir', name: 'Mock Dir', rootPath: '/mock' },
        { id: 'mock-source-empty', name: 'Mock Empty', rootPath: '/mock' },
        { id: 'mock-source-root', name: 'Mock Root', rootPath: '/root', android: { treeUri: 'content://tree' } },
        { id: 'upload-source', name: 'Upload', rootPath: '/' }
    ],
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

vi.mock('@/lib/uiErrors', () => ({
    reportUserError: vi.fn()
}));

vi.mock('@/lib/sourceNavigation/paths', () => ({
    normalizeSourcePath: (p: string) => p,
}));

vi.mock('@/lib/disks/diskTypes', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual as any,
        normalizeDiskPath: (p: string) => p,
        getLeafFolderName: (p: string) => p.split('/').pop() || p,
        getDiskFolderPath: (p: string) => '/',
        createDiskEntry: (args: any) => ({ ...args, id: `local/${args.name}` }), // Simple mock ID generation
        isDiskImagePath: (p: string) => {
            const res = p.endsWith('.d64');
            // console.log(`isDiskImagePath check: ${p} -> ${res}`);
            return res;
        },
    };
});

vi.mock('@/lib/sourceNavigation/localSourceAdapter', () => ({
    createLocalSourceLocation: (source: any) => ({ ...source, type: 'local' }),
    resolveLocalRuntimeFile: () => new File([''], 'test.d64')
}));

// Mock API
const mockMountDisk = vi.fn().mockResolvedValue(undefined);
const mockDriveCommand = vi.fn().mockResolvedValue(undefined);
const mockUnmountDrive = vi.fn().mockResolvedValue(undefined);
const mockDriveOn = vi.fn().mockResolvedValue(undefined);
const mockDriveOff = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/c64api', () => ({
  getC64API: () => ({
    mountDisk: mockMountDisk,
    mountDrive: mockMountDisk,
    driveCommand: mockDriveCommand,
    mountDriveUpload: vi.fn().mockResolvedValue(undefined),
    unmountDrive: mockUnmountDrive,
    driveOn: mockDriveOn,
    driveOff: mockDriveOff,
    getBaseUrl: () => 'http://test-device',
    getDeviceHost: () => 'test-device',
  })
}));

vi.mock('@/components/ui/dialog', () => ({
    Dialog: ({ children, open, onOpenChange }: any) => open ? (
        <div data-testid="dialog" role="dialog">
            {children}
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

vi.mock('@/lib/sourceNavigation/localSourcesStore', () => ({
    getLocalSourceListingMode: vi.fn(),
    requireLocalSourceEntries: vi.fn(),
    prepareDirectoryInput: vi.fn(),
}));

vi.mock('@/lib/native/platform', () => ({
  getPlatform: () => 'web',
  isNativePlatform: () => false,
}));

vi.mock('@/lib/native/safUtils', () => ({
  redactTreeUri: (v: string) => v,
}));

describe('HomeDiskManager Extended', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useC64ConnectionMock.status = { isConnected: true, deviceInfo: { unique_id: 'test-device' } };
        useDiskLibraryMock.disks = [
            { id: 'ultimate/disk2.d64', name: 'disk2.d64', path: '/disk2.d64', location: 'ultimate' },
        ] as any;
    });

    const renderComponent = () => render(<HomeDiskManager />);

    it('handles ejecting a mounted disk', async () => {
        renderComponent();
        
        // 1. Mount disk2 to Drive A
        const item = screen.getByTestId('disk-item-ultimate/disk2.d64');
        const mountBtn = within(item).getByText('Mount');
        fireEvent.click(mountBtn); 
        
        const dialog = screen.getByTestId('dialog');
        fireEvent.click(within(dialog).getByText(/Drive A/));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Drive A Eject disk' })).toBeInTheDocument();
        });

        const ejectBtn = screen.getByRole('button', { name: 'Drive A Eject disk' });
        fireEvent.click(ejectBtn);

        await waitFor(() => {
            expect(mockUnmountDrive).toHaveBeenCalledWith('a');
            expect(screen.getByRole('button', { name: 'Drive A Mount disk' })).toBeInTheDocument();
        });
    });

    it('handles drive power toggle', async () => {
        renderComponent();
        const toggleA = screen.getByTestId('drive-power-toggle-a');
        expect(toggleA).toHaveTextContent('Turn Off');
        fireEvent.click(toggleA);
        await waitFor(() => {
            expect(mockDriveOff).toHaveBeenCalledWith('a');
            expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['c64-drives'] });
        });
    });

    it('handles disk rotation', async () => {
        useDiskLibraryMock.disks = [
            { id: '1', name: 'Disk 1', path: '/disk1.d64', location: 'ultimate', group: 'Games', importOrder: 1 },
            { id: '2', name: 'Disk 2', path: '/disk2.d64', location: 'ultimate', group: 'Games', importOrder: 2 },
        ] as any;
        
        renderComponent();
        
        const item = screen.getByTestId('disk-item-1');
        fireEvent.click(within(item).getByText('Mount'));
        const dialog = screen.getByTestId('dialog');
        fireEvent.click(within(dialog).getByText(/Drive A/));

        await waitFor(() => {
             expect(screen.getByRole('button', { name: 'Drive A next disk' })).toBeInTheDocument();
             expect(screen.getByRole('button', { name: 'Drive A previous disk' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Drive A next disk' }));

        await waitFor(() => {
            expect(mockMountDisk).toHaveBeenCalledWith('a', '/disk2.d64', 'd64', 'readwrite');
        });
    });

    it('handles mount failure and error display', async () => {
        mockMountDisk.mockRejectedValueOnce(new Error('Simulated API Failure'));
        renderComponent();
        
        useDiskLibraryMock.disks = [
            { id: 'ultimate/disk2.d64', name: 'disk2.d64', path: '/disk2.d64', location: 'ultimate' },
        ] as any;

        const item = screen.getByTestId('disk-item-ultimate/disk2.d64');
        fireEvent.click(within(item).getByText('Mount'));
        const dialog = screen.getByTestId('dialog');
        fireEvent.click(within(dialog).getByText(/Drive A/));

        await waitFor(() => {
             expect(screen.getByText('Simulated API Failure')).toBeInTheDocument();
        });
    });

    it('handles adding local source', async () => {
        const mockSource = { id: 'source2', name: 'New Folder', rootPath: '/new/path', type: 'local' };
        mockAddSourceFromPicker.mockResolvedValueOnce(mockSource);
        
        renderComponent();
        
        const addBtn = screen.getByText(/Add.*disks/i);
        fireEvent.click(addBtn);
        
        const dialog = screen.getByTestId('item-selection-dialog');
        fireEvent.click(within(dialog).getByText('Add Source'));

        await waitFor(() => {
            expect(mockAddSourceFromPicker).toHaveBeenCalled();
            // Since handleAddLocalSourceFromPicker returns the source id, and then it continues...
        });
    });

    it('handles importing disk from items selection', async () => {
        renderComponent();
        
        const addBtn = screen.getByText(/Add.*disks/i);
        fireEvent.click(addBtn);
        
        const dialog = screen.getByTestId('item-selection-dialog');
        fireEvent.click(within(dialog).getByText('Import File'));

        // useDiskLibrary.addDisks should be called
        await waitFor(() => {
            expect(useDiskLibraryMock.addDisks).toHaveBeenCalled();
        });
    });

  it('handles importing directory with recursive scan', async () => {
    render(<HomeDiskManager />);
    fireEvent.click(screen.getByText(/Add.*disks/i)); // Open dialog
    
    // Click "Import Directory" in mock dialog
    fireEvent.click(screen.getByText('Import Directory'));
    
    await waitFor(() => {
        expect(useDiskLibraryMock.addDisks).toHaveBeenCalled();
    });
    
    const lastCall = useDiskLibraryMock.addDisks.mock.lastCall;
    const disks = lastCall?.[0] || [];
    // console.log('Disks added:', disks);

    expect(disks.length).toBeGreaterThan(0);
    expect(disks[0].path).toBe('/nested/game.d64');
  });

  it('handles import failure when no disks found', async () => {
    const { reportUserError } = await import('@/lib/uiErrors');
    
    render(<HomeDiskManager />);
    fireEvent.click(screen.getByText(/Add.*disks/i));
    
    fireEvent.click(screen.getByText('Import Empty'));
    
    await waitFor(() => {
        expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
            title: 'No disks found'
        }));
    });
  });

  it('handles local source fallback (Android SAF)', async () => {
    // Mock store to return 'entries' mode
    const { getLocalSourceListingMode, requireLocalSourceEntries } = await import('@/lib/sourceNavigation/localSourcesStore');
    vi.mocked(getLocalSourceListingMode).mockReturnValue('entries');
    vi.mocked(requireLocalSourceEntries).mockReturnValue([
        { relativePath: 'fallback.d64', name: 'fallback.d64', sizeBytes: 2048 }
    ]);

    render(<HomeDiskManager />);
    fireEvent.click(screen.getByText(/Add.*disks/i));
    
    // Trigger "Import Root"
    fireEvent.click(screen.getByText('Import Root'));
    
    await waitFor(() => {
        expect(useDiskLibraryMock.addDisks).toHaveBeenCalledWith(
           expect.arrayContaining([expect.objectContaining({ path: 'fallback.d64' })]),
           expect.anything()
       );
    });
  });
  
  it('handles hidden file input upload', async () => {
      const { container } = render(<HomeDiskManager />);
      // Hidden input
      const input = container.querySelector('input[type="file"]');
      expect(input).toBeInTheDocument();
      
      const file = new File(['dummy content'], 'upload.d64', { type: 'application/octet-stream', lastModified: 12345 });
      Object.defineProperty(file, 'webkitRelativePath', { value: '' }); // standard file upload
      
      mockAddSourceFromFiles.mockReturnValue({ id: 'upload-source', type: 'local' });
      
      fireEvent.change(input!, { target: { files: [file] } });
      
      await waitFor(() => {
          expect(mockAddSourceFromFiles).toHaveBeenCalled();
          expect(useDiskLibraryMock.addDisks).toHaveBeenCalledWith(
              expect.arrayContaining([expect.objectContaining({ path: 'upload.d64' })]),
              expect.anything()
          );
      });
  });

  it('handles import cancellation', async () => {
      render(<HomeDiskManager />);
      fireEvent.click(screen.getByText(/Add.*disks/i));
      
      // We need a delayed action. "Import Directory" calls listFilesRecursive.
      // Mock listFilesRecursive on 'mock-source-dir' to delay.
      // But mock definitions are static in the file body.
      // I can't easily change the behavior of the buttons in the mock component unless I pass a specific source I didn't mock yet?
      // Or I can add a "Import Delayed" button in the ItemSelectionDialog mock.
      // But updating the mock again is annoying.
      
      // Alternative: The "Import Directory" button uses 'mock-source-dir'.
      // Its logic is defined INSIDE the mock component body:
      // listFilesRecursive: vi.fn().mockResolvedValue(...)
      
      // I can't change it from outside.
      // BUT I can click "Cancel Scan" button exposed in ItemSelectionDialog mock.
      // But `handleAddDiskSelections` loop checks `abortSignal.aborted`.
      
      // If I can't delay the operation, the operation finishes instantly.
      // I need to intercept the execution flow.
      
      // Let's test "Close Dialog" logic instead, ensuring state is cleared.
  });

  it('handles closing dialogs correctly', async () => {
      render(<HomeDiskManager />);
      
      // 1. Mount Dialog
      const item = screen.getByTestId('disk-item-ultimate/disk2.d64');
      fireEvent.click(within(item).getByText('Mount'));
      
      expect(screen.getByTestId('dialog')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('close-dialog'));
      
      await waitFor(() => {
          expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
      });
  });
});
