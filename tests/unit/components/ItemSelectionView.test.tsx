import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ItemSelectionView } from '@/components/itemSelection/ItemSelectionView';
import type { SourceEntry } from '@/lib/sourceNavigation/types';

const entries: SourceEntry[] = [
  { type: 'file', name: 'Track.sid', path: '/music/Track.sid' },
  { type: 'dir', name: 'Demos', path: '/music/Demos' },
];

describe('ItemSelectionView', () => {
  it('renders entries and wires navigation actions', () => {
    const onToggleSelect = vi.fn();
    const onOpen = vi.fn();
    const onNavigateUp = vi.fn();
    const onNavigateRoot = vi.fn();
    const onRefresh = vi.fn();
    const selection = new Map<string, SourceEntry>([[entries[0].path, entries[0]]]);

    render(
      <ItemSelectionView
        path="/music"
        rootPath="/"
        entries={entries}
        isLoading={false}
        showLoadingIndicator
        selection={selection}
        onToggleSelect={onToggleSelect}
        onOpen={onOpen}
        onNavigateUp={onNavigateUp}
        onNavigateRoot={onNavigateRoot}
        onRefresh={onRefresh}
        showFolderSelect
        emptyLabel="Empty"
      />,
    );

    expect(screen.getByTestId('ftp-loading')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('navigate-root'));
    fireEvent.click(screen.getByRole('button', { name: /up/i }));
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    fireEvent.click(screen.getByRole('button', { name: /open/i }));

    expect(onNavigateRoot).toHaveBeenCalledTimes(1);
    expect(onNavigateUp).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onToggleSelect).toHaveBeenCalledWith(entries[0]);
    expect(onOpen).toHaveBeenCalledWith(entries[1].path);
  });

  it('disables selection and navigation at root when loading', () => {
    const onToggleSelect = vi.fn();
    const onOpen = vi.fn();

    render(
      <ItemSelectionView
        path="/"
        rootPath="/"
        entries={[entries[1]]}
        isLoading
        selection={new Map()}
        onToggleSelect={onToggleSelect}
        onOpen={onOpen}
        onNavigateUp={vi.fn()}
        onNavigateRoot={vi.fn()}
        onRefresh={vi.fn()}
        showFolderSelect={false}
        emptyLabel="Empty"
      />,
    );

    expect(screen.getByTestId('navigate-root')).toBeDisabled();
    expect(screen.getByRole('button', { name: /up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();

    const [checkbox] = screen.getAllByRole('checkbox');
    expect(checkbox).toBeDisabled();
    fireEvent.click(checkbox);

    expect(onToggleSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
