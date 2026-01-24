import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';

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
});
