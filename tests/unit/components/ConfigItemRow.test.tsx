import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
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
