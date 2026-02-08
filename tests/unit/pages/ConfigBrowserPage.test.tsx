import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfigBrowserPage from '@/pages/ConfigBrowserPage';
import { reportUserError } from '@/lib/uiErrors';
import { getC64API } from '@/lib/c64api';
import { resolveAudioMixerResetValue } from '@/lib/config/audioMixer';
import { toast } from '@/hooks/use-toast';

const mockUseC64Connection = vi.fn();
const mockUseC64Categories = vi.fn();
const mockUseC64Category = vi.fn();
const mockUseC64SetConfig = vi.fn();
const mockUseC64UpdateConfigBatch = vi.fn();
const mockSetConfigExpanded = vi.fn();
const mockMarkChanged = vi.fn();

vi.mock('@/components/ThemeProvider', () => ({
  useThemeContext: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

vi.mock('@/components/DiagnosticsActivityIndicator', () => ({
  DiagnosticsActivityIndicator: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick} data-testid="diagnostics-activity-indicator" />
  ),
}));

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => mockUseC64Connection(),
  useC64Categories: () => mockUseC64Categories(),
  useC64Category: (...args: [string, boolean]) => mockUseC64Category(...args),
  useC64SetConfig: () => mockUseC64SetConfig(),
  useC64UpdateConfigBatch: () => mockUseC64UpdateConfigBatch(),
}));

vi.mock('@/hooks/useAppConfigState', () => ({
  useAppConfigState: () => ({
    isApplying: false,
    markChanged: mockMarkChanged,
  }),
}));

vi.mock('@/hooks/useRefreshControl', () => ({
  useRefreshControl: () => ({ setConfigExpanded: mockSetConfigExpanded }),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toasts: [], dismiss: vi.fn() }),
}));

vi.mock('@/components/ConfigItemRow', () => ({
  ConfigItemRow: ({ name, rightAccessory, onValueChange }: { name: string; rightAccessory?: ReactNode; onValueChange?: (value: string) => void }) => (
    <div>
      <span>{name}</span>
      <button type="button" onClick={() => onValueChange?.('updated')}>Update {name}</button>
      {rightAccessory}
    </div>
  ),
}));

vi.mock('@/lib/uiErrors', () => ({
  reportUserError: vi.fn(),
}));

const buildRouter = (ui: JSX.Element) => createMemoryRouter(
  [{ path: '*', element: ui }],
  {
    initialEntries: ['/'],
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  },
);

const renderConfigBrowserPage = () => render(
  <RouterProvider
    router={buildRouter(<ConfigBrowserPage />)}
    future={{
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    }}
  />,
);

vi.mock('@/lib/c64api', () => ({
  getC64API: vi.fn(),
}));

vi.mock('@/lib/config/audioMixer', () => ({
  resolveAudioMixerResetValue: vi.fn(),
  isAudioMixerValueEqual: (left: string | number, right: string | number) => left === right,
}));

