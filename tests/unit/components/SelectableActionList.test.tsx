import { fireEvent, render, screen } from '@testing-library/react';
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
});
