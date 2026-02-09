/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { ConfigItemRow } from '@/components/ConfigItemRow';
import { createMockC64Server, type MockC64Server } from '../../mocks/mockC64Server';
import { createOpenApiGeneratedClient } from '../../helpers/openapiGeneratedClient';
import { updateC64APIConfig } from '@/lib/c64api';

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ConfigItemRow control selection + REST updates', () => {
  let server: MockC64Server;
  let openapiClient: any;

  beforeAll(async () => {
    server = await createMockC64Server(
      {
        'Test Category': {
          'Network Password': 'secret',
          Drive: 'Enabled',
          'Video Mode': 'PAL',
          Power: 'On',
          Hostname: 'c64u',
        },
      },
      {
        'Test Category': {
          Drive: { options: ['Enabled', 'Disabled'] },
          'Video Mode': { options: ['PAL', 'NTSC'] },
          'Network Password': { options: ['Enabled', 'Disabled'] },
          Power: { options: ['On', 'Off'] },
        },
      },
    );
    updateC64APIConfig(server.baseUrl);
    openapiClient = await createOpenApiGeneratedClient(server.baseUrl);
  });

  afterAll(async () => {
    await server.close();
  });

  const putValue = async (category: string, item: string, value: string | number) => {
    await openapiClient.request({
      method: 'PUT',
      url: `/v1/configs/${encodeURIComponent(category)}/${encodeURIComponent(item)}`,
      params: { value: String(value) },
    });
  };

  it('renders a password input when name contains "password" and updates via REST on change', async () => {
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Network Password"
        value="secret"
        options={['Enabled', 'Disabled']}
        details={{ presets: [] }}
        onValueChange={(v) => void putValue('Test Category', 'Network Password', v)}
      />,
    );

    const input = screen.getByLabelText('Network Password password input') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'password');
    expect(input.value).toBe('secret');

    fireEvent.change(input, { target: { value: 'newpass' } });
    fireEvent.blur(input);

    await waitFor(async () => {
      const resp = await openapiClient.request({
        method: 'GET',
        url: `/v1/configs/${encodeURIComponent('Test Category')}`,
      });
      expect(resp.status).toBe(200);
      expect(resp.data['Test Category'].items['Network Password'].selected).toBe('newpass');
    });
  });

  it('renders a checkbox for Enabled/Disabled and updates via REST immediately', async () => {
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Drive"
        value="Enabled"
        options={['Enabled', 'Disabled']}
        details={{ presets: [] }}
        onValueChange={(v) => void putValue('Test Category', 'Drive', v)}
      />,
    );

    const checkbox = screen.getByLabelText('Drive checkbox');
    expect(checkbox).toHaveAttribute('role', 'checkbox');

    fireEvent.pointerDown(checkbox);
    fireEvent.click(checkbox);

    await waitFor(async () => {
      const resp = await openapiClient.request({
        method: 'GET',
        url: `/v1/configs/${encodeURIComponent('Test Category')}`,
      });
      expect(resp.data['Test Category'].items.Drive.selected).toBe('Disabled');
    });
  });

  it('renders a checkbox for On/Off and maps checked=On, unchecked=Off', async () => {
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Power"
        value="On"
        options={['On', 'Off']}
        onValueChange={(v) => void putValue('Test Category', 'Power', v)}
      />,
    );

    const checkbox = screen.getByLabelText('Power checkbox');
    expect(checkbox).toHaveAttribute('role', 'checkbox');

    // Toggle to Off
    fireEvent.click(checkbox);

    await waitFor(async () => {
      const resp = await openapiClient.request({
        method: 'GET',
        url: `/v1/configs/${encodeURIComponent('Test Category')}`,
      });
      expect(resp.data['Test Category'].items.Power.selected).toBe('Off');
    });

    // Toggle back to On (keep shared test state stable)
    fireEvent.click(checkbox);

    await waitFor(async () => {
      const resp = await openapiClient.request({
        method: 'GET',
        url: `/v1/configs/${encodeURIComponent('Test Category')}`,
      });
      expect(resp.data['Test Category'].items.Power.selected).toBe('On');
    });
  });

  it('renders a select for 2+ possible values and updates via REST immediately when selecting', async () => {
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Video Mode"
        value="PAL"
        options={['PAL', 'NTSC']}
        details={{ presets: [] }}
        onValueChange={(v) => void putValue('Test Category', 'Video Mode', v)}
      />,
    );

    const trigger = screen.getByLabelText('Video Mode select');
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);

    const option = await screen.findByRole('option', { name: 'NTSC' });
    fireEvent.click(option);

    await waitFor(async () => {
      const resp = await openapiClient.request({
        method: 'GET',
        url: `/v1/configs/${encodeURIComponent('Test Category')}`,
      });
      expect(resp.data['Test Category'].items['Video Mode'].selected).toBe('NTSC');
    });
  });

  it('renders a text input for remaining cases and updates via REST on edit', async () => {
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Hostname"
        value="c64u"
        options={[]}
        details={{ presets: [] }}
        onValueChange={(v) => void putValue('Test Category', 'Hostname', v)}
      />,
    );

    const input = screen.getByLabelText('Hostname text input') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'text');
    expect(input.value).toBe('c64u');

    fireEvent.change(input, { target: { value: 'u64' } });
    fireEvent.blur(input);

    await waitFor(async () => {
      const resp = await openapiClient.request({
        method: 'GET',
        url: `/v1/configs/${encodeURIComponent('Test Category')}`,
      });
      expect(resp.data['Test Category'].items.Hostname.selected).toBe('u64');
    });
  });

  it('fetches item details (options) when missing and upgrades rendering to checkbox/select', async () => {
    // No options passed: should fetch `/v1/configs/{category}/{item}` and render checkbox.
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Drive"
        value="Enabled"
        onValueChange={(v) => void putValue('Test Category', 'Drive', v)}
      />,
    );

    const checkbox = await screen.findByLabelText('Drive checkbox');
    expect(checkbox).toHaveAttribute('role', 'checkbox');

    // No options passed: should fetch `/v1/configs/{category}/{item}` and render select.
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Video Mode"
        value="PAL"
        onValueChange={(v) => void putValue('Test Category', 'Video Mode', v)}
      />,
    );

    const trigger = await screen.findByLabelText('Video Mode select');
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    const option = await screen.findByRole('option', { name: 'NTSC' });
    fireEvent.click(option);

    await waitFor(async () => {
      const resp = await openapiClient.request({
        method: 'GET',
        url: `/v1/configs/${encodeURIComponent('Test Category')}`,
      });
      expect(resp.data['Test Category'].items['Video Mode'].selected).toBe('NTSC');
    });
  });
});

