/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectableActionList, type ActionListItem } from '@/components/lists/SelectableActionList';

describe('SelectableActionList view-all wrapping', () => {
  it('keeps long subtitles wrapped in view-all dialog', () => {
    const items: ActionListItem[] = [
      {
        id: '1',
        title: 'Track One',
        subtitle: '/very/long/path/that/should/wrap/when/rendered/in/the/dialog/view/all/list/item.sid',
        subtitleTestId: 'subtitle-long',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
      {
        id: '2',
        title: 'Track Two',
        subtitle: '/another/really/long/path/that/should/wrap/without/overflow.sid',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];

    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={1}
        viewAllTitle="Playlist"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /view all/i }));

    const subtitles = screen.getAllByTestId('subtitle-long');
    expect(subtitles.length).toBeGreaterThan(0);
    subtitles.forEach((node) => {
      expect(node.className).toContain('break-words');
      expect(node.className).toContain('whitespace-normal');
      expect(node.className).toContain('max-w-full');
    });
  });

  it('filters items by text and keeps matching header', () => {
    const items: ActionListItem[] = [
      {
        id: 'header:/Music',
        title: '/Music',
        variant: 'header',
        selected: false,
        actionLabel: 'Play',
      },
      {
        id: 'track-1',
        title: 'Alpha.sid',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
      {
        id: 'track-2',
        title: 'Bravo.sid',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];

    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        listTestId="list"
        rowTestId="row"
      />,
    );

    const filter = screen.getByTestId('list-filter-input');
    fireEvent.change(filter, { target: { value: 'Bravo' } });

    const list = screen.getByTestId('list');
    expect(within(list).getByTestId('row-header')).toBeInTheDocument();
    expect(within(list).queryByText('Alpha.sid')).toBeNull();
    expect(within(list).getByText('Bravo.sid')).toBeInTheDocument();
  });

  it('renders long titles with wrapping classes', () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'A/very/long/path/that/should/wrap/without/ellipsis/or/truncation.sid',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];

    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
      />,
    );

    const title = screen.getByText(/A\/very\/long\/path/);
    expect(title.className).toContain('whitespace-normal');
    expect(title.className).toContain('break-words');
    expect(title.className).not.toContain('truncate');
  });

  it('hides headers when no items match and restores after clearing filter', () => {
    const items: ActionListItem[] = [
      {
        id: 'header:/Music',
        title: '/Music',
        variant: 'header',
        selected: false,
        actionLabel: 'Play',
      },
      {
        id: 'track-1',
        title: 'Alpha.sid',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];

    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        listTestId="list"
        rowTestId="row"
      />,
    );

    const filter = screen.getByTestId('list-filter-input');
    fireEvent.change(filter, { target: { value: 'Zulu' } });

    const list = screen.getByTestId('list');
    expect(within(list).queryByTestId('row-header')).toBeNull();
    expect(within(list).queryByText('Alpha.sid')).toBeNull();

    const clearButton = screen.getByRole('button', { name: /clear filter/i });
    fireEvent.click(clearButton);

    expect(within(list).getByTestId('row-header')).toBeInTheDocument();
    expect(within(list).getByText('Alpha.sid')).toBeInTheDocument();
  });

  it('clears the filter input when clear button is clicked', () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Alpha.sid',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];

    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
      />,
    );

    const filter = screen.getByTestId('list-filter-input');
    fireEvent.change(filter, { target: { value: 'Alpha' } });
    expect(filter).toHaveValue('Alpha');

    const clearButton = screen.getByRole('button', { name: /clear filter/i });
    fireEvent.click(clearButton);
    expect(filter).toHaveValue('');
  });

  it('renders filter header content under filter input', () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Alpha.sid',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];

    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        filterHeader={<div data-testid="filter-header">Types</div>}
      />,
    );

    expect(screen.getByTestId('filter-header')).toBeInTheDocument();
  });

  it('renders icon-only row actions without an Actions label', () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
        menuItems: [{ type: 'action', label: 'Details', onSelect: vi.fn() }],
      },
    ];

    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
      />,
    );

    expect(screen.queryByText('Actions')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play Track One' })).toBeInTheDocument();
  });

  it('renders header item with icon', () => {
    const items: ActionListItem[] = [
      {
        id: 'header-1',
        title: '/Music',
        variant: 'header',
        icon: <span data-testid="header-icon">🎵</span>,
        selected: false,
        actionLabel: 'Play',
      },
      {
        id: 'track-1',
        title: 'Alpha.sid',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        listTestId="list"
        rowTestId="row"
      />,
    );
    expect(screen.getByTestId('header-icon')).toBeInTheDocument();
  });

  it('applies isPlaying styling to the row', () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Now Playing',
        isPlaying: true,
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        listTestId="list"
        rowTestId="row"
      />,
    );
    const row = screen.getByTestId('row');
    expect(row.getAttribute('data-playing')).toBe('true');
    // The action button should have secondary variant styling
    const playBtn = screen.getByRole('button', { name: 'Play Now Playing' });
    expect(playBtn).toBeInTheDocument();
  });

  it('applies isDimmed styling to the row', () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Dimmed Track',
        isDimmed: true,
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        rowTestId="row"
      />,
    );
    const row = screen.getByTestId('row');
    expect(row.className).toContain('opacity-40');
  });

  it('calls onRowClick when row is clicked', () => {
    const onRowClick = vi.fn();
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
        onRowClick,
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        rowTestId="row"
      />,
    );
    fireEvent.click(screen.getByTestId('row'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onRowClick when isDimmed', () => {
    const onRowClick = vi.fn();
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        isDimmed: true,
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
        onRowClick,
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        rowTestId="row"
      />,
    );
    fireEvent.click(screen.getByTestId('row'));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('does not call onRowClick when disableActions is true', () => {
    const onRowClick = vi.fn();
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        disableActions: true,
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
        onRowClick,
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        rowTestId="row"
      />,
    );
    fireEvent.click(screen.getByTestId('row'));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('hides checkbox when showSelection is false', () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        showSelection: false,
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('hides menu button when showMenu is false', () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        showMenu: false,
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
        menuItems: [{ type: 'action', label: 'Delete', onSelect: vi.fn() }],
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Item actions' })).toBeNull();
  });

  it('renders menu with separator, label, and info entries', async () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
        menuItems: [
          { type: 'label', label: 'Options' },
          { type: 'separator' },
          { type: 'info', label: 'Duration', value: '3:45' },
          { type: 'action', label: 'Delete', onSelect: vi.fn() },
        ],
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        rowTestId="row"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Item actions' });
    expect(trigger).toBeInTheDocument();
    // Open the dropdown via pointer events (Radix UI uses pointerdown)
    await act(async () => {
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);
    });
    // Dropdown content renders in a portal; check body for items
    expect(document.body.textContent).toContain('Options');
    expect(document.body.textContent).toContain('Duration');
    expect(document.body.textContent).toContain('Delete');
  });

  it('renders item with icon, titleSuffix, subtitle, and meta', () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        icon: <span data-testid="row-icon">🎵</span>,
        titleSuffix: '(v2)',
        subtitle: 'Artist Name',
        subtitleTestId: 'item-subtitle',
        meta: 'Extra info',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
      />,
    );
    expect(screen.getByTestId('row-icon')).toBeInTheDocument();
    expect(screen.getByText('(v2)')).toBeInTheDocument();
    expect(screen.getByTestId('item-subtitle')).toHaveTextContent('Artist Name');
    expect(screen.getByText('Extra info')).toBeInTheDocument();
  });

  it('renders secondary action button and calls onSecondaryAction when clicked', () => {
    const onSecondaryAction = vi.fn();
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
        secondaryActionLabel: 'Remove',
        onSecondaryAction,
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
      />,
    );
    const removeBtn = screen.getByRole('button', { name: 'Remove Track One' });
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn);
    expect(onSecondaryAction).toHaveBeenCalledTimes(1);
  });

  it('hides selection controls when showSelectionControls is false', () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        selected: false,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        showSelectionControls={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /select all/i })).toBeNull();
    expect(screen.queryByText(/selected/i)).toBeNull();
  });

  it('shows remove-selected button when removeSelectedLabel and selectedCount > 0', () => {
    const onRemoveSelected = vi.fn();
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        selected: true,
        actionLabel: 'Play',
        onAction: vi.fn(),
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={1}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        removeSelectedLabel="Remove selected"
        onRemoveSelected={onRemoveSelected}
        listTestId="list"
      />,
    );
    const removeBtn = screen.getByTestId('list-remove-selected');
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn);
    expect(onRemoveSelected).toHaveBeenCalledTimes(1);
  });

  it('renders headerActions slot', () => {
    const items: ActionListItem[] = [
      { id: 'track-1', title: 'Track One', selected: false, actionLabel: 'Play', onAction: vi.fn() },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        headerActions={<button data-testid="header-action">Export</button>}
      />,
    );
    expect(screen.getByTestId('header-action')).toBeInTheDocument();
  });

  it('uses selectionLabel in no-selection text', () => {
    const items: ActionListItem[] = [
      { id: 'track-1', title: 'Track One', selected: false, actionLabel: 'Play', onAction: vi.fn() },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        selectionLabel="tracks"
      />,
    );
    expect(screen.getByText('No tracks selected')).toBeInTheDocument();
  });

  it('shows selected count when selectedCount > 0', () => {
    const items: ActionListItem[] = [
      { id: 'track-1', title: 'Track One', selected: true, actionLabel: 'Play', onAction: vi.fn() },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={3}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
      />,
    );
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('renders custom actionIcon on action button', () => {
    const items: ActionListItem[] = [
      {
        id: 'track-1',
        title: 'Track One',
        selected: false,
        actionLabel: 'Download',
        actionIcon: <span data-testid="custom-action-icon">⬇</span>,
        onAction: vi.fn(),
      },
    ];
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
      />,
    );
    expect(screen.getByTestId('custom-action-icon')).toBeInTheDocument();
  });

  it('filters items in view-all dialog and clears filter', () => {
    const items: ActionListItem[] = Array.from({ length: 15 }, (_, i) => ({
      id: `track-${i}`,
      title: i < 5 ? `Alpha ${i}` : `Bravo ${i}`,
      selected: false,
      actionLabel: 'Play',
      onAction: vi.fn(),
    }));
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={5}
        viewAllTitle="All Tracks"
        rowTestId="row"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /view all/i }));
    const viewAllFilter = screen.getByTestId('view-all-filter-input');
    fireEvent.change(viewAllFilter, { target: { value: 'Alpha' } });
    expect(screen.getAllByText(/Alpha \d/).length).toBeGreaterThan(0);
    const clearBtn = screen.getByRole('button', { name: /clear filter/i });
    fireEvent.click(clearBtn);
    expect(viewAllFilter).toHaveValue('');
  });

  it('renders filterHeader in view-all dialog', () => {
    const items: ActionListItem[] = Array.from({ length: 15 }, (_, i) => ({
      id: `track-${i}`,
      title: `Track ${i}`,
      selected: false,
      actionLabel: 'Play',
      onAction: vi.fn(),
    }));
    render(
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={5}
        viewAllTitle="All Tracks"
        filterHeader={<div data-testid="dialog-filter-header">Filter Types</div>}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /view all/i }));
    const headers = screen.getAllByTestId('dialog-filter-header');
    expect(headers.length).toBeGreaterThan(0);
  });
});
