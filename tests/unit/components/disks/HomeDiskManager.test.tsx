import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { HomeDiskManager } from '@/components/disks/HomeDiskManager';
import { createDiskEntry } from '@/lib/disks/diskTypes';

vi.mock('@/components/lists/SelectableActionList', () => ({
  SelectableActionList: ({ items }: any) => (
    <div data-testid="mock-list">
      {items.map((item: any) => (
        <div key={item.id} data-testid={`item-${item.id}`}>
          {(item.menuItems || [])
            .filter((entry: any) => entry.type === 'info')
            .map((entry: any) => (
              <div key={entry.label}>{`${entry.label}:${entry.value}`}</div>
            ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/itemSelection/ItemSelectionDialog', () => ({
  ItemSelectionDialog: () => null,
}));

vi.mock('@/components/itemSelection/AddItemsProgressOverlay', () => ({
  AddItemsProgressOverlay: () => null,
}));

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => ({
    status: {
      state: 'REAL_CONNECTED',
      isConnected: true,
      isConnecting: false,
      error: null,
      deviceInfo: { unique_id: 'device-1' },
    },
  }),
  useC64Drives: () => ({ data: { drives: [] } }),
}));

vi.mock('@/hooks/useDiskLibrary', () => ({
  useDiskLibrary: () => ({
    disks: [
      createDiskEntry({
        path: '/bad-date.d64',
        location: 'local',
        sizeBytes: null,
        modifiedAt: 'not-a-date',
      }),
    ],
    runtimeFiles: {},
    addDisks: vi.fn(),
    removeDisk: vi.fn(),
    updateDiskGroup: vi.fn(),
    updateDiskName: vi.fn(),
  }),
}));

vi.mock('@/hooks/useLocalSources', () => ({
  useLocalSources: () => ({
    sources: [],
    addSourceFromPicker: vi.fn(),
    addSourceFromFiles: vi.fn(),
  }),
}));

vi.mock('@/hooks/useListPreviewLimit', () => ({
  useListPreviewLimit: () => ({ limit: 20 }),
}));

vi.mock('@/hooks/useActionTrace', () => ({
  useActionTrace: () => Object.assign(<T extends (...args: any[]) => any>(fn: T) => fn, { scope: async () => undefined }),
}));

vi.mock('@/lib/c64api', () => ({
  getC64API: () => ({
    getDrives: vi.fn(),
  }),
}));

vi.mock('@/lib/sourceNavigation/ftpSourceAdapter', () => ({
  createUltimateSourceLocation: () => ({
    id: 'ultimate',
    type: 'ultimate',
    name: 'C64 Ultimate',
    rootPath: '/',
    isAvailable: true,
    listEntries: vi.fn(async () => []),
    listFilesRecursive: vi.fn(async () => []),
  }),
}));

vi.mock('@/lib/sourceNavigation/localSourceAdapter', () => ({
  createLocalSourceLocation: () => ({
    id: 'local',
    type: 'local',
    name: 'Local',
    rootPath: '/',
    isAvailable: true,
    listEntries: vi.fn(async () => []),
    listFilesRecursive: vi.fn(async () => []),
  }),
  resolveLocalRuntimeFile: vi.fn(() => null),
}));

vi.mock('@/lib/native/platform', () => ({
  getPlatform: () => 'web',
  isNativePlatform: () => false,
}));

vi.mock('@/lib/native/safUtils', () => ({
  redactTreeUri: (value: string) => value,
}));

vi.mock('@/lib/disks/diskMount', () => ({
  mountDiskToDrive: vi.fn(),
}));

vi.mock('@/lib/sourceNavigation/localSourcesStore', () => ({
  getLocalSourceListingMode: () => 'list',
  requireLocalSourceEntries: vi.fn(() => []),
  prepareDirectoryInput: vi.fn(),
}));

describe('HomeDiskManager', () => {
  it('shows formatted size and date in menu info', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <HomeDiskManager />
      </QueryClientProvider>,
    );

    const item = screen.getByTestId('item-local:/bad-date.d64');
    expect(item).toHaveTextContent('Size:—');
    expect(item).toHaveTextContent('Date:—');
  });
});
