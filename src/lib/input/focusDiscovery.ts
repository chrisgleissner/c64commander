/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The stateful half of scope-based auto-discovery. {@link discovery} answers the
 * stateless questions (active scope, which elements, in what order); this engine
 * holds the moving parts: a debounced {@link MutationObserver}, the assembly of
 * discovered elements + explicit refinements into an ordered {@link FocusItem}
 * ring (pushed in one {@link FocusController.setItems} call), and the `tabindex`
 * shims that let the ring focus a non-natively-focusable interactive element.
 *
 * It is DOM-aware but framework-agnostic (no React) so it can be unit-tested in
 * jsdom. The React adapter ({@link FocusNavigationProvider}) owns its lifecycle:
 * `start()` when the flag is on, `stop()` (which removes every shim and clears
 * the ring) when it is off — preserving the Prime Directive byte-for-byte.
 */

import { afterNextPaint } from "@/lib/ui/afterNextPaint";
import { afterStagedRowsSettle, isInsidePendingList } from "@/lib/ui/stagedRows";
import type { FocusController, FocusItem } from "./focusController";
import {
  GROUP_ATTR,
  GROUP_CONTAINER_SELECTOR,
  INTERACTIVE_SELECTOR,
  OVERLAY_SELECTOR,
  SCOPE_ATTR,
  SECTION_LABEL_ATTR,
  SECTION_SCOPE_SELECTOR,
  SKIP_ATTR,
  TABBAR_SCOPE_SELECTOR,
  createDiscoveryScan,
  createScanWarmer,
  sortIntoReadingOrder,
  discoverInteractiveElements,
  isFocusDisabled,
  isFocusVisible,
  isNativelyDisabled,
  isNativelyFocusable,
  isSkipped,
  nearestGroupElement,
  resolveActiveScope,
  type ActiveScope,
  type DiscoveryScan,
} from "./discovery";

/**
 * Optional refinement attached to an element via `useFocusItem`/`useFocusGroup`.
 * Discovery already makes the element reachable; a descriptor only overrides id /
 * order / grouping / activation / disabled / skip.
 */
export interface FocusDescriptor {
  readonly id: string;
  /** A `group` declares its discovered descendants its children (OK descends in). */
  readonly kind?: "item" | "group";
  readonly order?: number;
  /** Legacy/scope label; surfaced in the guidance-bar breadcrumb for a group. */
  readonly group?: string;
  readonly label?: string;
  /** Explicit parent override (legacy); normally parent comes from DOM containment. */
  readonly parentId?: string;
  readonly disabled?: boolean;
  /** Opt this element out of the ring entirely. */
  readonly skip?: boolean;
  readonly activate?: () => void;
}

export interface ExplicitRegistration {
  readonly descriptor: FocusDescriptor;
  readonly resolveElement: () => HTMLElement | null;
}

export interface FocusDiscoveryEngineOptions {
  readonly controller: FocusController;
  /** Live snapshot of the explicit `useFocusItem`/`useFocusGroup` registrations. */
  readonly listExplicit: () => ExplicitRegistration[];
  /**
   * True while a focused widget has opened a transient popup (for example a
   * Radix Select listbox) and owns its own option navigation. During that window
   * the underlying ring must not rebuild onto the popup and lose its trigger.
   */
  readonly freezeDuringTransientLayer?: () => boolean;
  /** Run after every (re)assembly so the adapter can re-apply the highlight / bar. */
  readonly onAfterAssemble?: () => void;
  /**
   * Run when a scan moves the selection itself: back to the item that opened a closed overlay, or on to
   * the nearest stop after the selected one went away. DOM focus and the scroll position follow it.
   */
  readonly onSelectionMovedByScan?: (id: string) => void;
  readonly doc?: Document;
}

export type FocusDiscoverySource = "dom" | "explicit" | "dom+explicit";

const autoIds = new WeakMap<Element, string>();
let autoSeq = 0;
const autoIdFor = (element: Element): string => {
  let id = autoIds.get(element);
  if (!id) {
    id = `kn-${(autoSeq += 1)}`;
    autoIds.set(element, id);
  }
  return id;
};

interface RingNode {
  readonly element: HTMLElement;
  readonly id: string;
  readonly isGroup: boolean;
  readonly source: FocusDiscoverySource;
  readonly registration?: ExplicitRegistration;
}

const OBSERVED_ATTRIBUTES = [
  "disabled",
  "aria-disabled",
  "aria-hidden",
  "hidden",
  "inert",
  "tabindex",
  "role",
  "href",
  "type",
  "open",
  "contenteditable",
  GROUP_ATTR,
  "data-key-nav-skip",
  // Read for the guidance bar; only a group's aria-label is read during a scan.
  "aria-label",
];

