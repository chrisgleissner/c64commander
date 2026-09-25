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

import type { FocusController, FocusItem } from "./focusController";
import {
  GROUP_ATTR,
  GROUP_CONTAINER_SELECTOR,
  SECTION_LABEL_ATTR,
  SKIP_ATTR,
  TABBAR_SCOPE_SELECTOR,
  sortIntoReadingOrder,
  discoverInteractiveElements,
  isFocusDisabled,
  isFocusVisible,
  isNativelyFocusable,
  isSkipped,
  nearestGroupElement,
  resolveActiveScope,
  type ActiveScope,
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
];

/*
 * The overlays that take the ring when they open. Deliberately NOT OVERLAY_SELECTOR: that includes
 * listbox, and the search overlay is a skipped subtree whose listbox rows are rewritten on every
 * keystroke — the reason the skipped-subtree guard below exists at all.
 */
const MODAL_SELECTOR = "[role='dialog'],[role='alertdialog'],[role='menu']";

/** How long a return to an overlay's opener may wait for the opener to become enabled again. */
const RETURN_TO_OPENER_WINDOW_MS = 5000;

/**
 * The visible title a dialog names itself by. Without it a dialog's breadcrumb in the keypad
 * guidance bar fell through to its presentation attribute and read "sheet" or "dialog".
 */
const labelledByText = (element: Element): string | undefined => {
  const ids = element.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) ?? [];
  const text = ids
    .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return text || undefined;
};

export class FocusDiscoveryEngine {
  private readonly controller: FocusController;
  private readonly listExplicit: () => ExplicitRegistration[];
  private readonly freezeDuringTransientLayer: () => boolean;
  private readonly onAfterAssemble?: () => void;
  private readonly doc: Document;
  private observer: MutationObserver | null = null;
  private scheduled = false;
  private started = false;
  private shimmed = new Set<HTMLElement>();
  private resolvers = new Map<string, () => HTMLElement | null>();
  private sources = new Map<string, FocusDiscoverySource>();
  private scopeChain: FocusItem[] = [];
  /** The scope the last scan resolved, so the observer can tell which skipped subtrees matter. */
  private lastScope: Element | null = null;
  /** Where the ring stood in each scope it left, so closing an overlay returns to its opener. */
  private currentWhenLeft = new WeakMap<Element, string>();
  /**
   * A return that could not land yet: the opener is disabled while the write it started is pending, so it is
   * missing from the ring when the overlay closes. Retried on later scans while the ring still stands on the
   * fallback it was given, and dropped after {@link RETURN_TO_OPENER_WINDOW_MS}.
   */
  private pendingReturn: { scope: Element; id: string; fallbackId: string | undefined; until: number } | null = null;

  constructor(options: FocusDiscoveryEngineOptions) {
    this.controller = options.controller;
    this.listExplicit = options.listExplicit;
    this.freezeDuringTransientLayer = options.freezeDuringTransientLayer ?? (() => false);
    this.onAfterAssemble = options.onAfterAssemble;
    this.doc = options.doc ?? document;
  }