describe('ConfigItemRow slider and input behaviors', () => {
  it('renders a slider for audio mixer volumes', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        category="Audio Mixer"
        name="Vol UltiSid 1"
        value="0 dB"
        options={['-6 dB', '0 dB', '+6 dB']}
        onValueChange={onValueChange}
        valueTestId="volume-value"
        sliderTestId="volume-slider"
      />,
    );

    expect(screen.getByLabelText('Vol UltiSid 1 slider')).toBeTruthy();
    expect(screen.getByTestId('volume-value')).toHaveTextContent('0 dB');
  });

  it('orders off/low/medium/high slider options', () => {
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Fan Speed"
        value="Low"
        options={['Off', 'Low', 'Medium', 'High']}
        onValueChange={() => { }}
      />,
    );

    expect(screen.getByLabelText('Fan Speed slider')).toBeTruthy();
    expect(screen.getByText('Low')).toBeTruthy();
  });

  it('maps numeric values when option formatting differs', () => {
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Gain"
        value="0"
        options={['0 dB', '+6 dB']}
        onValueChange={() => { }}
      />,
    );

    expect(screen.getByLabelText('Gain slider')).toBeTruthy();
    expect(screen.getByText('0 dB')).toBeTruthy();
  });

  it('supports left/center/right slider ordering', () => {
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Pan"
        value="Center"
        options={['Left 40', 'Right 20', 'Center']}
        onValueChange={() => { }}
      />,
    );

    expect(screen.getByLabelText('Pan slider')).toBeTruthy();
    expect(screen.getByText('Center')).toBeTruthy();
  });

  it('commits text input on enter without waiting for debounce', () => {
    vi.useFakeTimers();
    try {
      const onValueChange = vi.fn();
      renderWithQuery(
        <ConfigItemRow
          category="Test Category"
          name="Hostname"
          value="c64u"
          options={[]}
          details={{ presets: [] }}
          onValueChange={onValueChange}
        />,
      );

      const input = screen.getByLabelText('Hostname text input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'u64' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onValueChange).toHaveBeenCalledWith('u64');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores edits for read-only rows', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="SID Detected Socket 1"
        value="Socket A"
        options={[]}
        details={{ presets: [] }}
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByLabelText('SID Detected Socket 1 text input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Socket B' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('ConfigItemRow adaptive layout', () => {
  const setLayoutMetrics = (
    layoutEl: HTMLElement,
    labelEl: HTMLElement,
    metrics: { containerWidth: number; labelWidth: number; labelHeight: number },
  ) => {
    Object.defineProperty(layoutEl, 'clientWidth', {
      value: metrics.containerWidth,
      configurable: true,
    });
    Object.defineProperty(labelEl, 'scrollWidth', {
      value: metrics.labelWidth,
      configurable: true,
    });
    labelEl.getBoundingClientRect = () => ({
      width: metrics.labelWidth,
      height: metrics.labelHeight,
      top: 0,
      left: 0,
      bottom: metrics.labelHeight,
      right: metrics.labelWidth,
      x: 0,
      y: 0,
      toJSON: () => { },
    } as DOMRect);
  };

  it('uses horizontal layout when label and widget fit', async () => {
    renderWithQuery(
      <ConfigItemRow
        category="Audio Mixer"
        name="VolUltiSid1+6dB"
        value="0 dB"
        options={['-6 dB', '0 dB', '+6 dB']}
        onValueChange={() => { }}
      />,
    );

    const layout = screen.getByTestId('config-item-layout');
    const label = screen.getByTestId('config-item-label');
    setLayoutMetrics(layout, label, { containerWidth: 640, labelWidth: 140, labelHeight: 16 });
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      expect(layout).toHaveAttribute('data-layout', 'horizontal');
    });
    expect(label.className).toContain('whitespace-nowrap');
  });

  it('switches to vertical layout when label would overflow horizontally', async () => {
    renderWithQuery(
      <ConfigItemRow
        category="Audio Mixer"
        name="VolUltiSid1+6dB"
        value="0 dB"
        options={['-6 dB', '0 dB', '+6 dB']}
        onValueChange={() => { }}
      />,
    );

    const layout = screen.getByTestId('config-item-layout');
    const label = screen.getByTestId('config-item-label');
    setLayoutMetrics(layout, label, { containerWidth: 240, labelWidth: 140, labelHeight: 16 });
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      expect(layout).toHaveAttribute('data-layout', 'vertical');
    });
    expect(label.className).toContain('break-words');
  });

  it('forces vertical layout when label appears vertically stacked', async () => {
    renderWithQuery(
      <ConfigItemRow
        category="Drive A Settings"
        name="DriveType123456"
        value="1541"
        options={['1541', '1571', '1581']}
        onValueChange={() => { }}
      />,
    );

    const layout = screen.getByTestId('config-item-layout');
    const label = screen.getByTestId('config-item-label');
    setLayoutMetrics(layout, label, { containerWidth: 640, labelWidth: 12, labelHeight: 64 });
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      expect(layout).toHaveAttribute('data-layout', 'vertical');
    });
  });
});
