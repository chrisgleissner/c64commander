/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi } from 'vitest';
import { createSliderDeviceAdapter } from '@/lib/ui/sliderDeviceAdapter';

describe('createSliderDeviceAdapter', () => {
  it('onChange updates local value synchronously', () => {
    const setLocalValue = vi.fn();
    const applyToDevice = vi.fn();
    const adapter = createSliderDeviceAdapter({ setLocalValue, applyToDevice });

    adapter.onChange(42);

    expect(setLocalValue).toHaveBeenCalledWith(42);
  });

  it('onChange applies transform before setting local value', () => {
    const setLocalValue = vi.fn();
    const applyToDevice = vi.fn();
    const adapter = createSliderDeviceAdapter({
      setLocalValue,
      applyToDevice,
      transform: (v) => Math.min(v, 10),
    });

    adapter.onChange(42);

    expect(setLocalValue).toHaveBeenCalledWith(10);
  });

  it('onChange schedules best-effort device apply via microtask', async () => {
    const setLocalValue = vi.fn();
    const applyToDevice = vi.fn();
    const adapter = createSliderDeviceAdapter({ setLocalValue, applyToDevice });

    adapter.onChange(5);
    // applyToDevice not called synchronously
    expect(applyToDevice).not.toHaveBeenCalled();

    // Wait for microtask
    await Promise.resolve();

    expect(applyToDevice).toHaveBeenCalledWith(5);
  });

  it('coalesces rapid onChange calls into a single device apply', async () => {
    const setLocalValue = vi.fn();
    const applyToDevice = vi.fn();
    const adapter = createSliderDeviceAdapter({ setLocalValue, applyToDevice });

    adapter.onChange(1);
    adapter.onChange(2);
    adapter.onChange(3);

    expect(setLocalValue).toHaveBeenCalledTimes(3);

    await Promise.resolve();

    // Only the latest value is applied to device
    expect(applyToDevice).toHaveBeenCalledTimes(1);
    expect(applyToDevice).toHaveBeenCalledWith(3);
  });

  it('onCommit updates local value and applies immediately', () => {
    const setLocalValue = vi.fn();
    const applyToDevice = vi.fn();
    const adapter = createSliderDeviceAdapter({ setLocalValue, applyToDevice });

    adapter.onCommit(99);

    expect(setLocalValue).toHaveBeenCalledWith(99);
    expect(applyToDevice).toHaveBeenCalledWith(99);
  });

  it('onCommit cancels pending intermediate apply', async () => {
    const setLocalValue = vi.fn();
    const applyToDevice = vi.fn();
    const adapter = createSliderDeviceAdapter({ setLocalValue, applyToDevice });

    adapter.onChange(5);
    adapter.onCommit(10);

    await Promise.resolve();

    // Only the commit value should be applied, not the intermediate onChange
    expect(applyToDevice).toHaveBeenCalledTimes(1);
    expect(applyToDevice).toHaveBeenCalledWith(10);
  });

  it('onCommit applies transform', () => {
    const setLocalValue = vi.fn();
    const applyToDevice = vi.fn();
    const adapter = createSliderDeviceAdapter({
      setLocalValue,
      applyToDevice,
      transform: (v) => v * 2,
    });

    adapter.onCommit(5);

    expect(setLocalValue).toHaveBeenCalledWith(10);
    expect(applyToDevice).toHaveBeenCalledWith(10);
  });

  it('handlers are synchronous (no awaits or promises returned)', () => {
    const applyToDevice = vi.fn();
    const adapter = createSliderDeviceAdapter({
      setLocalValue: vi.fn(),
      applyToDevice,
    });

    const changeResult = adapter.onChange(1);
    const commitResult = adapter.onCommit(2);

    // Both return undefined (void), not a Promise
    expect(changeResult).toBeUndefined();
    expect(commitResult).toBeUndefined();
  });
});