  private addsAnOverlay(record: MutationRecord): boolean {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(MODAL_SELECTOR) || node.querySelector(MODAL_SELECTOR) !== null) return true;
    }
    return false;
  }

  /** Attaches the observer and performs the first scan. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof MutationObserver !== "undefined") {
      this.observer = new MutationObserver((records) => {
        if (records.every((record) => this.cannotChangeRing(record))) return;
        this.scheduleRefresh();
      });
      this.observer.observe(this.doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: OBSERVED_ATTRIBUTES,
      });
    }
    this.refresh();
  }

  /** Detaches the observer, removes every `tabindex` shim, and clears the ring. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.scheduled = false;
    this.observer?.disconnect();
    this.observer = null;
    this.lastScope = null;
    this.pendingReturn = null;
    this.removeAllShims();
    this.resolvers.clear();
    this.sources.clear();
    this.controller.clear();
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
    if (record.attributeName === SKIP_ATTR) return false;
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    const skipped = target?.closest(`[${SKIP_ATTR}]`) ?? null;
    if (skipped === null) return false;
    // An overlay OPENING inside a skipped subtree is the one thing in there that does change the
    // ring, and containment cannot see it: the scope only moves inside once the scan has run.
    if (this.addsAnOverlay(record)) return false;
    return !(this.lastScope !== null && skipped.contains(this.lastScope));
  }

  /** Coalesces many DOM mutations into a single microtask re-scan. */
  scheduleRefresh(): void {
    if (!this.started || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.started) this.refresh();
    });
  }

  /** The live DOM element for a ring id (explicit resolver or captured element). */
  elementForId(id: string): HTMLElement | null {
    return this.resolvers.get(id)?.() ?? null;
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
  refresh(): void {
    if (!this.started) return;
    if (this.freezeDuringTransientLayer()) {
      this.observer?.takeRecords();
      this.onAfterAssemble?.();
      return;
    }
    const scope = resolveActiveScope(this.doc);
    const previousScope = this.lastScope;
    const scopeChanged = previousScope !== scope.element;
    const leavingId = this.controller.current()?.id;
    const leavingElement = leavingId ? this.elementForId(leavingId) : null;
    if (scopeChanged && previousScope && leavingId) this.currentWhenLeft.set(previousScope, leavingId);
    this.lastScope = scope.element;
    const nodes = this.collectRingNodes(scope);
    const items = this.assemble(nodes, scope.element);

    this.applyShims(items.shimTargets);
    this.resolvers = items.resolvers;
    this.sources = items.sources;
    this.controller.setItems(items.focusItems);
    // Closing a dropdown or dialog used to drop the ring on the page's first item, because the item it
    // stood on inside the overlay no longer exists. Returning to the item that opened it keeps a keypad
    // user where they were.
    const returningTo = scopeChanged ? this.currentWhenLeft.get(scope.element) : undefined;
    if (returningTo && !this.controller.setCurrent(returningTo)) {
      this.pendingReturn = {
        scope: scope.element,
        id: returningTo,
        fallbackId: this.controller.current()?.id,
        until: Date.now() + RETURN_TO_OPENER_WINDOW_MS,
      };
    } else if (!scopeChanged) {
      this.followReplacedStop(leavingId, leavingElement, items.focusItems, items.resolvers);
      this.retryPendingReturn(scope.element);
    }
    this.scopeChain = this.computeScopeChain();

    // Drop the mutation records our own tabindex writes just queued — the DOM is
    // already reflected in this scan, so reacting to them would loop.
    this.observer?.takeRecords();
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
  ): void {
    if (!leavingId || !leavingElement?.isConnected || focusItems.some((item) => item.id === leavingId)) return;
    const inside: Array<{ id: string; element: HTMLElement }> = [];
    for (const item of focusItems) {
      const element = resolvers.get(item.id)?.() ?? null;
      if (element && leavingElement.contains(element)) inside.push({ id: item.id, element });
    }
    const outermost = inside.find(
      (entry) => !inside.some((other) => other !== entry && other.element.contains(entry.element)),
    );
    if (outermost) this.controller.setCurrent(outermost.id);
  }

  private retryPendingReturn(scope: Element): void {
    const pending = this.pendingReturn;
    if (!pending) return;
    // A default selection follows the page's first item as the page reappears, which is not the
    // user moving away from the fallback.
    const userMoved =
      this.controller.current()?.id !== pending.fallbackId && !this.controller.currentIsDefaultSelection();
    const stillApplies = pending.scope === scope && Date.now() <= pending.until && !userMoved;
    if (!stillApplies) {
      this.pendingReturn = null;
      return;
    }
    if (this.controller.setCurrent(pending.id)) this.pendingReturn = null;
  }

  private collectRingNodes(scope: ActiveScope): RingNode[] {
    const scopeEl = scope.element;
    const excludeSubtrees = scope.kind === "page" ? [TABBAR_SCOPE_SELECTOR] : [];
    const discovered = discoverInteractiveElements(scopeEl, { excludeSubtrees });
    const discoveredSet = new Set<HTMLElement>(discovered);
    const elements: HTMLElement[] = [...discovered];

    // The persistent tab bar is its own scope, appended after page content.
    const tabbar = scope.kind === "page" ? this.doc.querySelector(TABBAR_SCOPE_SELECTOR) : null;
    if (tabbar instanceof HTMLElement && isFocusVisible(tabbar)) {
      elements.push(...discoverInteractiveElements(tabbar));
    }

    const inScope = (element: HTMLElement): boolean =>
      scopeEl.contains(element) || (tabbar instanceof HTMLElement && tabbar.contains(element));

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
      if (!inScope(element) || !isFocusVisible(element) || isSkipped(element, scopeEl)) continue;
      registrationByElement.set(element, registration);
      if (registration.descriptor.kind === "group") groupElements.add(element);
      // An explicitly-registered element that discovery missed (e.g. a non-
      // interactive group <div>) still joins the ring.
      if (!elements.includes(element)) elements.push(element);
    }
    // Explicit `useFocusGroup` registrations captured above are always honoured.
    const explicitGroupElements = new Set<Element>(groupElements);
    const implicitGroupCandidates = [
      ...(scopeEl instanceof HTMLElement && scopeEl.matches(GROUP_CONTAINER_SELECTOR) ? [scopeEl] : []),
      ...Array.from(scopeEl.querySelectorAll(GROUP_CONTAINER_SELECTOR)),
    ].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && isFocusVisible(element) && !isSkipped(element, scopeEl),
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
    for (const element of implicitGroupCandidates) {
      const containsAnotherGroupContainer = [...groupCandidatePool].some(
        (other) => other !== element && element.contains(other),
      );
      if (containsAnotherGroupContainer) continue;
      groupElements.add(element);
      if (!elements.includes(element)) elements.push(element);
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
    const ownedByExplicitItem = (element: HTMLElement): boolean =>
      !registrationByElement.has(element) &&
      explicitItemContainers.some((container) => container !== element && container.contains(element));

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
      .filter((element) => !isFocusDisabled(element) || groupElements.has(element));
    const inTabbar = (element: HTMLElement): boolean => tabbar instanceof HTMLElement && tabbar.contains(element);
    const ordered = [
      ...sortIntoReadingOrder(kept.filter((element) => !inTabbar(element))),
      ...sortIntoReadingOrder(kept.filter(inTabbar)),
    ];

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
        if (all.some((other) => other !== node && node.element.contains(other.element))) return node;
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
  } {
    const groupElements = new Set<Element>(nodes.filter((node) => node.isGroup).map((node) => node.element));
    const idByElement = new Map<Element, string>(nodes.map((node) => [node.element, node.id]));
    const focusItems: FocusItem[] = [];
    const resolvers = new Map<string, () => HTMLElement | null>();
    const sources = new Map<string, FocusDiscoverySource>();
    const shimTargets: HTMLElement[] = [];

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

      focusItems.push({
        id: node.id,
        order: descriptor?.order ?? 0,
        // `group` now carries the human breadcrumb label (Objective 5 — `group`
        // given real meaning), falling back to the legacy free-text group field.
        group: descriptor?.label ?? descriptor?.group ?? implicitGroupLabel,
        parentId: parentId ?? undefined,
        disabled: descriptor?.disabled,
        activate,
      });
      resolvers.set(node.id, () => element);
      sources.set(node.id, node.source);

      // Focus needs a tabindex on a non-natively-focusable element; the group
      // container divs and `[role=button]`-style controls get a -1 shim while on.
      if (!isNativelyFocusable(element)) shimTargets.push(element);
    }

    return { focusItems, resolvers, sources, shimTargets };
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