const setupDefaultMocks = () => {
  mockUseC64Connection.mockReturnValue({ status: { isConnected: true } });
  mockUseC64Categories.mockReturnValue({ data: { categories: [] }, isLoading: false });
  mockUseC64Category.mockReturnValue({ data: {}, isLoading: false, refetch: vi.fn() });
  mockUseC64SetConfig.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mockUseC64UpdateConfigBatch.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mockSetConfigExpanded.mockReset();
  mockMarkChanged.mockReset();
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('ConfigBrowserPage', () => {
  it('renders connection warning when offline', () => {
    setupDefaultMocks();
    mockUseC64Connection.mockReturnValue({ status: { isConnected: false } });

    renderConfigBrowserPage();

    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
  });

  it('filters categories by search query', () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ['Audio Mixer', 'Clock Settings'] },
      isLoading: false,
    });

    renderConfigBrowserPage();

    fireEvent.change(screen.getByPlaceholderText(/search categories/i), { target: { value: 'clock' } });

    expect(screen.getByRole('button', { name: /clock settings/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /audio mixer/i })).not.toBeInTheDocument();
  });

  it('shows empty search results message', () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ['Audio Mixer'] },
      isLoading: false,
    });

    renderConfigBrowserPage();

    fireEvent.change(screen.getByPlaceholderText(/search categories/i), { target: { value: 'missing' } });

    expect(screen.getByText(/no categories match your search/i)).toBeInTheDocument();
  });

  it('shows empty state when no categories exist', () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: [] },
      isLoading: false,
    });

    renderConfigBrowserPage();

    expect(screen.getByText(/no categories available/i)).toBeInTheDocument();
  });

  it('reports solo routing errors for audio mixer', async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ['Audio Mixer'] },
      isLoading: false,
    });

    vi.mocked(getC64API).mockReturnValue({
      updateConfigBatch: vi.fn().mockRejectedValue(new Error('Update failed')),
    });

    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            'Vol Ultisid 1': { selected: '0 dB', options: ['-6 dB', '0 dB'] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole('button', { name: /audio mixer/i }));

    const soloSwitch = await screen.findByTestId('audio-mixer-solo-vol-ultisid-1');
    fireEvent.click(soloSwitch);

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'AUDIO_ROUTING',
      }));
    });
  });

  it('reports audio mixer update failures when solo is active', async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ['Audio Mixer'] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockRejectedValue(new Error('Update failed'));
    mockUseC64UpdateConfigBatch.mockReturnValue({ mutateAsync, isPending: false });

    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            'Vol Ultisid 1': { selected: '0 dB', options: ['-6 dB', '0 dB'] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole('button', { name: /audio mixer/i }));

    const soloSwitch = await screen.findByTestId('audio-mixer-solo-vol-ultisid-1');
    fireEvent.click(soloSwitch);
    fireEvent.click(await screen.findByRole('button', { name: /update vol ultisid 1/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'AUDIO_MIXER_UPDATE',
      }));
    });
  });

  it('reports config update failures', async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ['General'] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockRejectedValue(new Error('Update failed'));
    mockUseC64SetConfig.mockReturnValue({ mutateAsync, isPending: false });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            'Demo Option': { selected: 'Off', options: ['Off', 'On'] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole('button', { name: /general/i }));
    fireEvent.click(await screen.findByRole('button', { name: /update demo option/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'CONFIG_UPDATE',
      }));
    });
  });

  it('syncs clock settings when fields are present', async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ['Clock Settings'] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseC64UpdateConfigBatch.mockReturnValue({ mutateAsync, isPending: false });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            Year: { selected: 2024 },
            Month: { selected: 1 },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole('button', { name: /clock settings/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sync clock/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalled();
      expect(mockMarkChanged).toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Clock synced' }));
    });
  });

  it('reports clock sync when no matching fields exist', async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ['Clock Settings'] },
      isLoading: false,
    });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            Timezone: { selected: 'UTC' },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole('button', { name: /clock settings/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sync clock/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'CLOCK_SYNC',
      }));
    });
  });

  it('resets audio mixer to defaults', async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ['Audio Mixer'] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseC64UpdateConfigBatch.mockReturnValue({ mutateAsync, isPending: false });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            'Vol Ultisid 1': { selected: '-6 dB', options: ['-6 dB', '0 dB'] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));
    vi.mocked(resolveAudioMixerResetValue).mockResolvedValue('0 dB');

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole('button', { name: /audio mixer/i }));
    fireEvent.click(await screen.findByRole('button', { name: /reset/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ category: 'Audio Mixer' }));
      expect(refetch).toHaveBeenCalled();
      expect(mockMarkChanged).toHaveBeenCalled();
    });
  });

  it('refreshes category data', async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ['Audio Mixer'] },
      isLoading: false,
    });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            'Vol Ultisid 1': { selected: '0 dB', options: ['-6 dB', '0 dB'] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole('button', { name: /audio mixer/i }));
    fireEvent.click(await screen.findByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });
});
