/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * Where each tab page was left, so it opens there again. A page is rebuilt on every visit (keeping
 * pages mounted made the heavy ones slower to show), so the position is put back instead: the scroll
 * offset, and the height each card had, which a card that is not built yet reserves so the offset
 * lands on the same content.
 */

const SCROLL_CONTAINER = '[data-page-scroll-container="true"]';

type PagePositionRecord = { scrollTop: number; anchor: { key: string; offset: number } | null };

/** How long a reopened page keeps its top card in place while the cards above it are still being built. */
const SETTLE_MS = 3000;

const positions = new Map<number, PagePositionRecord>();
type CardHeight = { height: number; layout: string };
const cardHeights = new Map<string, CardHeight>();
const layoutKey = () =>
  `${window.innerWidth}:${window.innerHeight}:${document.documentElement.dataset.displayProfile ?? ""}:${document.documentElement.dataset.textScale ?? ""}`;
const discardNextRecord = new Set<number>();

const cardKey = (scope: string, id: string) => `${scope}:${id}`;

const cardsIn = (scroller: HTMLElement) => [
  ...scroller.querySelectorAll<HTMLElement>("[data-section-scope][data-section-id]"),
];

const keyOf = (card: HTMLElement) => `${card.dataset.sectionScope}:${card.dataset.sectionId}`;

const offsetWithin = (scroller: HTMLElement, card: HTMLElement) =>
  card.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

const topCard = (scroller: HTMLElement) => {
  const top = scroller.getBoundingClientRect().top;
  return cardsIn(scroller).find((card) => card.getBoundingClientRect().bottom > top) ?? null;
};

const alignAnchor = (scroller: HTMLElement, anchor: NonNullable<PagePositionRecord["anchor"]>) => {
  const card = cardsIn(scroller).find((candidate) => keyOf(candidate) === anchor.key);
  if (!card) return;
  const drift = offsetWithin(scroller, card) - anchor.offset;
  if (Math.abs(drift) >= 1) scroller.scrollTop += drift;
};

/*
 * Cards above the remembered position can still change height after it is restored: one that was
 * not built when the page was left, or rows filling in as data arrives. The top card is put back in
 * place each frame until the page settles, until the user scrolls or presses a key, or until the page
 * is scrolled by something else (the tour, a search result) while its content height stood still.
 */
const keepAnchorWhileSettling = (scroller: HTMLElement, anchor: NonNullable<PagePositionRecord["anchor"]>) => {
  const started = performance.now();
  let stopped = false;
  let frame: number | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    clearTimeout(expiry);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    scroller.removeEventListener("scroll", checkExternalScroll);
    for (const type of ["pointerdown", "wheel", "keydown", "touchstart"]) scroller.removeEventListener(type, stop);
  };
  for (const type of ["pointerdown", "wheel", "keydown", "touchstart"]) {
    scroller.addEventListener(type, stop, { passive: true });
  }
  let expectedScrollTop = scroller.scrollTop;
  let expectedScrollHeight = scroller.scrollHeight;
  const checkExternalScroll = () => {
    if (Math.abs(scroller.scrollTop - expectedScrollTop) >= 1 && scroller.scrollHeight === expectedScrollHeight) stop();
  };
  const step = () => {
    frame = null;
    if (stopped || !scroller.isConnected) return stop();
    const scrolledElsewhere =
      Math.abs(scroller.scrollTop - expectedScrollTop) >= 1 && scroller.scrollHeight === expectedScrollHeight;
    if (scrolledElsewhere) return stop();
    alignAnchor(scroller, anchor);
    expectedScrollTop = scroller.scrollTop;
    expectedScrollHeight = scroller.scrollHeight;
    if (performance.now() - started < SETTLE_MS) {
      if (!resizeObserver) frame = requestAnimationFrame(step);
    } else stop();
  };
  const schedule = () => {
    if (!stopped && frame === null) frame = requestAnimationFrame(step);
  };
  if (typeof ResizeObserver === "function") {
    // Keep the same anchor, but read geometry only when the page actually changes.
    // Polling a settled page every frame forced layout for three seconds on each return.
    resizeObserver = new ResizeObserver(schedule);
    const observed = new WeakSet<Element>();
    const observeCards = () => {
      for (const element of [scroller, ...cardsIn(scroller)]) {
        if (observed.has(element)) continue;
        observed.add(element);
        resizeObserver?.observe(element);
      }
    };
    observeCards();
    mutationObserver = new MutationObserver(() => {
      observeCards();
      schedule();
    });
    mutationObserver.observe(scroller, { childList: true, subtree: true });
    scroller.addEventListener("scroll", checkExternalScroll, { passive: true });
    expiry = setTimeout(stop, SETTLE_MS);
  }
  schedule();
};

export const rememberPagePosition = (pageIndex: number, slot: Element | null): void => {
  const scroller = slot?.querySelector<HTMLElement>(SCROLL_CONTAINER);
  if (discardNextRecord.delete(pageIndex) || !slot || !scroller) return;
  const card = topCard(scroller);
  positions.set(pageIndex, {
    scrollTop: scroller.scrollTop,
    anchor: card ? { key: keyOf(card), offset: offsetWithin(scroller, card) } : null,
  });
  for (const card of cardsIn(scroller)) {
    if (card.dataset.bodyMounted === "true")
      cardHeights.set(keyOf(card), { height: card.offsetHeight, layout: layoutKey() });
  }
};

/** The page opens at the top next time, including when the page now showing is torn down to reopen it. */
export const forgetPagePosition = (pageIndex: number): void => {
  positions.delete(pageIndex);
  discardNextRecord.add(pageIndex);
};

export const restorePagePosition = (pageIndex: number, slot: Element | null): void => {
  const position = positions.get(pageIndex);
  const scroller = slot?.querySelector<HTMLElement>(SCROLL_CONTAINER);
  if (!position || !scroller) return;
  scroller.scrollTop = position.scrollTop;
  if (!position.anchor) return;
  alignAnchor(scroller, position.anchor);
  keepAnchorWhileSettling(scroller, position.anchor);
};

export const rememberedCardHeight = (scope: string, id: string): number | undefined => {
  const cached = cardHeights.get(cardKey(scope, id));
  return cached?.layout === layoutKey() ? cached.height : undefined;
};

export const resetPagePositionsForTests = (): void => {
  positions.clear();
  cardHeights.clear();
  discardNextRecord.clear();
};