/** Marks app chrome repeated on every page; see {@link FocusItem.chrome}. */
export const FOCUS_CHROME_ATTR = "data-focus-chrome";

/*
 * The overlays that take the ring when they open. Deliberately NOT OVERLAY_SELECTOR: that includes
 * listbox, and the search overlay is a skipped subtree whose listbox rows are rewritten on every
 * keystroke — the reason the skipped-subtree guard below exists at all.
 */
const MODAL_SELECTOR = "[role='dialog'],[role='alertdialog'],[role='menu']";

/** How long a return to an overlay's opener may wait for the opener to become enabled again. */
const RETURN_TO_OPENER_WINDOW_MS = 5000;
const WARM_SLICE_BUDGET_MS = 8;
const MAX_WARM_RESTARTS = 3;

const labellingElements = (element: Element): HTMLElement[] =>
  (element.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) ?? [])
    .map((id) => element.ownerDocument.getElementById(id))
    .filter((label): label is HTMLElement => label !== null);

/**
 * The visible title a dialog names itself by. Without it a dialog's breadcrumb in the keypad
 * guidance bar fell through to its presentation attribute and read "sheet" or "dialog".
 */
const labelledByText = (element: Element): string | undefined => {
  const text = labellingElements(element)
    .map((label) => label.textContent.trim())
    .filter(Boolean)
    .join(" ");
  return text || undefined;
};

/** The page slot, or the tab bar, that holds a stop; null outside both, as in a plain document. */
const regionOf = (element: Element): Element | null => element.closest(`[data-slot-active],${TABBAR_SCOPE_SELECTOR}`);

/**
 * A childList record that only swaps text or comment nodes, as setting `textContent` on a readout
 * does. It cannot add or remove a stop, and a readout that updates while sound plays would otherwise
 * rescan the whole page on every update.
 */
const changesOnlyText = (record: MutationRecord): boolean => {
  if (record.type !== "childList") return false;
  const isElement = (node: Node) => node.nodeType === Node.ELEMENT_NODE;
  return !Array.from(record.addedNodes).some(isElement) && !Array.from(record.removedNodes).some(isElement);
};

/**
 * Everything a scan can find or be steered by. A node that is none of these and holds none of them
 * cannot add, remove or regroup a ring stop: an icon swapped inside a button, a checkbox's tick, a
 * count or a status line. Explicit `useFocusItem` registrations schedule their own re-scan.
 */
const RING_STRUCTURE_SELECTOR = [
  INTERACTIVE_SELECTOR,
  GROUP_CONTAINER_SELECTOR,
  OVERLAY_SELECTOR,
  SECTION_SCOPE_SELECTOR,
  `[${SCOPE_ATTR}]`,
  `[${SKIP_ATTR}]`,
  "[data-slot-active]",
].join(",");

const holdsOverlay = (node: Node): boolean =>
  node instanceof Element && (node.matches(MODAL_SELECTOR) || node.querySelector(MODAL_SELECTOR) !== null);

const holdsRingStructure = (node: Node): boolean =>
  node instanceof Element &&
  (node.matches(RING_STRUCTURE_SELECTOR) || node.querySelector(RING_STRUCTURE_SELECTOR) !== null);

/** A child list change whose added and removed nodes hold no ring structure. */
export const changesNoRingStructure = (record: MutationRecord): boolean =>
  record.type === "childList" &&
  !Array.from(record.addedNodes).some(holdsRingStructure) &&
  !Array.from(record.removedNodes).some(holdsRingStructure);

/** React writes an input's `type` on every render, which is no change and must not rescan the page. */
const rewritesAttributeWithSameValue = (record: MutationRecord): boolean =>
  record.type === "attributes" &&
  record.attributeName !== null &&
  record.target instanceof Element &&
  record.oldValue === record.target.getAttribute(record.attributeName);

/** Every element that has at least one of `elements` below it, found by climbing once from each. */
const properAncestorsOf = (elements: Iterable<Element>): Set<Element> => {
  const holding = new Set<Element>();
  for (const element of elements) {
    for (let node = element.parentElement; node && !holding.has(node); node = node.parentElement) holding.add(node);
  }
  return holding;
};

const hasAncestorIn = (element: Element, ancestors: ReadonlySet<Element>): boolean => {
  for (let node = element.parentElement; node; node = node.parentElement) if (ancestors.has(node)) return true;
  return false;
};

