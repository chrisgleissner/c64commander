import { fireEvent, render, screen, within } from '@testing-library/react';
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
});
