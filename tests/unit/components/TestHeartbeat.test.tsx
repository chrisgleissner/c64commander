/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestHeartbeat } from '@/components/TestHeartbeat';

describe('TestHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders with initial count 0', () => {
    render(<TestHeartbeat />);
    expect(screen.getByTestId('test-heartbeat')).toHaveTextContent('0');
  });

  it('increments counter after one second', () => {
    render(<TestHeartbeat />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('test-heartbeat')).toHaveTextContent('1');
  });

  it('increments counter after three seconds', () => {
    render(<TestHeartbeat />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('test-heartbeat')).toHaveTextContent('3');
  });

  it('clears interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(<TestHeartbeat />);
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('has correct accessibility attributes', () => {
    render(<TestHeartbeat />);
    const el = screen.getByRole('status', { name: 'test-heartbeat' });
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('id', 'test-heartbeat');
  });
});