export class FocusDiscoveryEngine {
  private readonly controller: FocusController;
  private readonly listExplicit: () => ExplicitRegistration[];
  private readonly freezeDuringTransientLayer: () => boolean;
  private readonly onAfterAssemble?: () => void;
  private readonly onSelectionMovedByScan?: (id: string) => void;
  private readonly doc: Document;
  private observer: MutationObserver | null = null;
  /** Counts observed changes that can alter the ring, so measurements taken across one are discarded. */
  private pageChangeCount = 0;
  private scheduled = false;
  /** True while every change since the last scan only added content inside cards; see flushPendingRefresh. */
  private staleTolerable = false;
  private started = false;
  private shimmed = new Set<HTMLElement>();
  private resolvers = new Map<string, () => HTMLElement | null>();
  private sources = new Map<string, FocusDiscoverySource>();
  /** The page slot or tab bar each stop sat in when it was scanned; see {@link regionOf}. */
  private regions = new Map<string, Element | null>();
  private scopeChain: FocusItem[] = [];
  /** The scope the last scan resolved, so the observer can tell which skipped subtrees matter. */
  private lastScope: Element | null = null;
  /** Where the ring stood in each scope it left, so closing an overlay returns to its opener. */
  private currentWhenLeft = new WeakMap<Element, string>();
  private groupLabelElements: HTMLElement[] = [];
  private groupElements = new Set<Element>();
  /**
   * A return that could not land yet: the opener is disabled while the write it started is pending, so it is
   * missing from the ring when the overlay closes. Retried on later scans while the ring still stands on the
   * fallback it was given, and dropped after {@link RETURN_TO_OPENER_WINDOW_MS}.
   */
  private pendingReturn: { scope: Element; id: string; fallbackId: string | undefined; until: number } | null = null;
  /** Where the ring stood when a surface that owns the keys hid every stop on the page, restored when they return. */
  private standingWhenRingEmptied: { scope: Element; id: string } | null = null;

  constructor(options: FocusDiscoveryEngineOptions) {
    this.controller = options.controller;
    this.listExplicit = options.listExplicit;
    this.freezeDuringTransientLayer = options.freezeDuringTransientLayer ?? (() => false);
    this.onAfterAssemble = options.onAfterAssemble;
    this.onSelectionMovedByScan = options.onSelectionMovedByScan;
    this.doc = options.doc ?? document;
  }

  private addsAnOverlay(record: MutationRecord): boolean {
    return Array.from(record.addedNodes).some(holdsOverlay);
  }

  /** Attaches the observer and performs the first scan. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof MutationObserver !== "undefined") {
      this.observer = new MutationObserver((records) => {
        if (records.every((record) => this.cannotChangeRing(record))) {
          // The guidance bar shows the selected control's own text, so a rewrite there still notifies.
          if (records.some((record) => this.relabelsCurrent(record))) this.onAfterAssemble?.();
          return;
        }
        this.pageChangeCount += 1;
        this.scheduleRefresh(
          records.some((record) => !isInsidePendingList(record.target)),
          records
            .filter((record) => !this.cannotChangeRing(record))
            .every((record) => this.onlyAddsContentToOpenSection(record)),
        );
      });
      this.observer.observe(this.doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: OBSERVED_ATTRIBUTES,
      });
    }
    this.doc.defaultView?.addEventListener("resize", this.countPageChange);
    this.refresh();
  }

  private readonly countPageChange = () => {
    this.pageChangeCount += 1;
  };

  /** Detaches the observer, removes every `tabindex` shim, and clears the ring. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.scheduled = false;
    this.observer?.disconnect();
    this.observer = null;
    this.doc.defaultView?.removeEventListener("resize", this.countPageChange);
    this.lastScope = null;
    this.pendingReturn = null;
    this.standingWhenRingEmptied = null;
    this.removeAllShims();
    this.resolvers.clear();
    this.sources.clear();
    this.regions.clear();
    this.groupLabelElements = [];
    this.groupElements.clear();
    this.controller.clear();
  }

  /** A change to the children of a card inside the scanned scope that adds or removes no overlay. */
  private onlyAddsContentToOpenSection(record: MutationRecord): boolean {
    if (record.type !== "childList" || this.lastScope === null) return false;
    const target = record.target;
    if (!(target instanceof Element) || !this.lastScope.contains(target)) return false;
    if (target.closest(SECTION_SCOPE_SELECTOR) === null) return false;
    return !this.addsAnOverlay(record) && !Array.from(record.removedNodes).some(holdsOverlay);
  }

  private relabelsCurrent(record: MutationRecord): boolean {
    const currentId = this.controller.current()?.id;
    const current = currentId ? this.elementForId(currentId) : null;
    const relabels =
      changesNoRingStructure(record) ||
      (record.attributeName === "aria-label" && !rewritesAttributeWithSameValue(record));
    return current !== null && relabels && current.contains(record.target);
  }

  /** A group's breadcrumb label is read from its `aria-labelledby` elements only during a scan. */
  private renamesAGroup(record: MutationRecord): boolean {
    return this.groupLabelElements.some((label) => label.contains(record.target));
  }

