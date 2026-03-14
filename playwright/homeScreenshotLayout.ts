export type HomeSectionBounds = {
  slug: string;
  top: number;
  bottom: number;
};

export type HomeScreenshotSlice = {
  slug: string;
  scrollTop: number;
  sectionSlugs: string[];
};

type PlanHomeScreenshotSlicesOptions = {
  sections: HomeSectionBounds[];
  viewportHeight: number;
  topInset: number;
  bottomInset: number;
  maxScroll: number;
  topGap?: number;
  bottomGap?: number;
  overlap?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const planHomeScreenshotSlices = ({
  sections,
  viewportHeight,
  topInset,
  bottomInset,
  maxScroll,
  topGap = 12,
  bottomGap = 12,
  overlap = 24,
}: PlanHomeScreenshotSlicesOptions): HomeScreenshotSlice[] => {
  const orderedSections = sections
    .filter(
      (section) => Number.isFinite(section.top) && Number.isFinite(section.bottom) && section.bottom > section.top,
    )
    .sort((left, right) => left.top - right.top);

  if (orderedSections.length === 0) return [];

  const visibleTopInset = topInset + topGap;
  const visibleBottomInset = bottomInset + bottomGap;
  const maxAllowedScroll = Math.max(0, maxScroll);
  const safeWindowHeight = viewportHeight - visibleTopInset - visibleBottomInset;
  if (safeWindowHeight <= 0) return [];

  const slices: HomeScreenshotSlice[] = [];
  const firstTop = orderedSections[0].top;
  const lastBottom = orderedSections[orderedSections.length - 1].bottom;
  const seenSlugs = new Map<string, number>();
  let nextVisibleTop = firstTop;

  while (true) {
    const scrollTop = clamp(nextVisibleTop - visibleTopInset, 0, maxAllowedScroll);
    const visibleStart = scrollTop + visibleTopInset;
    const visibleEnd = scrollTop + viewportHeight - visibleBottomInset;
    const sectionSlugs = orderedSections
      .filter((section) => section.bottom > visibleStart && section.top < visibleEnd)
      .map((section) => section.slug);

    if (sectionSlugs.length === 0) break;

    const baseSlug =
      sectionSlugs.length === 1 ? sectionSlugs[0] : `${sectionSlugs[0]}-to-${sectionSlugs[sectionSlugs.length - 1]}`;
    const nextCount = (seenSlugs.get(baseSlug) ?? 0) + 1;
    seenSlugs.set(baseSlug, nextCount);

    slices.push({
      slug: nextCount === 1 ? baseSlug : `${baseSlug}-part-${nextCount}`,
      scrollTop: Math.round(scrollTop),
      sectionSlugs,
    });

    if (visibleEnd >= lastBottom) break;

    const advancedTop = visibleStart + safeWindowHeight - overlap;
    if (advancedTop <= nextVisibleTop) break;
    nextVisibleTop = advancedTop;
  }

  return slices;
};
