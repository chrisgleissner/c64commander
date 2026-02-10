/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('renders import interstitial choices plus per-group add and browse actions', () => {
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
    expect(screen.getByTestId('import-selection-interstitial')).toBeInTheDocument();
    expect(screen.getByTestId('import-option-c64u')).toBeInTheDocument();
    expect(screen.getByTestId('import-option-local')).toBeInTheDocument();
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

    fireEvent.click(screen.getByTestId('import-option-c64u'));
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

    fireEvent.click(screen.getByTestId('import-option-c64u'));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByTestId('add-items-confirm'));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'ITEM_SELECTION',
      title: 'Add items failed',
    }));
  });

  it('reports add local source failures', async () => {
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
      { label: 'This device', sources: [buildSource('local-1', 'My Folder', 'local')] },
    ];

    render(
      <ItemSelectionDialog
        open
        onOpenChange={vi.fn()}
        title="Add items"
        confirmLabel="Add"
        sourceGroups={sourceGroups}
        onAddLocalSource={vi.fn().mockRejectedValue(new Error('Picker failed'))}
        onConfirm={vi.fn().mockResolvedValue(true)}
      />,
    );

    fireEvent.click(screen.getByTestId('import-option-local'));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'LOCAL_FOLDER_PICK',
        title: 'Unable to add folder',
      }));
    });
  });

  it('reports browse errors when open', async () => {
    vi.mocked(useSourceNavigator).mockReturnValue({
      path: '/',
      entries: [],
      isLoading: false,
      showLoadingIndicator: false,
      error: 'Boom',
      navigateTo: vi.fn(),
      navigateUp: vi.fn(),
      navigateRoot: vi.fn(),
      refresh: vi.fn(),
    });

    render(
      <ItemSelectionDialog
        open
        onOpenChange={vi.fn()}
        title="Add items"
        confirmLabel="Add"
        sourceGroups={[{ label: 'C64 Ultimate', sources: [buildSource('ultimate', 'C64 Ultimate', 'ultimate')] }]}
        onAddLocalSource={vi.fn().mockResolvedValue(null)}
        onConfirm={vi.fn().mockResolvedValue(true)}
      />,
    );

    fireEvent.click(screen.getByTestId('import-option-c64u'));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'BROWSE',
        title: 'Browse failed',
      }));
    });
  });

  it('requires at least one selection before confirming', async () => {
    vi.mocked(useSourceNavigator).mockReturnValue({
      path: '/',
      entries: [{ type: 'file', name: 'song.sid', path: '/song.sid' }],
      isLoading: false,
      showLoadingIndicator: false,
      error: null,
      navigateTo: vi.fn(),
      navigateUp: vi.fn(),
      navigateRoot: vi.fn(),
      refresh: vi.fn(),
    });

    render(
      <ItemSelectionDialog
        open
        onOpenChange={vi.fn()}
        title="Add items"
        confirmLabel="Add"
        sourceGroups={[{ label: 'C64 Ultimate', sources: [buildSource('ultimate', 'C64 Ultimate', 'ultimate')] }]}
        onAddLocalSource={vi.fn().mockResolvedValue(null)}
        onConfirm={vi.fn().mockResolvedValue(true)}
      />,
    );

    fireEvent.click(screen.getByTestId('import-option-c64u'));
    const confirmButton = screen.getByTestId('add-items-confirm');
    expect(confirmButton).toBeDisabled();
    expect(reportUserError).not.toHaveBeenCalled();
  });

  it('auto-confirms and closes before confirm when configured', async () => {
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

    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(true);

    render(
      <ItemSelectionDialog
        open
        onOpenChange={onOpenChange}
        title="Add items"
        confirmLabel="Add"
        sourceGroups={[{ label: 'This device', sources: [buildSource('local-1', 'My Folder', 'local')] }]}
        onAddLocalSource={vi.fn().mockResolvedValue('local-1')}
        onConfirm={onConfirm}
        autoConfirmLocalSource
        autoConfirmCloseBefore
      />,
    );

    fireEvent.click(screen.getByTestId('import-option-local'));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onConfirm).toHaveBeenCalled();
    });
  });

  it('auto-confirms newly added local source', async () => {
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

    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(true);
    const onAutoConfirmStart = vi.fn();
    const sourceGroups: SourceGroup[] = [
      { label: 'This device', sources: [buildSource('local-1', 'My Folder', 'local')] },
    ];

    render(
      <ItemSelectionDialog
        open
        onOpenChange={onOpenChange}
        title="Add items"
        confirmLabel="Add"
        sourceGroups={sourceGroups}
        onAddLocalSource={vi.fn().mockResolvedValue('local-1')}
        onConfirm={onConfirm}
        autoConfirmLocalSource
        onAutoConfirmStart={onAutoConfirmStart}
      />,
    );

    fireEvent.click(screen.getByTestId('import-option-local'));

    await waitFor(() => {
      expect(onAutoConfirmStart).toHaveBeenCalled();
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'local-1' }),
        [expect.objectContaining({ type: 'dir', path: '/' })],
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