  /*
   * A mutation inside a skipped subtree that does not contain the active scope changes nothing:
   * the ring rejects everything in it either way. The search overlay is skipped and rewrites its
   * result list on every keystroke, and each of those rescanned the whole page behind it —
   * getComputedStyle and getBoundingClientRect per node, over 100 ms on a Pixel 4. The containment
   * test keeps a dialog nested INSIDE a skipped region working once the scope has moved into it,
   * and the overlay test covers the moment before that, when it is only being mounted.
   */
  private cannotChangeRing(record: MutationRecord): boolean {
    if (changesOnlyText(record)) return !this.renamesAGroup(record);
    if (changesNoRingStructure(record)) return !this.renamesAGroup(record);
    if (rewritesAttributeWithSameValue(record)) return true;
    if (record.attributeName === "aria-label") return !this.groupElements.has(record.target as Element);
    if (record.attributeName === SKIP_ATTR) return false;
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    const skipped = target?.closest(`[${SKIP_ATTR}]`) ?? null;
    if (skipped === null) return false;
    // An overlay OPENING inside a skipped subtree is the one thing in there that does change the
    // ring, and containment cannot see it: the scope only moves inside once the scan has run.
    if (this.addsAnOverlay(record)) return false;
    return !(this.lastScope !== null && skipped.contains(this.lastScope));
  }

  /**
   * Coalesces DOM mutations into one re-scan after the next paint. Run in a microtask, the scan landed
   * before the first paint of every page and dialog: on a Pixel 4, 70 to 135 ms each, run up to seven
   * times while a page loaded. A key runs a pending scan first (see flushPendingRefresh). A change made
   * only by a list still building its rows a few per task waits until the list is finished; any other
   * change, such as an overlay or a route change, is scanned after the next paint as before.
   */
  scheduleRefresh(urgent = false, staleTolerable = false): void {
    if (!this.started) return;
    this.staleTolerable = this.scheduled ? this.staleTolerable && staleTolerable : staleTolerable;
    if (this.scheduled && !urgent) return;
    this.scheduled = true;
    afterNextPaint(() =>
      urgent
        ? this.refreshInSlices(MAX_WARM_RESTARTS)
        : afterStagedRowsSettle(() => this.refreshInSlices(MAX_WARM_RESTARTS)),
    );
  }

  /**
   * Measures the page in slices of {@link WARM_SLICE_BUDGET_MS}, then scans once on the measurements. A key press
   * between slices acts on the last ring, or runs the scan itself and ends the slicing. A change to the page
   * while measuring discards the measurements; after {@link MAX_WARM_RESTARTS} discards the scan runs unwarmed.
   */
  private refreshInSlices(restartsLeft: number): void {
    if (!this.scheduled || !this.started) return;
    const scan = createDiscoveryScan();
    const scope = resolveActiveScope(this.doc, scan);
    if (scope.kind === "overlay" || restartsLeft <= 0) {
      this.flushPendingRefresh();
      return;
    }
    const warmer = createScanWarmer(scope.element, scan);
    const generation = this.pageChangeCount;
    const step = () => {
      if (!this.scheduled || !this.started) return;
      if (!warmer.step(WARM_SLICE_BUDGET_MS)) {
        setTimeout(step, 0);
        return;
      }
      if (generation !== this.pageChangeCount) {
        this.refreshInSlices(restartsLeft - 1);
        return;
      }
      this.scheduled = false;
      this.refresh(scan);
    };
    step();
  }

  /** Re-scans now, for a caller that has just changed the DOM itself; any scheduled re-scan is dropped. */
  refreshNow(): void {
    this.scheduled = false;
    if (this.started) this.refresh();
  }

  /**
   * Runs a scheduled re-scan now, so a key never acts on a ring that is older than the DOM.
   * `allowStaleRing` lets a key act on the last ring while the pending change only added content
   * inside cards and every stop of that ring is still attached; the scheduled re-scan then runs after
   * the next paint instead of inside the key press, where it cost 400 ms on the keypad handset.
   */
  flushPendingRefresh(options: { allowStaleRing?: boolean } = {}): void {
    if (!this.scheduled) return;
    if (options.allowStaleRing && this.staleTolerable && this.everyStopIsAttached()) return;
    this.scheduled = false;
    if (this.started) this.refresh();
  }

  private everyStopIsAttached(): boolean {
    for (const resolve of this.resolvers.values()) if (!resolve()?.isConnected) return false;
    return this.resolvers.size > 0;
  }

  /** The live DOM element for a ring id (explicit resolver or captured element). */
  elementForId(id: string): HTMLElement | null {
    return this.resolvers.get(id)?.() ?? null;
  }

  /** Whether `element` is itself one of the ring's stops. */
  isRingStop(element: Element): boolean {
    for (const resolve of this.resolvers.values()) if (resolve() === element) return true;
    return false;
  }

  /** Whether a ring item came from DOM discovery, explicit registration, or both. */
  sourceForId(id: string): FocusDiscoverySource | null {
    return this.sources.get(id) ?? null;
  }

