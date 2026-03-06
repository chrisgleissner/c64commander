/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate device over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  applyPointerButtonInteraction,
  CTA_HIGHLIGHT_ATTR,
  CTA_HIGHLIGHT_DURATION_MS,
  handlePointerButtonClick,
  registerGlobalButtonInteractionModel,
} from '@/lib/ui/buttonInteraction';

const makeButton = () => {
  const el = document.createElement('button');
  document.body.appendChild(el);
  return el;
};

describe('buttonInteraction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('applyPointerButtonInteraction', () => {
    it('sets tap-flash attribute on the target element', () => {
      const el = makeButton();
      applyPointerButtonInteraction(el);
      expect(el.hasAttribute(CTA_HIGHLIGHT_ATTR)).toBe(true);
    });

    it('removes tap-flash attribute after the highlight duration', () => {
      const el = makeButton();
      applyPointerButtonInteraction(el);
      expect(el.hasAttribute(CTA_HIGHLIGHT_ATTR)).toBe(true);
      vi.advanceTimersByTime(CTA_HIGHLIGHT_DURATION_MS);
      expect(el.hasAttribute(CTA_HIGHLIGHT_ATTR)).toBe(false);
    });
  });

  describe('handlePointerButtonClick', () => {
    it('applies tap-flash on a normal click (detail > 0)', () => {
      const el = makeButton();
      handlePointerButtonClick({ detail: 1, currentTarget: el });
      expect(el.hasAttribute(CTA_HIGHLIGHT_ATTR)).toBe(true);
    });

    it('does nothing for synthetic keyboard-triggered click (detail === 0)', () => {
      const el = makeButton();
      handlePointerButtonClick({ detail: 0, currentTarget: el });
      expect(el.hasAttribute(CTA_HIGHLIGHT_ATTR)).toBe(false);
    });

    // P2-H: guard prevents double-flash when global pointerup handler already fired
    it('skips tap-flash when CTA_HIGHLIGHT_ATTR is already present (P2-H guard)', () => {
      const el = makeButton();
      // Simulate the global pointerup handler having already applied the flash
      el.setAttribute(CTA_HIGHLIGHT_ATTR, 'true');
      const setSpy = vi.spyOn(el, 'setAttribute');

      handlePointerButtonClick({ detail: 1, currentTarget: el });

      // setAttribute should NOT have been called again (no timer reset)
      expect(setSpy).not.toHaveBeenCalled();
    });

    it('does nothing when currentTarget is null', () => {
      // Should not throw
      expect(() =>
        handlePointerButtonClick({ detail: 1, currentTarget: null }),
      ).not.toThrow();
    });
  });

  describe('registerGlobalButtonInteractionModel', () => {
    let unregister: (() => void) | null = null;

    afterEach(() => {
      // Always clean up to prevent listener leaks between tests
      unregister?.();
      unregister = null;
    });

    it('applies tap-flash on pointerup for interactive elements', () => {
      const el = makeButton();
      unregister = registerGlobalButtonInteractionModel();
      el.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }),
      );
      expect(el.hasAttribute(CTA_HIGHLIGHT_ATTR)).toBe(true);
    });

    it('applies tap-flash for primary mouse button (button === 0, pointerType: mouse)', () => {
      const el = makeButton();
      unregister = registerGlobalButtonInteractionModel();
      // JSDOM defaults button to 0 which is the primary mouse button — handler should proceed
      el.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerType: 'mouse',
          button: 0,
        }),
      );
      expect(el.hasAttribute(CTA_HIGHLIGHT_ATTR)).toBe(true);
    });

    it('unregisters handler when returned cleanup function is called', () => {
      const el = makeButton();
      unregister = registerGlobalButtonInteractionModel();
      unregister();
      unregister = null;
      el.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }),
      );
      expect(el.hasAttribute(CTA_HIGHLIGHT_ATTR)).toBe(false);
    });
  });
});
