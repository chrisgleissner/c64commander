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
  /**
   * Optional parent item id. Items with a parent are hidden from the top-level
   * d-pad ring until navigation descends into that parent, giving nested cards
   * and hierarchical CTA clusters a consistent tree-shaped traversal model.
   */
  readonly parentId?: string;
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
  private scopeParentId: string | null = null;

  /** Registers (or replaces) an item, keeping the registry ordered. */
  register(item: FocusItem): void {
    const existing = this.items.find((entry) => entry.id === item.id);
    const seq = existing ? existing.seq : this.seqCounter++;
    this.items = this.items.filter((entry) => entry.id !== item.id);
    this.items.push({ ...item, seq });
    this.sort();
    if (this.currentId === null && (item.parentId ?? null) === null && isEnabled(item)) {
      this.currentId = item.id;
    }
  }

  /** Removes an item; clears `current` if it was the one removed. */
  unregister(id: string): void {
    this.items = this.items.filter((entry) => entry.id !== id);
    if (this.currentId === id) {
      this.currentId = this.firstEnabledIdInScope(this.scopeParentId);
    }
    if (this.scopeParentId === id) {
      this.scopeParentId = null;
      this.currentId = this.firstEnabledIdInScope(null);
    }
  }

  /** Removes every registered item and resets the current selection. */
  clear(): void {
    this.items = [];
    this.currentId = null;
    this.scopeParentId = null;
  }

  /** The ordered list of items (enabled and disabled), as plain FocusItems. */
  list(): FocusItem[] {
    return this.items.map(({ seq: _seq, ...item }) => item);
  }

  current(): FocusItem | null {
    return this.items.find((entry) => entry.id === this.currentId) ?? null;
  }

  /** The parent id of the currently active nested scope, or null at root level. */
  currentScopeParentId(): string | null {
    return this.scopeParentId;
  }

  /** Selects a specific item by id; returns false if unknown. */
  setCurrent(id: string): boolean {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return false;
    this.scopeParentId = item.parentId ?? null;
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

  /** Descends into the current item's enabled children, if it has any. */
  focusFirstChild(): FocusItem | null {
    const current = this.current();
    if (!current) return null;
    const child = this.itemsInScope(current.id).find(isEnabled);
    if (!child) return null;
    this.scopeParentId = current.id;
    this.currentId = child.id;
    return this.toFocusItem(child);
  }

  /** Returns from a nested child scope to its parent item. */
  focusParent(): FocusItem | null {
    if (this.scopeParentId === null) return null;
    const parent = this.items.find((entry) => entry.id === this.scopeParentId);
    if (!parent) {
      this.scopeParentId = null;
      this.currentId = this.firstEnabledIdInScope(null);
      return this.current();
    }
    this.scopeParentId = parent.parentId ?? null;
    this.currentId = parent.id;
    return this.toFocusItem(parent);
  }

  /** Whether the current item has at least one enabled child. */
  currentHasEnabledChildren(): boolean {
    const current = this.current();
    return current ? this.itemsInScope(current.id).some(isEnabled) : false;
  }

  /** Activates the current item if it is enabled; returns whether it fired. */
  activateCurrent(): boolean {
    const item = this.current();
    if (!item || !isEnabled(item)) return false;
    item.activate();
    return true;
  }

  private step(delta: number): FocusItem | null {
    const scopedItems = this.itemsInScope(this.scopeParentId);
    const count = scopedItems.length;
    if (count === 0) return null;

    const enabledExists = scopedItems.some(isEnabled);
    if (!enabledExists) return null;

    const startIndex = scopedItems.findIndex((entry) => entry.id === this.currentId);
    // When nothing is selected, a forward step lands on the first enabled item
    // and a backward step on the last enabled item.
    let index = startIndex < 0 ? (delta > 0 ? -1 : 0) : startIndex;

    for (let i = 0; i < count; i++) {
      index = (index + delta + count) % count;
      const candidate = scopedItems[index];
      if (isEnabled(candidate)) {
        this.currentId = candidate.id;
        return this.toFocusItem(candidate);
      }
    }
    return this.current();
  }

  private firstEnabledIdInScope(parentId: string | null): string | null {
    return this.itemsInScope(parentId).find(isEnabled)?.id ?? null;
  }

  private itemsInScope(parentId: string | null): InternalItem[] {
    return this.items.filter((entry) => (entry.parentId ?? null) === parentId);
  }

  private sort(): void {
    this.items.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.seq - b.seq));
  }

  private toFocusItem(item: InternalItem): FocusItem {
    const { seq: _seq, ...rest } = item;
    return rest;
  }
}