  /** Root→current chain of group items the ring is inside, for the breadcrumb. */
  currentScopeChain(): FocusItem[] {
    return this.scopeChain;
  }

  /** Re-scans the active scope and rebuilds the ring in one batch. */
  refresh(warmedScan?: DiscoveryScan): void {
    if (!this.started) return;
    this.staleTolerable = false;
    if (this.freezeDuringTransientLayer()) {
      this.observer?.takeRecords();
      this.onAfterAssemble?.();
      return;
    }
    const scan = warmedScan ?? createDiscoveryScan();
    const scope = resolveActiveScope(this.doc, scan);
    const previousScope = this.lastScope;
    const scopeChanged = previousScope !== scope.element;
    const leavingId = this.controller.current()?.id;
    const leavingElement = leavingId ? this.elementForId(leavingId) : null;
    const previousItems = this.controller.list();
    const leavingWasDefault = this.controller.currentIsDefaultSelection();
    if (scopeChanged && previousScope && leavingId) this.currentWhenLeft.set(previousScope, leavingId);
    this.lastScope = scope.element;
    // A selected control that is disabled while the work it started runs (Pause, Menu) stays the
    // selection, as an aria-disabled one does; dropping it moved the ring to the top of the group.
    const heldWhileDisabled =
      !scopeChanged && leavingElement?.isConnected && isNativelyDisabled(leavingElement) ? leavingElement : null;
    const nodes = this.collectRingNodes(scope, scan, heldWhileDisabled);
    const items = this.assemble(nodes, scope.element);

    this.applyShims(items.shimTargets);
    this.resolvers = items.resolvers;
    this.sources = items.sources;
    const previousRegions = this.regions;
    this.regions = new Map(nodes.map((node) => [node.id, regionOf(node.element)]));
    this.groupLabelElements = items.groupLabelElements;
    this.groupElements = new Set(nodes.filter((node) => node.isGroup).map((node) => node.element));
    this.controller.setItems(items.focusItems);
    // Closing a dropdown or dialog used to drop the ring on the page's first item, because the item it
    // stood on inside the overlay no longer exists. Returning to the item that opened it keeps a keypad
    // user where they were.
    const returningTo = scopeChanged ? this.currentWhenLeft.get(scope.element) : undefined;
    // Used once: kept, it outlived later openers, and closing Remote Input's menu went back to Backup.
    if (returningTo) this.currentWhenLeft.delete(scope.element);
    let returnedTo: string | undefined;
    if (returningTo && this.controller.setCurrent(returningTo)) {
      returnedTo = returningTo;
    } else if (returningTo) {
      this.pendingReturn = {
        scope: scope.element,
        id: returningTo,
        fallbackId: this.controller.current()?.id,
        until: Date.now() + RETURN_TO_OPENER_WINDOW_MS,
      };
    } else if (!scopeChanged) {
      returnedTo =
        this.followReplacedStop(leavingId, leavingElement, items.focusItems, items.resolvers) ??
        (leavingWasDefault ? undefined : this.followVanishedStop(leavingId, previousItems, previousRegions));
      returnedTo = this.retryPendingReturn(scope.element) ?? returnedTo;
    }
    returnedTo ??= this.restoreStandingAfterEmptyRing(
      scope.element,
      scopeChanged ? undefined : leavingId,
      items.focusItems.length,
    );
    this.scopeChain = this.computeScopeChain();

    // Drop the mutation records our own tabindex writes just queued — the DOM is
    // already reflected in this scan, so reacting to them would loop.
    this.observer?.takeRecords();
    if (returnedTo) this.onSelectionMovedByScan?.(returnedTo);
    this.onAfterAssemble?.();
  }

  /**
   * A card stops being a ring stop when it opens and a labelled group appears inside it, because
   * only the innermost group container is one. The selection then fell to the page's first item;
   * it moves instead to the outermost stop inside the element it was on.
   */
  private followReplacedStop(
    leavingId: string | undefined,
    leavingElement: HTMLElement | null,
    focusItems: readonly FocusItem[],
    resolvers: Map<string, () => HTMLElement | null>,
  ): string | undefined {
    if (!leavingId || !leavingElement?.isConnected || focusItems.some((item) => item.id === leavingId)) {
      return undefined;
    }
    const inside: Array<{ id: string; element: HTMLElement }> = [];
    for (const item of focusItems) {
      const element = resolvers.get(item.id)?.() ?? null;
      if (element && leavingElement.contains(element)) inside.push({ id: item.id, element });
    }
    const outermost = inside.find(
      (entry) => !inside.some((other) => other !== entry && other.element.contains(entry.element)),
    );
    if (!outermost) return undefined;
    this.controller.setCurrent(outermost.id);
    return outermost.id;
  }

