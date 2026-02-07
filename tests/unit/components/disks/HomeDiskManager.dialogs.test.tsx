import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { HomeDiskManager } from '@/components/disks/HomeDiskManager';

// --- MOCKS ---

vi.mock('@/components/lists/SelectableActionList', () => ({
  SelectableActionList: ({ items, headerActions, onRemoveSelected, selectedCount }: any) => (
    <div data-testid="mock-action-list">
      <div data-testid="header-actions">{headerActions}</div>
      {selectedCount > 0 && <button onClick={onRemoveSelected}>Delete Selected</button>}
      
      {items.map((item: any) => (
        <div key={item.id} data-testid={`disk-item-${item.id}`}>
          <span data-testid="disk-title">{item.title}</span>
          {/* Primary Action (Mount) */}
          {item.onAction && <button onClick={item.onAction}>Mount</button>}
          
          <div data-testid={`menu-${item.id}`}>
            {item.menuItems?.map((menuItem: any, idx: number) => {
               if (menuItem.type === 'action') {
                 return (
                   <button 
                     key={idx} 
                     onClick={menuItem.onSelect}
                     aria-label={menuItem.label}
                   >
                     {menuItem.label}
                   </button>
                 )
               }
               return null;
            })}
          </div>
            <input 
                type="checkbox" 
                checked={item.selected} 
                onChange={(e) => item.onSelectToggle(e.target.checked)}
                data-testid={`checkbox-${item.id}`}
            />
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/itemSelection/ItemSelectionDialog', () => ({ ItemSelectionDialog: () => null }));
vi.mock('@/components/itemSelection/AddItemsProgressOverlay', () => ({ AddItemsProgressOverlay: () => null }));
vi.mock('@/components/FileOriginIcon', () => ({ FileOriginIcon: () => null }));

const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    fetchQuery: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockDiskLibrary = {
  disks: [],
  runtimeFiles: {},
  addDisks: vi.fn(),
  updateDiskGroup: vi.fn(),
  updateDiskName: vi.fn(),
  removeDisk: vi.fn(),
};

vi.mock('@/hooks/useDiskLibrary', () => ({ useDiskLibrary: () => mockDiskLibrary }));

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => ({ status: { isConnected: true, deviceInfo: { unique_id: 'test' } } }),
  useC64Drives: () => ({ data: { drives: [] } }),
  useC64ConfigItems: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useLocalSources', () => ({ useLocalSources: () => ({ sources: [], addSourceFromPicker: vi.fn(), addSourceFromFiles: vi.fn() }) }));
vi.mock('@/hooks/useListPreviewLimit', () => ({ useListPreviewLimit: () => ({ limit: 100 }) }));
vi.mock('@/hooks/useActionTrace', () => ({ useActionTrace: () => (fn: any) => fn }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/uiErrors', () => ({ reportUserError: vi.fn() }));
vi.mock('@/lib/logging', () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));
vi.mock('@/lib/c64api', () => ({ getC64API: () => ({ unmountDrive: vi.fn(), driveOn: vi.fn(), driveOff: vi.fn(), getBaseUrl: () => '', getDeviceHost: () => '' }) }));
vi.mock('@/lib/disks/diskMount', () => ({ mountDiskToDrive: vi.fn() }));
import { mountDiskToDrive } from '@/lib/disks/diskMount';

// --- TESTS ---

describe('HomeDiskManager Dialogs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDiskLibrary.disks = [
             { id: '1', name: 'DiskOne.d64', path: '/DiskOne.d64', group: 'Games', location: 'local' },
             { id: '2', name: 'DiskTwo.d64', path: '/DiskTwo.d64', group: null, location: 'ultimate' },
        ] as any;
    });

    it('handles mounting a disk to a specific drive via dialog', async () => {
      // 1. Click "Mount..." on Drive A
      const { getAllByText, getByText, getAllByTestId } = render(<HomeDiskManager />);
      
      // Drive mount buttons. In the code: <Button ...>Mount…</Button>
      // My code renders "Mount…"
      const mountDriveButtons = getAllByText('Mount…');
      // Assuming first one is Drive A, second is Drive B?
      // Drives are rendered via map over DRIVE_KEYS ['a', 'b'].
      fireEvent.click(mountDriveButtons[0]); // Drive A
      
      // Dialog opens. SelectableActionList with "Available disks" title renders.
      // We need to click "Mount" on a disk inside this dialog.
      // The Mock action list renders buttons "Mount".
      // Be careful: The main list is also rendered in the background? 
      // Radix Dialog usually renders in a Portal, but `SelectableActionList` mock renders `mock-action-list`.
      // We will have TWO lists now.
      
      const lists = getAllByTestId('mock-action-list');
      expect(lists.length).toBe(2); // Main list + Dialog list
      
      // The second list should be the dialog one (rendered last/in portal)
      const dialogList = lists[1];
      const mountBtn = within(dialogList).getAllByText('Mount')[0]; // Pick first disk
      
      fireEvent.click(mountBtn);
      
      await waitFor(() => {
        expect(mountDiskToDrive).toHaveBeenCalledWith(
          expect.anything(), 
          'a', 
          expect.objectContaining({ id: '1' }), 
          undefined // runtimeFile
        );
      });
    });

    it('handles mounting a specific disk to a drive via dialog', async () => {
      // 1. Click "Mount" on a disk in the main list
      const { getAllByTestId, getByText } = render(<HomeDiskManager />);
      const lists = getAllByTestId('mock-action-list');
      const mainList = lists[0];
      
      // Find "Mount" button for Disk 1 in main list
      // My mock ActionList renders: {item.onAction && <button onClick={item.onAction}>Mount</button>}
      const mountButtons = within(mainList).getAllByText('Mount');
      fireEvent.click(mountButtons[0]); // Disk 1
      
      // Dialog "Mount DiskOne.d64" opens.
      // It loops over drives: <Button ...>{buildDriveLabel(key)}...</Button>
      // "Drive A (#8)"
      
      // We need to find the button for Drive B to vary it up.
      // Text: "Drive B (#9)" based on my mockDrivesData which defaults to bus 8/9.
      // Wait, mockDrivesData is mocked in this file?
      // Yes: useC64Drives: () => ({ data: { drives: [] } }) is WRONG.
      // The extended test had correct structure. I copied simplified versions.
      // I need to fix useC64Drives mock to return proper drive data for the button text to appear correctly.
      
      // Actually my current mock in this file:
      // useC64Drives: () => ({ data: { drives: [] } }),
      // This means valid drive buttons might NOT render inside the dialog because `driveRows` relies on `drivesData`?
      // No, `DRIVE_KEYS` is constant. But `info` comes from `drivesData`.
      // If `drives` is empty, `info` is undefined.
      // `buildDriveLabel` works (Drive A).
      // Button text: "{buildDriveLabel(key)} (#{info?.bus_id ?? '—'}) {mounted ? '• mounted' : ''}"
      // "Drive A (#—)"
      
      const dialog = screen.getByRole('dialog', { name: /Mount DiskOne.d64/i });
      const driveBBtn = within(dialog).getByText((content) => content.includes('Drive B')); // Scoped

      fireEvent.click(driveBBtn);
      
      await waitFor(() => {
        expect(mountDiskToDrive).toHaveBeenCalledWith(
          expect.anything(), 
          'b', 
          expect.objectContaining({ id: '1' }), 
          undefined
        );
      });
    });

    it('handles renaming a disk', async () => {
        render(<HomeDiskManager />);
        
        const disk1 = screen.getByTestId('disk-item-1');
        const renameBtn = within(disk1).getByText('Rename disk…');
        fireEvent.click(renameBtn);

        const input = await screen.findByDisplayValue('DiskOne.d64');
        fireEvent.change(input, { target: { value: 'Renamed.d64' } });
        
        const saveBtn = screen.getByText('Save');
        fireEvent.click(saveBtn);
        
        expect(mockDiskLibrary.updateDiskName).toHaveBeenCalledWith('1', 'Renamed.d64');
    });

    it('handles updating disk group (new group)', async () => {
        render(<HomeDiskManager />);
        
        const disk2 = screen.getByTestId('disk-item-2');
        const setGroupBtn = within(disk2).getByText('Set group…');
        fireEvent.click(setGroupBtn);
        
        const input = await screen.findByPlaceholderText('Enter a group name');
        fireEvent.change(input, { target: { value: 'NewGroup' } });
        
        const createBtn = screen.getByText('Create & assign');
        fireEvent.click(createBtn);

        expect(mockDiskLibrary.updateDiskGroup).toHaveBeenCalledWith('2', 'NewGroup');
    });

    it('handles updating disk group (existing group)', async () => {
        render(<HomeDiskManager />);
        
        const disk2 = screen.getByTestId('disk-item-2');
        const setGroupBtn = within(disk2).getByText('Set group…');
        fireEvent.click(setGroupBtn);
        
        const existingGroupBtn = await screen.findByText('Games'); 
        fireEvent.click(existingGroupBtn);
        
        expect(mockDiskLibrary.updateDiskGroup).toHaveBeenCalledWith('2', 'Games');
    });

    it('handles updating disk group (new group) via Enter key', async () => {
        render(<HomeDiskManager />);
        
        const disk2 = screen.getByTestId('disk-item-2');
        const setGroupBtn = within(disk2).getByText('Set group…');
        fireEvent.click(setGroupBtn);
        
        const input = await screen.findByPlaceholderText('Enter a group name');
        fireEvent.change(input, { target: { value: 'EnterGroup' } });
        
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

        expect(mockDiskLibrary.updateDiskGroup).toHaveBeenCalledWith('2', 'EnterGroup');
    });

    it('handles single disk deletion', async () => {
        render(<HomeDiskManager />);
        
        const disk1 = screen.getByTestId('disk-item-1');
        const menuRemoveBtn = within(disk1).getByText('Remove from collection');
        fireEvent.click(menuRemoveBtn);
        
        expect(screen.getByText('Remove disk?')).toBeInTheDocument();
        
        // Find the "Remove" button in the dialog (not the menu)
        // Since dialog is open, screen.getByText('Remove') might find two if we aren't careful, 
        // but the menu button is "Remove from collection". The dialog button is "Remove".
        const confirmBtn = screen.getByRole('button', { name: 'Remove' });
        fireEvent.click(confirmBtn);
        
        expect(mockDiskLibrary.removeDisk).toHaveBeenCalledWith('1');
    });
    
    it('handles bulk deletion', async () => {
        render(<HomeDiskManager />);
        
        const check1 = screen.getByTestId('checkbox-1');
        const check2 = screen.getByTestId('checkbox-2');
        
        fireEvent.click(check1);
        fireEvent.click(check2);
        
        const deleteSelectedBtn = screen.getByText('Delete Selected');
        fireEvent.click(deleteSelectedBtn);
        
        expect(screen.getByText('Remove selected disks?')).toBeInTheDocument();
        
        const confirmBtn = screen.getByRole('button', { name: 'Remove' });
        fireEvent.click(confirmBtn);
        
        await waitFor(() => {
             expect(mockDiskLibrary.removeDisk).toHaveBeenCalledWith('1');
             expect(mockDiskLibrary.removeDisk).toHaveBeenCalledWith('2');
        });
    });
});
