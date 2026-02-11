/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPointerButtonInteraction, handlePointerButtonClick } from './buttonInteraction';

describe('buttonInteraction', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('adds transient tap flash and clears it automatically', () => {
    vi.useFakeTimers();
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    applyPointerButtonInteraction(button);
    expect(button.getAttribute('data-c64-tap-flash')).toBe('true');

    vi.advanceTimersByTime(210);
    expect(button.hasAttribute('data-c64-tap-flash')).toBe(false);
  });

  it('skips tap flash for toggle-mode buttons', () => {
    const button = document.createElement('button');
    button.setAttribute('data-button-mode', 'toggle');
    document.body.appendChild(button);

    applyPointerButtonInteraction(button);
    expect(button.hasAttribute('data-c64-tap-flash')).toBe(false);
  });

  it('ignores keyboard-triggered clicks for stateless flash', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);

    handlePointerButtonClick({ detail: 0, currentTarget: button });
    expect(button.hasAttribute('data-c64-tap-flash')).toBe(false);
  });
});