  /**
   * The selected stop went away (Remove selected items, an inline editor's Cancel). The ring took the
   * group's first stop, which can be far off screen; it moves to the nearest remaining sibling instead,
   * the following one first. Only a stop that is gone counts: a default selection that moved on to the
   * page's first stop when the page came back behind a closed dialog used to take the next tab.
   */
  private followVanishedStop(
    leavingId: string | undefined,
    previousItems: readonly FocusItem[],
    previousRegions: ReadonlyMap<string, Element | null>,
  ): string | undefined {
    if (!leavingId || this.controller.list().some((item) => item.id === leavingId)) return undefined;
    const leaving = previousItems.find((item) => item.id === leavingId);
    const parentId = leaving?.parentId ?? null;
    if (!leaving || this.controller.currentScopeParentId() !== parentId) return undefined;
    const remaining = new Set(
      this.controller
        .list()
        .filter((item) => !item.disabled && (item.parentId ?? null) === parentId)
        .map((item) => item.id),
    );
    // A route change leaves the page scope in place and removes every stop of the page, so the only
    // siblings left are the tab bar's. The default selection, the new page's first stop, is right then.
    const region = previousRegions.get(leavingId) ?? null;
    const siblings = previousItems.filter(
      (item) => item === leaving || ((item.parentId ?? null) === parentId && this.regions.get(item.id) === region),
    );
    const at = siblings.indexOf(leaving);
    for (let distance = 1; distance < siblings.length; distance += 1) {
      for (const candidate of [siblings[at + distance], siblings[at - distance]]) {
        if (candidate && remaining.has(candidate.id) && this.controller.setCurrent(candidate.id)) return candidate.id;
      }
    }
    return undefined;
  }

  /**
   * `leavingId` is where the ring stood in this same scope, or undefined when the scan came from another one:
   * the item a menu over a key-owning sheet stood on is no place to return to. The remembered stop outlives
   * scans of other scopes, such as Remote Input's own menu and its controls, and is used by the next scan
   * of its own scope that finds stops.
   */
  private restoreStandingAfterEmptyRing(scope: Element, leavingId: string | undefined, itemCount: number) {
    if (itemCount === 0) {
      if (leavingId) {
        this.standingWhenRingEmptied = { scope, id: leavingId };
        this.currentWhenLeft.delete(scope);
      }
      return undefined;
    }
    const standing = this.standingWhenRingEmptied;
    if (!standing || standing.scope !== scope) return undefined;
    this.standingWhenRingEmptied = null;
    if (!this.controller.currentIsDefaultSelection()) return undefined;
    if (this.controller.setCurrent(standing.id)) return standing.id;
    this.pendingReturn = {
      scope,
      id: standing.id,
      fallbackId: this.controller.current()?.id,
      until: Date.now() + RETURN_TO_OPENER_WINDOW_MS,
    };
    return undefined;
  }

  private retryPendingReturn(scope: Element): string | undefined {
    const pending = this.pendingReturn;
    if (!pending) return undefined;
    // A default selection follows the page's first item as the page reappears, which is not the
    // user moving away from the fallback.
    const userMoved =
      this.controller.current()?.id !== pending.fallbackId && !this.controller.currentIsDefaultSelection();
    const stillApplies = pending.scope === scope && Date.now() <= pending.until && !userMoved;
    if (!stillApplies) {
      this.pendingReturn = null;
      return undefined;
    }
    if (!this.controller.setCurrent(pending.id)) return undefined;
    this.pendingReturn = null;
    return pending.id;
  }

