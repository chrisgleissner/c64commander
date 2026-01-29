import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';
import { useSourceNavigator } from '@/lib/sourceNavigation/useSourceNavigator';
import type { SourceEntry } from '@/lib/sourceNavigation/types';
import { reportUserError } from '@/lib/uiErrors';

vi.mock('@/lib/sourceNavigation/useSourceNavigator', () => ({
  useSourceNavigator: vi.fn(),
}));

vi.mock('@/lib/uiErrors', () => ({
  reportUserError: vi.fn(),
}));

const buildSource = (id: string, name: string, type: 'ultimate' | 'local') => ({
  id,
  name,
  type,
  rootPath: '/',
  isAvailable: true,
  listEntries: async () => [],
  listFilesRecursive: async () => [],
});

describe('ItemSelectionDialog source picker', () => {
  it('renders only add file/folder buttons for each source group', () => {
    vi.mocked(useSourceNavigator).mockReturnValue({
      path: '/',
      entries: [],
      isLoading: false,
      showLoadingIndicator: false,
      error: null,
      navigateTo: vi.fn(),
      navigateUp: vi.fn(),
      navigateRoot: vi.fn(),
      refresh: vi.fn(),
    });
    const sourceGroups: SourceGroup[] = [
      { label: 'C64 Ultimate', sources: [buildSource('ultimate', 'C64 Ultimate', 'ultimate')] },
      { label: 'This device', sources: [buildSource('local-1', 'My Folder', 'local')] },
    ];

    render(
      <ItemSelectionDialog
        open
        onOpenChange={vi.fn()}
        title="Add items"
        confirmLabel="Add"
        sourceGroups={sourceGroups}
        onAddLocalSource={vi.fn().mockResolvedValue(null)}
        onConfirm={vi.fn().mockResolvedValue(true)}
      />,
    );

    const addButtons = screen.getAllByRole('button', { name: /add file \/ folder/i });
    expect(addButtons).toHaveLength(2);
    expect(screen.queryByText('My Folder')).toBeNull();
  });

  it('filters entries and confirms selection', async () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(true);
    const entries: SourceEntry[] = [
      { type: 'file', name: 'song.sid', path: '/song.sid' },
      { type: 'file', name: 'notes.txt', path: '/notes.txt' },
      { type: 'dir', name: 'Folder', path: '/Folder' },
    ];
    vi.mocked(useSourceNavigator).mockReturnValue({
      path: '/',
      entries,
      isLoading: false,
      showLoadingIndicator: false,
      error: null,
      navigateTo: vi.fn(),
      navigateUp: vi.fn(),
      navigateRoot: vi.fn(),
      refresh: vi.fn(),
    });

    const sourceGroups: SourceGroup[] = [
      { label: 'C64 Ultimate', sources: [buildSource('ultimate', 'C64 Ultimate', 'ultimate')] },
    ];

    render(
      <ItemSelectionDialog
        open
        onOpenChange={onOpenChange}
        title="Add items"
        confirmLabel="Add"
        sourceGroups={sourceGroups}
        onAddLocalSource={vi.fn().mockResolvedValue(null)}
        onConfirm={onConfirm}
        filterEntry={(entry) => entry.path.endsWith('.sid')}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /add file \/ folder/i }));
    expect(screen.getByTestId('add-items-filter')).toBeInTheDocument();

    expect(screen.queryByText('notes.txt')).toBeNull();
    expect(screen.getByText('song.sid')).toBeInTheDocument();
    expect(screen.getByText('Folder')).toBeInTheDocument();

    const checkbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(checkbox);
    expect(screen.getByTestId('add-items-selection-count')).toHaveTextContent('1 selected');

    fireEvent.click(screen.getByTestId('add-items-confirm'));
    await vi.runAllTimersAsync();

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ultimate' }),
      [expect.objectContaining({ type: 'file', name: 'song.sid', path: '/song.sid' })],
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    vi.useRealTimers();
  });

  it('reports an error when confirmation fails', async () => {
    const entries: SourceEntry[] = [
      { type: 'file', name: 'song.sid', path: '/song.sid' },
    ];
    vi.mocked(useSourceNavigator).mockReturnValue({
      path: '/',
      entries,
      isLoading: false,
      showLoadingIndicator: false,
      error: null,
      navigateTo: vi.fn(),
      navigateUp: vi.fn(),
      navigateRoot: vi.fn(),
      refresh: vi.fn(),
    });

    const sourceGroups: SourceGroup[] = [
      { label: 'C64 Ultimate', sources: [buildSource('ultimate', 'C64 Ultimate', 'ultimate')] },
    ];

    render(
      <ItemSelectionDialog
        open
        onOpenChange={vi.fn()}
        title="Add items"
        confirmLabel="Add"
        sourceGroups={sourceGroups}
        onAddLocalSource={vi.fn().mockResolvedValue(null)}
        onConfirm={vi.fn().mockRejectedValue(new Error('Failed to add'))}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /add file \/ folder/i }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByTestId('add-items-confirm'));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'ITEM_SELECTION',
      title: 'Add items failed',
    }));
  });
});
