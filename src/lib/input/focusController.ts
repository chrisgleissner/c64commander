/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Focus / navigation controller for keyboard-only (D-pad + center) operation.
 *
 * This is pure logic — it holds an ordered registry of activatable items and
 * answers "what's next / previous / activate the current one". It deliberately
 * imports neither React nor the DOM so it can be unit-tested in isolation; a
 * thin adapter wires `focusNext`/`activateCurrent` to real key events and
 * `element.focus()`.
 *
 * Every CTA on a screen registers a {@link FocusItem}; `dpadDown`/`nextField`
 * → {@link FocusController.focusNext}, `dpadUp`/`previousField` →
 * {@link FocusController.focusPrevious}, `center`/`enter`/`activate` →
 * {@link FocusController.activateCurrent}. Disabled items are skipped during
 * navigation and refuse activation, so a destructive CTA can never be reached
 * by accident while it is disabled.
 */

export interface FocusItem {
  readonly id: string;
  /** Lower sorts earlier. Ties broken by registration order. */
  readonly order: number;
  readonly group?: string;
  readonly disabled?: boolean;
  readonly activate: () => void;
}

interface InternalItem extends FocusItem {
  readonly seq: number;
}

const isEnabled = (item: FocusItem): boolean => !item.disabled;

export class FocusController {
  private items: InternalItem[] = [];
  private seqCounter = 0;
  private currentId: string | null = null;

  /** Registers (or replaces) an item, keeping the registry ordered. */
  register(item: FocusItem): void {
    const existing = this.items.find((entry) => entry.id === item.id);
    const seq = existing ? existing.seq : this.seqCounter++;
    this.items = this.items.filter((entry) => entry.id !== item.id);
    this.items.push({ ...item, seq });
    this.sort();
    if (this.currentId === null && isEnabled(item)) {
      this.currentId = item.id;
    }
  }

  /** Removes an item; clears `current` if it was the one removed. */
  unregister(id: string): void {
    this.items = this.items.filter((entry) => entry.id !== id);
    if (this.currentId === id) {
      this.currentId = this.firstEnabledId();
    }
  }

  /** Removes every registered item and resets the current selection. */
  clear(): void {
    this.items = [];
    this.currentId = null;
  }

  /** The ordered list of items (enabled and disabled), as plain FocusItems. */
  list(): FocusItem[] {
    return this.items.map(({ seq: _seq, ...item }) => item);
  }

  current(): FocusItem | null {
    return this.items.find((entry) => entry.id === this.currentId) ?? null;
  }

  /** Selects a specific item by id; returns false if unknown. */
  setCurrent(id: string): boolean {
    if (!this.items.some((entry) => entry.id === id)) return false;
    this.currentId = id;
    return true;
  }

  /** Moves selection to the next enabled item (wraps around). */
  focusNext(): FocusItem | null {
    return this.step(1);
  }

  /** Moves selection to the previous enabled item (wraps around). */
  focusPrevious(): FocusItem | null {
    return this.step(-1);
  }

  /** Activates the current item if it is enabled; returns whether it fired. */
  activateCurrent(): boolean {
    const item = this.current();
    if (!item || !isEnabled(item)) return false;
    item.activate();
    return true;
  }

  private step(delta: number): FocusItem | null {
    const count = this.items.length;
    if (count === 0) return null;

    const enabledExists = this.items.some(isEnabled);
    if (!enabledExists) return null;

    const startIndex = this.items.findIndex((entry) => entry.id === this.currentId);
    // When nothing is selected, a forward step lands on the first enabled item
    // and a backward step on the last enabled item.
    let index = startIndex < 0 ? (delta > 0 ? -1 : 0) : startIndex;

    for (let i = 0; i < count; i++) {
      index = (index + delta + count) % count;
      const candidate = this.items[index];
      if (isEnabled(candidate)) {
        this.currentId = candidate.id;
        return this.toFocusItem(candidate);
      }
    }
    return this.current();
  }

  private firstEnabledId(): string | null {
    return this.items.find(isEnabled)?.id ?? null;
  }

  private sort(): void {
    this.items.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.seq - b.seq));
  }

  private toFocusItem(item: InternalItem): FocusItem {
    const { seq: _seq, ...rest } = item;
    return rest;
  }
}
