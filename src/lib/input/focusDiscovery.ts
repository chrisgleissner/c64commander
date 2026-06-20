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
  TABBAR_SCOPE_SELECTOR,
  compareFocusables,
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

export class FocusDiscoveryEngine {
  private readonly controller: FocusController;
  private readonly listExplicit: () => ExplicitRegistration[];
  private readonly onAfterAssemble?: () => void;
  private readonly doc: Document;
  private observer: MutationObserver | null = null;
  private scheduled = false;
  private started = false;
  private shimmed = new Set<HTMLElement>();
  private resolvers = new Map<string, () => HTMLElement | null>();
  private sources = new Map<string, FocusDiscoverySource>();
  private scopeChain: FocusItem[] = [];

  constructor(options: FocusDiscoveryEngineOptions) {
    this.controller = options.controller;
    this.listExplicit = options.listExplicit;
    this.onAfterAssemble = options.onAfterAssemble;
    this.doc = options.doc ?? document;
  }

  /** Attaches the observer and performs the first scan. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof MutationObserver !== "undefined") {
      this.observer = new MutationObserver(() => this.scheduleRefresh());
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
    this.removeAllShims();
    this.resolvers.clear();
    this.sources.clear();
    this.controller.clear();
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
    const scope = resolveActiveScope(this.doc);
    const nodes = this.collectRingNodes(scope);
    const items = this.assemble(nodes, scope.element);

    this.applyShims(items.shimTargets);
    this.resolvers = items.resolvers;
    this.sources = items.sources;
    this.controller.setItems(items.focusItems);
    this.scopeChain = this.computeScopeChain();

    // Drop the mutation records our own tabindex writes just queued — the DOM is
    // already reflected in this scan, so reacting to them would loop.
    this.observer?.takeRecords();
    this.onAfterAssemble?.();
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
    for (const element of scopeEl.querySelectorAll(`[${GROUP_ATTR}]`)) {
      if (element instanceof HTMLElement && isFocusVisible(element) && !isSkipped(element, scopeEl)) {
        groupElements.add(element);
        if (!elements.includes(element)) elements.push(element);
      }
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
    const ordered = elements
      .filter((element) => !skipElements.has(element))
      .filter((element) => !ownedByExplicitItem(element))
      .filter((element) => !isFocusDisabled(element) || groupElements.has(element))
      .sort(compareFocusables);

    return ordered
      .map((element) => {
        const registration = registrationByElement.get(element);
        const isGroup = groupElements.has(element);
        const groupAttr = isGroup ? element.getAttribute(GROUP_ATTR) : null;
        const id = registration?.descriptor.id || (groupAttr ? groupAttr : autoIdFor(element));
        const source = registration
          ? discoveredSet.has(element)
            ? "dom+explicit"
            : "explicit"
          : "dom";
        return { element, id, isGroup, source, registration };
      })
      .filter((node, _index, all) => {
        if (!node.isGroup) return true;
        // Keep a group only if it has ≥1 in-scope descendant ring node (else it is
        // empty chrome). A group element that is itself interactive falls through
        // to a leaf via the next pass (isGroup recomputed in assemble()).
        return all.some((other) => other !== node && node.element.contains(other.element));
      });
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

      focusItems.push({
        id: node.id,
        order: descriptor?.order ?? 0,
        // `group` now carries the human breadcrumb label (Objective 5 — `group`
        // given real meaning), falling back to the legacy free-text group field.
        group: descriptor?.label ?? descriptor?.group,
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
