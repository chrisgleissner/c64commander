import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineArchiveDialog } from '@/components/archive/OnlineArchiveDialog';
import { reportUserError } from '@/lib/uiErrors';

vi.mock('@/hooks/useOnlineArchive', () => ({
  useOnlineArchive: vi.fn(),
}));

vi.mock('@/lib/uiErrors', () => ({
  reportUserError: vi.fn(),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <select disabled={disabled} value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
}));

const { useOnlineArchive } = await import('@/hooks/useOnlineArchive');

const baseReturn = {
  clientType: 'CommoserveClient',
  presets: [
    { type: 'category', description: 'Category', values: [{ aqlKey: 'apps', name: 'Apps' }] },
    { type: 'sort', description: 'Sort', values: [{ aqlKey: 'name', name: 'Name' }] },
    { type: 'order', description: 'Order', values: [{ aqlKey: 'asc', name: 'Ascending' }] },
  ],
  presetsLoading: false,
  resolvedConfig: {
    backend: 'commodore',
    host: 'commoserve.files.commodore.net',
    clientId: 'Commodore',
    userAgent: 'Assembly Query',
    baseUrl: 'http://commoserve.files.commodore.net',
  },
  cancel: vi.fn(),
  clearError: vi.fn(),
  search: vi.fn(),
  openEntries: vi.fn(),
  execute: vi.fn(),
};

describe('OnlineArchiveDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders search results and submits a query from form input', async () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: 'results',
        params: { name: 'joyride', category: 'apps' },
        results: [{ id: '100', category: 40, name: 'Joyride', group: 'Protovision', year: 2024, updated: '2024-03-14' }],
      },
    } as never);

    render(
      <OnlineArchiveDialog
        open
        onOpenChange={() => undefined}
        config={{ backend: 'commodore', hostOverride: '', clientIdOverride: '', userAgentOverride: '' }}
      />,
    );

    expect(screen.queryByText(/Overrides are active/i)).toBeNull();
    expect(screen.getByText('Joyride')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'demo' } });
    fireEvent.click(screen.getByRole('button', { name: /search archive/i }));

    await waitFor(() => {
      expect(baseReturn.search).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'demo', group: '', handle: '', event: '' }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /Joyride Protovision/i }));
    expect(baseReturn.openEntries).toHaveBeenCalled();
  });

  it('renders entry execution states and reports archive errors', async () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      resolvedConfig: {
        backend: 'commodore',
        host: '127.0.0.1:3001',
        clientId: 'Custom',
        userAgent: 'Custom UA',
        baseUrl: 'http://127.0.0.1:3001',
      },
      state: {
        phase: 'executing',
        params: { name: 'joyride', category: 'apps' },
        result: { id: '100', category: 40, name: 'Joyride' },
        results: [{ id: '100', category: 40, name: 'Joyride' }],
        entry: { id: 0, path: 'joyride.prg', size: 3, date: 1710374400000 },
        entries: [{ id: 0, path: 'joyride.prg', size: 3, date: 1710374400000 }],
      },
    } as never);

    render(
      <OnlineArchiveDialog
        open
        onOpenChange={() => undefined}
        config={{ backend: 'commodore', hostOverride: '127.0.0.1:3001', clientIdOverride: 'Custom', userAgentOverride: 'Custom UA' }}
      />,
    );

    expect(screen.getByText(/Overrides are active/i)).toBeInTheDocument();
    expect(screen.getByText('joyride.prg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Executing…/i })).toBeDisabled();
  });

  it('reports archive errors from the hook', async () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: 'error',
        message: 'Archive failed',
        recoverableState: null,
      },
    } as never);

    render(
      <OnlineArchiveDialog
        open
        onOpenChange={() => undefined}
        config={{ backend: 'commodore', hostOverride: '', clientIdOverride: '', userAgentOverride: '' }}
      />,
    );

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'ONLINE_ARCHIVE', description: 'Archive failed' }),
      );
    });
  });
});
