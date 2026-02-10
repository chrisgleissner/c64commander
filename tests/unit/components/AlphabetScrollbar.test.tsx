/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlphabetScrollbar } from '@/components/lists/AlphabetScrollbar';

const setScrollMetrics = (element: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true });
};

const createScrollContainer = () => {
  const container = document.createElement('div');
  container.innerHTML = '<div data-row-id="alpha"></div><div data-row-id="beta"></div>';
  container.querySelectorAll('[data-row-id]')
    .forEach((node) => Object.assign(node, { scrollIntoView: vi.fn() }));
  return container;
};

describe('AlphabetScrollbar', () => {
  it('selects a letter on touch and shows the badge', async () => {
    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);

    const onLetterSelect = vi.fn();
    const items = [
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' },
    ];

    render(
      <AlphabetScrollbar
        items={items}
        scrollContainerRef={{ current: container }}
        onLetterSelect={onLetterSelect}
      />,
    );

    const touchArea = await screen.findByTestId('alphabet-touch-area');
    Object.defineProperty(touchArea, 'getBoundingClientRect', {
      value: () => ({
        top: 0,
        left: 0,
        right: 0,
        bottom: 260,
        width: 20,
        height: 260,
        x: 0,
        y: 0,
        toJSON: () => '',
      }),
    });

    fireEvent.touchStart(touchArea, { touches: [{ clientY: 10 }] });

    expect(onLetterSelect).toHaveBeenCalledWith('A');
    expect(screen.getByTestId('alphabet-badge')).toBeInTheDocument();
  });

  it('shows overlay on scroll and hides after the idle timeout', async () => {
    vi.useFakeTimers();
    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);

    const items = [
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' },
    ];

    render(
      <AlphabetScrollbar
        items={items}
        scrollContainerRef={{ current: container }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const overlay = screen.getByTestId('alphabet-overlay');

    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });

    expect(overlay.className).toContain('opacity-100');

    act(() => {
      vi.advanceTimersByTime(1600);
    });

    expect(overlay.className).toContain('opacity-0');
    expect(screen.queryByTestId('alphabet-badge')).toBeNull();

    vi.useRealTimers();
  });
});
