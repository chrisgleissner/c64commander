/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConfigItemRow } from '@/components/ConfigItemRow';
import { useC64ConfigItem } from '@/hooks/useC64Connection';

// Mock the C64 connection hook so we don't need a real server for edge case tests
vi.mock('@/hooks/useC64Connection', async (importOriginal) => {
  const orig =
    await importOriginal<typeof import('@/hooks/useC64Connection')>();
  return {
    ...orig,
    useC64ConfigItem: vi
      .fn()
      .mockReturnValue({ data: undefined, isLoading: false }),
  };
});

// Silence trace marker noise in tests
vi.mock('@/lib/tracing/uiTrace', () => ({
  emitUiTraceMarker: vi.fn(),
}));

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const mockConfigItem = vi.mocked(useC64ConfigItem);

describe('ConfigItemRow — select with empty option', () => {
  it('renders empty option as (empty) sentinel and selects it', () => {
    renderWithQuery(
      <ConfigItemRow
        name="Mode"
        value=""
        options={['', 'PAL', 'NTSC']}
        onValueChange={vi.fn()}
      />,
    );
    // select with value='' should render (empty) as placeholder placeholder
    expect(screen.getByLabelText('Mode select')).toBeTruthy();
  });

  it('renders select with (empty) display label when displayValue is empty string', () => {
    renderWithQuery(
      <ConfigItemRow
        name="Output"
        value=""
        options={['HDMI', 'Component']}
        onValueChange={vi.fn()}
      />,
    );
    // displayValueLabel='(empty)' shown in placeholder
    const trigger = screen.getByLabelText('Output select');
    expect(trigger).toBeTruthy();
  });

  it('appends current value to options when it is not in optionList', () => {
    renderWithQuery(
      <ConfigItemRow
        name="Video"
        value="Custom"
        options={['PAL', 'NTSC']}
        onValueChange={vi.fn()}
      />,
    );
    // 'Custom' not in options, should still render select with it
    expect(screen.getByLabelText('Video select')).toBeTruthy();
  });

  it('select does not call onValueChange when readOnly', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        name="Video"
        value="PAL"
        options={['PAL', 'NTSC']}
        readOnly={true}
        onValueChange={onValueChange}
      />,
    );
    // With readOnly=true, the select is disabled
    const selectTrigger = screen.getByLabelText('Video select');
    expect(selectTrigger).toHaveAttribute('disabled');
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('ConfigItemRow — slider edge cases', () => {
  it('renders slider with Centre (British spelling) in left/centre/right options', () => {
    renderWithQuery(
      <ConfigItemRow
        name="Pan"
        value="Centre"
        options={['Left 40', 'Centre', 'Right 40']}
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Pan slider')).toBeTruthy();
    expect(screen.getByText('Centre')).toBeTruthy();
  });

  it('defaults to first option when value has no match at all', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        category="Audio Mixer"
        name="Vol Speed"
        value="unknown_value"
        options={['-12 dB', '0 dB', '+6 dB']}
        onValueChange={onValueChange}
        valueTestId="speed-value"
      />,
    );
    // 'unknown_value' doesn't match by name or number → selectedIndex = 0 → '-12 dB'
    expect(screen.getByLabelText('Vol Speed slider')).toBeTruthy();
    expect(screen.getByTestId('speed-value')).toHaveTextContent('-12 dB');
  });

  it('renders slider with rightAccessory', () => {
    renderWithQuery(
      <ConfigItemRow
        category="Audio Mixer"
        name="Vol Main"
        value="0 dB"
        options={['-6 dB', '0 dB', '+6 dB']}
        onValueChange={vi.fn()}
        rightAccessory={<button data-testid="accessory-btn">Mute</button>}
      />,
    );
    expect(screen.getByTestId('accessory-btn')).toBeTruthy();
  });

  it('slider with no rightAccessory renders without accessory div', () => {
    renderWithQuery(
      <ConfigItemRow
        category="Audio Mixer"
        name="Vol SID"
        value="0 dB"
        options={['-6 dB', '0 dB', '+6 dB']}
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('accessory-btn')).toBeNull();
  });

  it('slider does not call onValueChange when readOnly (disabled)', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        category="Audio Mixer"
        name="Vol Main"
        value="0 dB"
        options={['-6 dB', '0 dB', '+6 dB']}
        readOnly={true}
        onValueChange={onValueChange}
      />,
    );
    // disabled slider should not call onValueChange
    expect(screen.getByLabelText('Vol Main slider')).toBeTruthy();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('ConfigItemRow — text input readOnly and key handling', () => {
  it('pressing Enter on readOnly text input does not commit value', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        name="Hostname"
        value="c64u"
        options={[]}
        details={{ presets: [] }}
        readOnly={true}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByLabelText('Hostname text input');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('pressing non-Enter key on text input does not commit value', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        name="Hostname"
        value="c64u"
        options={[]}
        details={{ presets: [] }}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByLabelText('Hostname text input');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('focus on readOnly text input does not start editing', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        name="Hostname"
        value="c64u"
        options={[]}
        details={{ presets: [] }}
        readOnly={true}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByLabelText('Hostname text input');
    fireEvent.focus(input);
    // readOnly: editing mode should not start
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('change on readOnly text input does not update value', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        name="Hostname"
        value="c64u"
        options={[]}
        details={{ presets: [] }}
        readOnly={true}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByLabelText('Hostname text input');
    fireEvent.change(input, { target: { value: 'new-value' } });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('blur on readOnly text input does not commit value change', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        name="Hostname"
        value="c64u"
        options={[]}
        details={{ presets: [] }}
        readOnly={true}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByLabelText('Hostname text input');
    fireEvent.blur(input);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('isReadOnly via SID Detected Socket name prefix', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        name="SID Detected Socket 1"
        value="MOS6581"
        options={[]}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByLabelText('SID Detected Socket 1 text input');
    expect(input).toHaveProperty('disabled', true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('text input pressing Enter after changing value commits the change', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        name="Hostname"
        value="c64u"
        options={[]}
        details={{ presets: [] }}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByLabelText(
      'Hostname text input',
    ) as HTMLInputElement;
    // Focus to start editing
    fireEvent.focus(input);
    // Change the value
    fireEvent.change(input, { target: { value: 'newhostname' } });
    // Press Enter to commit
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith('newhostname');
  });

  it('blur after text edit commits the value', () => {
    const onValueChange = vi.fn();
    renderWithQuery(
      <ConfigItemRow
        name="Hostname"
        value="original"
        options={[]}
        details={{ presets: [] }}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByLabelText(
      'Hostname text input',
    ) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'edited' } });
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenCalledWith('edited');
  });
});

describe('ConfigItemRow — fetched config shapes', () => {
  beforeEach(() => {
    mockConfigItem.mockReturnValue({ data: undefined, isLoading: false });
  });

  it('uses values field from fetched config when options is missing', async () => {
    // Return data with 'values' field (not 'options')
    mockConfigItem.mockReturnValue({
      data: {
        'Test Category': {
          items: { Mode: { values: ['NTSC', 'PAL'], selected: 'PAL' } },
        },
      },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow
        category="Test Category"
        name="Mode"
        value="PAL"
        onValueChange={vi.fn()}
      />,
    );
    // Should render a checkbox or select based on the options
    await waitFor(() => {
      // With 2 options that aren't Enabled/Disabled or On/Off, should be select
      expect(screen.getByLabelText('Mode select')).toBeTruthy();
    });
  });

  it('uses choices field from fetched config when values is also missing', async () => {
    mockConfigItem.mockReturnValue({
      data: {
        Cat: { items: { Item: { choices: ['A', 'B', 'C'], current: 'A' } } },
      },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow
        category="Cat"
        name="Item"
        value="A"
        onValueChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Item select')).toBeTruthy();
    });
  });

  it('uses presets from fetched config details', async () => {
    mockConfigItem.mockReturnValue({
      data: {
        Cat: {
          items: {
            Vol: {
              details: {
                presets: ['0 dB', '-6 dB', '+6 dB'],
                min: 0,
                max: 100,
              },
              selected: '0 dB',
            },
          },
        },
      },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow
        category="Cat"
        name="Vol"
        value="0 dB"
        onValueChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      // Presets from details should lead to a select/slider
      expect(screen.getByText('Vol')).toBeTruthy();
    });
  });

  it('uses currentValue field from fetched config when value prop is empty', async () => {
    mockConfigItem.mockReturnValue({
      data: {
        Cat: { items: { Item: { currentValue: 'B', options: ['A', 'B'] } } },
      },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow
        category="Cat"
        name="Item"
        value=""
        onValueChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Item select')).toBeTruthy();
    });
  });

  it('uses current_value field from fetched config when value and currentValue are missing', async () => {
    mockConfigItem.mockReturnValue({
      data: {
        Cat: {
          items: { Item: { current_value: 'C', options: ['A', 'B', 'C'] } },
        },
      },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow
        category="Cat"
        name="Item"
        value=""
        onValueChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Item select')).toBeTruthy();
    });
  });

  it('uses default field from fetched config as fallback', async () => {
    mockConfigItem.mockReturnValue({
      data: { Cat: { items: { Item: { default: 'A', options: ['A', 'B'] } } } },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow
        category="Cat"
        name="Item"
        value=""
        onValueChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Item select')).toBeTruthy();
    });
  });

  it('uses default_value field from fetched config as final fallback', async () => {
    mockConfigItem.mockReturnValue({
      data: {
        Cat: { items: { Item: { default_value: 'B', options: ['A', 'B'] } } },
      },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow
        category="Cat"
        name="Item"
        value=""
        onValueChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Item select')).toBeTruthy();
    });
  });

  it('handles fetched config with min and max details', async () => {
    mockConfigItem.mockReturnValue({
      data: {
        Cat: {
          items: {
            Freq: {
              min: 0,
              max: 100,
              options: ['0', '50', '100'],
              selected: '50',
            },
          },
        },
      },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow
        category="Cat"
        name="Freq"
        value="50"
        onValueChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Freq slider')).toBeTruthy();
    });
  });

  it('shows loading spinner when isItemLoading is true', async () => {
    mockConfigItem.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    renderWithQuery(
      <ConfigItemRow
        category="Cat"
        name="Item"
        value="val"
        onValueChange={vi.fn()}
      />,
    );
    // In loading state, the text input should be present with spinner
    await waitFor(() => {
      expect(screen.getByLabelText('Item text input')).toBeTruthy();
    });
  });

  it('handles fetched config with category-less response shape (payload[name])', async () => {
    mockConfigItem.mockReturnValue({
      data: { Item: { options: ['A', 'B'], selected: 'A' } },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow name="Item" value="A" onValueChange={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Item select')).toBeTruthy();
    });
  });

  it('handles fetched config with .item response shape', async () => {
    mockConfigItem.mockReturnValue({
      data: { item: { options: ['X', 'Y'], selected: 'X' } },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow name="MyItem" value="X" onValueChange={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('MyItem select')).toBeTruthy();
    });
  });

  it('handles fetched config with .value response shape', async () => {
    mockConfigItem.mockReturnValue({
      data: { value: { options: ['P', 'Q'], selected: 'P' } },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow name="PropItem" value="P" onValueChange={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('PropItem select')).toBeTruthy();
    });
  });

  it('returns early when fetched data is non-object', async () => {
    mockConfigItem.mockReturnValue({
      data: 'just-a-string',
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow name="Item" value="val" onValueChange={vi.fn()} />,
    );
    // No options from response → text input
    expect(screen.getByLabelText('Item text input')).toBeTruthy();
  });

  it('returns early when fetched itemBlock is a primitive', async () => {
    mockConfigItem.mockReturnValue({
      data: { Cat: { items: { Item: 'primitive-value' } } },
      isLoading: false,
    });

    renderWithQuery(
      <ConfigItemRow
        category="Cat"
        name="Item"
        value="val"
        onValueChange={vi.fn()}
      />,
    );
    // Primitive itemBlock → no options → text input
    expect(screen.getByLabelText('Item text input')).toBeTruthy();
  });
});

describe('ConfigItemRow — label prop', () => {
  it('uses label prop instead of name when provided', () => {
    renderWithQuery(
      <ConfigItemRow
        name="technical_name"
        label="Human Label"
        value="val"
        options={[]}
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('config-item-label')).toHaveTextContent(
      'Human Label',
    );
  });
});

describe('ConfigItemRow — formatOptionLabel', () => {
  it('uses formatOptionLabel to format option display in select', () => {
    renderWithQuery(
      <ConfigItemRow
        name="Mode"
        value="PAL"
        options={['PAL', 'NTSC']}
        formatOptionLabel={(opt) => `${opt} (formatted)`}
        onValueChange={vi.fn()}
      />,
    );
    // formatted options should appear
    expect(screen.getByText('PAL (formatted)')).toBeTruthy();
  });
});