  private collectRingNodes(scope: ActiveScope, scan: DiscoveryScan, heldWhileDisabled: HTMLElement | null): RingNode[] {
    const scopeEl = scope.element;
    const excludeSubtrees = scope.kind === "page" ? [TABBAR_SCOPE_SELECTOR] : [];
    const discovered = discoverInteractiveElements(scopeEl, { excludeSubtrees, scan });
    const discoveredSet = new Set<HTMLElement>(discovered);
    const elements: HTMLElement[] = [...discovered];
    const inRing = new Set<HTMLElement>(discovered);
    const addToRing = (element: HTMLElement) => {
      if (inRing.has(element)) return;
      inRing.add(element);
      elements.push(element);
    };

    // The persistent tab bar is its own scope, appended after page content.
    const tabbar = scope.kind === "page" ? this.doc.querySelector(TABBAR_SCOPE_SELECTOR) : null;
    if (tabbar instanceof HTMLElement && isFocusVisible(tabbar, scan)) {
      elements.push(...discoverInteractiveElements(tabbar, { scan }));
    }

    const inScope = (element: HTMLElement): boolean =>
      scopeEl.contains(element) || (tabbar instanceof HTMLElement && tabbar.contains(element));
    const holdsDisabledSelection =
      heldWhileDisabled !== null &&
      inScope(heldWhileDisabled) &&
      isFocusVisible(heldWhileDisabled, scan) &&
      !isSkipped(heldWhileDisabled, scopeEl, scan);
    if (holdsDisabledSelection) addToRing(heldWhileDisabled);

    const registrationByElement = new Map<HTMLElement, ExplicitRegistration>();
    const groupElements = new Set<Element>();
    const skipElements = new Set<Element>();
    for (const registration of this.listExplicit()) {
      const element = registration.resolveElement();
      if (!element) continue;
      if (registration.descriptor.skip) {
        // An explicit opt-out removes the element even when discovery found it.
        skipElements.add(element);
        continue;
      }
      if (!inScope(element) || !isFocusVisible(element, scan) || isSkipped(element, scopeEl, scan)) continue;
      registrationByElement.set(element, registration);
      if (registration.descriptor.kind === "group") groupElements.add(element);
      // An explicitly-registered element that discovery missed (e.g. a non-
      // interactive group <div>) still joins the ring.
      addToRing(element);
    }
    // Explicit `useFocusGroup` registrations captured above are always honoured.
    const explicitGroupElements = new Set<Element>(groupElements);
    const implicitGroupCandidates = [
      ...(scopeEl instanceof HTMLElement && scopeEl.matches(GROUP_CONTAINER_SELECTOR) ? [scopeEl] : []),
      ...Array.from(scopeEl.querySelectorAll(GROUP_CONTAINER_SELECTOR)),
    ].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && isFocusVisible(element, scan) && !isSkipped(element, scopeEl, scan),
    );
    // A labelled container becomes a group only when it is the INNERMOST group
    // container — it must not contain another group container (explicit or
    // implicit). Otherwise an outer section wrapper (for example Home's
    // "Quick Config", which wraps the CPU & RAM / Ports / Video cards) would
    // swallow most of the page into a single focus stop and force an extra
    // OK-descend before the real controls. Innermost-wins keeps progression
    // shallow — page → card → control — instead of page → section → card →
    // control. Explicit `useFocusGroup` nesting is left untouched (intentional).
    const groupCandidatePool = new Set<Element>([...explicitGroupElements, ...implicitGroupCandidates]);
    const holdingAnotherGroupContainer = properAncestorsOf(groupCandidatePool);
    for (const element of implicitGroupCandidates) {
      if (holdingAnotherGroupContainer.has(element)) continue;
      groupElements.add(element);
      addToRing(element);
    }

    // The "field row" pattern: an explicit ITEM (not a group) that wraps
    // interactive descendants is a SINGLE ring stop that OWNS its subtree — OK
    // focuses the inner <input>, which is not itself a separate stop. Drop
    // discovered descendants of such items so they do not double-register.
    // (A GROUP, by contrast, adopts its descendants as children.) An element that
    // is itself explicitly registered is always kept.
    const explicitItemContainers = [...registrationByElement.entries()]
      .filter(([, registration]) => registration.descriptor.kind !== "group")
      .map(([element]) => element);
    const holdingExplicitItem = new Set<Element>(explicitItemContainers);
    const ownedByExplicitItem = (element: HTMLElement): boolean =>
      !registrationByElement.has(element) && hasAncestorIn(element, holdingExplicitItem);

    // Sort the union into reading order, then drop groups that ended up empty and
    // non-interactive (a decorative container with no controls is not a ring stop).
    //
    // Page content and the tab bar are sorted SEPARATELY and concatenated, which is what makes the
    // tab bar actually last. Sorting the union as one list did not: the tab bar sits outside the
    // scrolling `main.page-shell`, so under the old viewport-relative comparator each content stop
    // that had scrolled above the tab bar sorted before it and each one still below it sorted
    // after, putting the whole tab bar between every one or two content stops. Reading order is
    // now document-relative, which fixes the content-against-content instability, but content and
    // the tab bar live in different scroll contexts and are only ordered relative to each other by
    // the rule stated here and at TABBAR_SELECTOR: the tabs come last.
    const kept = elements
      .filter((element) => !skipElements.has(element))
      .filter((element) => !ownedByExplicitItem(element))
      .filter(
        (element) =>
          !isNativelyDisabled(element) ||
          groupElements.has(element) ||
          (holdsDisabledSelection && element === heldWhileDisabled),
      );
    const inTabbar = (element: HTMLElement): boolean => tabbar instanceof HTMLElement && tabbar.contains(element);
    const ordered = [
      ...sortIntoReadingOrder(
        kept.filter((element) => !inTabbar(element)),
        scan,
      ),
      ...sortIntoReadingOrder(kept.filter(inTabbar), scan),
    ];

