import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ConfigBrowserPage from '@/pages/ConfigBrowserPage';
import { reportUserError } from '@/lib/uiErrors';
import { getC64API } from '@/lib/c64api';

vi.mock('@/components/ThemeProvider', () => ({
  useThemeContext: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => ({
    status: { isConnected: true },
  }),
  useC64Categories: () => ({
    data: { categories: ['Audio Mixer'] },
    isLoading: false,
  }),
  useC64Category: () => ({
    data: {
      'Audio Mixer': {
        items: {
          'Vol Ultisid 1': { selected: '0 dB', options: ['-6 dB', '0 dB'] },
        },
      },
    },
    isLoading: false,
    refetch: vi.fn(),
  }),
  useC64SetConfig: () => ({ mutateAsync: vi.fn() }),
  useC64UpdateConfigBatch: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/hooks/useAppConfigState', () => ({
  useAppConfigState: () => ({
    isApplying: false,
    markChanged: vi.fn(),
  }),
}));

vi.mock('@/hooks/useRefreshControl', () => ({
  useRefreshControl: () => ({ setConfigExpanded: vi.fn() }),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/components/ConfigItemRow', () => ({
  ConfigItemRow: ({ name, rightAccessory }: { name: string; rightAccessory?: ReactNode }) => (
    <div>
      <span>{name}</span>
      {rightAccessory}
    </div>
  ),
}));

vi.mock('@/lib/uiErrors', () => ({
  reportUserError: vi.fn(),
}));

vi.mock('@/lib/c64api', () => ({
  getC64API: vi.fn(),
}));

describe('ConfigBrowserPage', () => {
  it('reports solo routing errors for audio mixer', async () => {
    vi.mocked(getC64API).mockReturnValue({
      updateConfigBatch: vi.fn().mockRejectedValue(new Error('Update failed')),
    });

    render(<ConfigBrowserPage />);

    fireEvent.click(screen.getByRole('button', { name: /audio mixer/i }));

    const soloSwitch = await screen.findByTestId('audio-mixer-solo-vol-ultisid-1');
    fireEvent.click(soloSwitch);

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'AUDIO_ROUTING',
      }));
    });
  });
});
