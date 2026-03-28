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

export type CanonicalHomeScreenshotSlice = {
  fileName: string;
  slice: HomeScreenshotSlice;
};

type CanonicalHomeScreenshotRequirement = {
  fileName: string;
  requiredSectionSlugs: string[];
  fallbackSectionSlugs?: string[];
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

const CANONICAL_HOME_SCREENSHOT_REQUIREMENTS: CanonicalHomeScreenshotRequirement[] = [
  {
    fileName: "01-system-info-to-cpu-ram.png",
    requiredSectionSlugs: ["system-info", "cpu-ram"],
  },
  {
    fileName: "02-quick-config-to-keyboard-light.png",
    requiredSectionSlugs: ["quick-config", "keyboard-light"],
  },
  {
    fileName: "03-quick-config-to-printers.png",
    requiredSectionSlugs: ["quick-config", "printers"],
    fallbackSectionSlugs: ["quick-config", "drives"],
  },
  {
    fileName: "04-printers-to-sid.png",
    requiredSectionSlugs: ["printers", "sid"],
  },
  {
    fileName: "05-sid-to-config.png",
    requiredSectionSlugs: ["sid", "config"],
    fallbackSectionSlugs: ["config"],
  },
];

export const selectCanonicalHomeScreenshotSlices = (slices: HomeScreenshotSlice[]): CanonicalHomeScreenshotSlice[] => {
  let minimumIndex = 0;

  return CANONICAL_HOME_SCREENSHOT_REQUIREMENTS.map((requirement) => {
    const remainingSlices = slices.slice(minimumIndex);
    const exactMatch = remainingSlices.find((candidate) =>
      requirement.requiredSectionSlugs.every((sectionSlug) => candidate.sectionSlugs.includes(sectionSlug)),
    );
    const fallbackMatch =
      exactMatch || !requirement.fallbackSectionSlugs
        ? null
        : remainingSlices.find((candidate) =>
            requirement.fallbackSectionSlugs!.every((sectionSlug) => candidate.sectionSlugs.includes(sectionSlug)),
          );
    const terminalSectionSlug = requirement.requiredSectionSlugs[requirement.requiredSectionSlugs.length - 1];
    const terminalMatch =
      exactMatch || fallbackMatch
        ? null
        : remainingSlices.find((candidate) => candidate.sectionSlugs.includes(terminalSectionSlug));
    const slice = exactMatch ?? fallbackMatch ?? terminalMatch;
    if (!slice) {
      throw new Error(
        `Missing canonical Home screenshot slice for ${requirement.fileName} (${requirement.requiredSectionSlugs.join(
          ", ",
        )})`,
      );
    }
    minimumIndex = slices.indexOf(slice) + 1;
    return {
      fileName: requirement.fileName,
      slice,
    };
  });
};