    let holdingRingNode: Set<Element> | undefined;
    return ordered
      .map((element) => {
        const registration = registrationByElement.get(element);
        const isGroup = groupElements.has(element);
        const groupAttr = isGroup ? element.getAttribute(GROUP_ATTR) : null;
        const id = registration?.descriptor.id || (groupAttr ? groupAttr : autoIdFor(element));
        const source: FocusDiscoverySource = registration
          ? discoveredSet.has(element)
            ? "dom+explicit"
            : "explicit"
          : "dom";
        return { element, id, isGroup, source, registration };
      })
      .map((node, _index, all): RingNode | null => {
        if (!node.isGroup) return node;
        holdingRingNode ??= properAncestorsOf(all.map((other) => other.element));
        if (holdingRingNode.has(node.element)) return node;
        // A group with no in-scope descendant is either empty chrome, which is not a ring stop, or
        // a control that happens to carry a section label and has no interactive children of its
        // own. Dropping both took Home's System info button out of the ring entirely, with no key
        // able to reach it; the second kind is a leaf.
        if (isNativelyFocusable(node.element) || node.registration) return { ...node, isGroup: false };
        return null;
      })
      .filter((node): node is RingNode => node !== null);
  }

  private assemble(
    nodes: RingNode[],
    scopeEl: Element,
  ): {
    focusItems: FocusItem[];
    resolvers: Map<string, () => HTMLElement | null>;
    sources: Map<string, FocusDiscoverySource>;
    shimTargets: HTMLElement[];
    groupLabelElements: HTMLElement[];
  } {
    const groupElements = new Set<Element>(nodes.filter((node) => node.isGroup).map((node) => node.element));
    const idByElement = new Map<Element, string>(nodes.map((node) => [node.element, node.id]));
    const focusItems: FocusItem[] = [];
    const resolvers = new Map<string, () => HTMLElement | null>();
    const sources = new Map<string, FocusDiscoverySource>();
    const shimTargets: HTMLElement[] = [];
    const groupLabelElements: HTMLElement[] = [];

    for (const node of nodes) {
      const descriptor = node.registration?.descriptor;
      const parentElement = nearestGroupElement(node.element, groupElements, scopeEl);
      const parentId = descriptor?.parentId ?? (parentElement ? idByElement.get(parentElement) : undefined);

      const element = node.element;
      const activate =
        descriptor?.activate ??
        (() => {
          element.click();
        });

      const implicitGroupLabel = node.isGroup
        ? element.getAttribute(SECTION_LABEL_ATTR) ||
          element.getAttribute("aria-label") ||
          labelledByText(element) ||
          element.getAttribute("data-modal-surface") ||
          element.getAttribute("data-app-surface") ||
          element.getAttribute("data-sheet-presentation") ||
          undefined
        : undefined;
      if (node.isGroup) groupLabelElements.push(...labellingElements(element));

      focusItems.push({
        id: node.id,
        order: descriptor?.order ?? 0,
        // `group` now carries the human breadcrumb label (Objective 5 — `group`
        // given real meaning), falling back to the legacy free-text group field.
        group: descriptor?.label ?? descriptor?.group ?? implicitGroupLabel,
        parentId: parentId ?? undefined,
        disabled: descriptor?.disabled || (!node.isGroup && isFocusDisabled(element)) || undefined,
        chrome: element.closest(`[${FOCUS_CHROME_ATTR}]`) !== null || undefined,
        activate,
      });
      resolvers.set(node.id, () => element);
      sources.set(node.id, node.source);

      // Focus needs a tabindex on a non-natively-focusable element; the group
      // container divs and `[role=button]`-style controls get a -1 shim while on.
      if (!isNativelyFocusable(element)) shimTargets.push(element);
    }

    return { focusItems, resolvers, sources, shimTargets, groupLabelElements };
  }

  private applyShims(targets: HTMLElement[]): void {
    const next = new Set(targets);
    for (const element of this.shimmed) {
      if (!next.has(element)) {
        element.removeAttribute("tabindex");
        this.shimmed.delete(element);
      }
    }
    for (const element of next) {
      if (!this.shimmed.has(element) && !element.hasAttribute("tabindex")) {
        element.setAttribute("tabindex", "-1");
        this.shimmed.add(element);
      }
    }
  }

  private removeAllShims(): void {
    for (const element of this.shimmed) {
      element.removeAttribute("tabindex");
    }
    this.shimmed.clear();
  }

  private computeScopeChain(): FocusItem[] {
    const chain: FocusItem[] = [];
    let parentId = this.controller.currentScopeParentId();
    const list = this.controller.list();
    const byId = new Map(list.map((item) => [item.id, item]));
    const guard = new Set<string>();
    while (parentId && byId.has(parentId) && !guard.has(parentId)) {
      guard.add(parentId);
      const item = byId.get(parentId)!;
      chain.unshift(item);
      parentId = item.parentId ?? null;
    }
    return chain;
  }
}
