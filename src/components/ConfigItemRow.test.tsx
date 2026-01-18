import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { ConfigItemRow } from './ConfigItemRow';
import { createMockC64Server, type MockC64Server } from '@/test/mockC64Server';
import { createOpenApiGeneratedClient } from '@/test/openapiGeneratedClient';
import { getC64API, updateC64APIConfig } from '@/lib/c64api';

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ConfigItemRow control selection + REST updates', () => {
  let server: MockC64Server;

  beforeAll(async () => {
    server = await createMockC64Server({
      'Test Category': {
        'Network Password': 'secret',
        Drive: 'Enabled',
        'Video Mode': 'PAL',
        Hostname: 'c64u',
      },
    });
    updateC64APIConfig(server.baseUrl);
  });

  afterAll(async () => {
    await server.close();
  });

  it('renders a password input when name contains "password" and updates via REST on change', async () => {
    vi.useFakeTimers();

    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Network Password"
        value="secret"
        options={['Enabled', 'Disabled']}
        details={{ presets: [] }}
        onValueChange={(v) => void getC64API().setConfigValue('Test Category', 'Network Password', v)}
      />,
    );

    const input = screen.getByLabelText('Network Password password input') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'password');
    expect(input.value).toBe('secret');

    fireEvent.change(input, { target: { value: 'newpass' } });
    await vi.advanceTimersByTimeAsync(350);

    await waitFor(() => {
      expect(server.requests.some((r) => r.method === 'PUT' && r.url.includes('/v1/configs/'))).toBe(true);
    });

    const client = await createOpenApiGeneratedClient(server.baseUrl);
    const resp = await client.request({
      method: 'GET',
      url: `/v1/configs/${encodeURIComponent('Test Category')}`,
    });
    expect(resp.status).toBe(200);
    expect(resp.data['Test Category']['Network Password']).toBe('newpass');

    vi.useRealTimers();
  });

  it('renders a checkbox for Enabled/Disabled and updates via REST immediately', async () => {
    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Drive"
        value="Enabled"
        options={['Enabled', 'Disabled']}
        details={{ presets: [] }}
        onValueChange={(v) => void getC64API().setConfigValue('Test Category', 'Drive', v)}
      />,
    );

    const checkbox = screen.getByLabelText('Drive checkbox');
    expect(checkbox).toHaveAttribute('role', 'checkbox');

    fireEvent.click(checkbox);

    await waitFor(async () => {
      const client = await createOpenApiGeneratedClient(server.baseUrl);
      const resp = await client.request({
        method: 'GET',
        url: `/v1/configs/${encodeURIComponent('Test Category')}`,
      });
      expect(resp.data['Test Category'].Drive).toBe('Disabled');
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
        onValueChange={(v) => void getC64API().setConfigValue('Test Category', 'Video Mode', v)}
      />,
    );

    const trigger = screen.getByLabelText('Video Mode select');
    fireEvent.mouseDown(trigger);
    const option = await screen.findByText('NTSC');
    fireEvent.click(option);

    await waitFor(async () => {
      const client = await createOpenApiGeneratedClient(server.baseUrl);
      const resp = await client.request({
        method: 'GET',
        url: `/v1/configs/${encodeURIComponent('Test Category')}`,
      });
      expect(resp.data['Test Category']['Video Mode']).toBe('NTSC');
    });
  });

  it('renders a text input for remaining cases and updates via REST on edit', async () => {
    vi.useFakeTimers();

    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Hostname"
        value="c64u"
        options={[]}
        details={{ presets: [] }}
        onValueChange={(v) => void getC64API().setConfigValue('Test Category', 'Hostname', v)}
      />,
    );

    const input = screen.getByLabelText('Hostname text input') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'text');
    expect(input.value).toBe('c64u');

    fireEvent.change(input, { target: { value: 'u64' } });
    await vi.advanceTimersByTimeAsync(350);

    await waitFor(async () => {
      const client = await createOpenApiGeneratedClient(server.baseUrl);
      const resp = await client.request({
        method: 'GET',
        url: `/v1/configs/${encodeURIComponent('Test Category')}`,
      });
      expect(resp.data['Test Category'].Hostname).toBe('u64');
    });

    vi.useRealTimers();
  });
});

