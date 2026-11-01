/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { AppBar } from "@/components/AppBar";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { usePrimaryPageShellClassName } from "@/components/layout/AppChromeContext";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { PageContainer, PageStack } from "@/components/layout/PageContainer";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { getDocsExternalResourceLinks } from "@/lib/docs/externalResources";
import { buildGuideChapters } from "@/lib/docs/guide/chapters";
import { useAppMode } from "@/lib/appMode/appModeStore";
import type { GuideChapter } from "@/lib/docs/guide/types";
import { variant } from "@/generated/variant";
import { TourRestartCard } from "@/components/tour/TourRestartCard";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import { DOCS_SCOPE, DocsContents } from "@/pages/docs/DocsContents";
import { GuideChapterBody } from "@/pages/docs/GuideChapterBody";

function DocChapterCard({ chapter }: { chapter: GuideChapter }) {
  return (
    <CollapsibleSection
      scope={DOCS_SCOPE}
      id={chapter.id}
      title={chapter.title}
      icon={chapter.icon}
      className="docs-chapter-anchor"
      testId={`docs-card-${chapter.id}`}
      toggleTestId={`docs-toggle-${chapter.id}`}
      bodyId={`docs-section-${chapter.id}`}
      onToggleClick={wrapUserEvent(() => {}, "toggle", "DocsSection", { title: chapter.title }, "DocsHeader")}
    >
      <GuideChapterBody chapter={chapter} />
    </CollapsibleSection>
  );
}

export default function DocsPage() {
  const pageShellClassName = usePrimaryPageShellClassName();
  const { profile } = useDisplayProfile();
  const { flags } = useFeatureFlags();
  // Widened to `string`: `variant.id` is generated as a single literal per build, so comparing it
  // against the other variant's literal would not compile on whichever variant was generated.
  const variantId: string = variant.id;
  const appMode = useAppMode();
  const chapters = useMemo(() => buildGuideChapters({ variantId, flags, appMode }), [variantId, flags, appMode]);
  const externalResourceLinks = getDocsExternalResourceLinks();
  return (
    <div className={pageShellClassName}>
      <AppBar title="Docs" />

      {/* `py-6` overrides `.page-shell`'s own profile padding and `gap-4` fixes the card
          gap at 16px, so this is the one page that opts out of the profile spacing. Both are
          kept where the page was tuned; on compact the profile's padding applies again. */}
      <PageContainer className={profile === "compact" ? undefined : "py-6"}>
        <PageStack className={profile === "compact" ? "gap-2" : "gap-4"}>
          {/* The contents come first: someone on Docs is looking for a chapter. The tour sits below
            them and stays restartable at any time (section 8's D10). */}
          <DocsContents chapters={chapters} />

          <TourRestartCard />

          {chapters.map((chapter, index) => (
            <motion.div
              key={chapter.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index, 8) * 0.05 }}
            >
              <DocChapterCard chapter={chapter} />
            </motion.div>
          ))}

          {/* External links. The keypad edition has none: its phone cannot open them. */}
          {externalResourceLinks.length > 0 && (
            <CollapsibleSection
              scope="docs"
              id="external-resources"
              title="External resources"
              summary={`Official device manuals and API references used by ${variant.displayName}.`}
              icon={ExternalLink}
              testId="docs-external-resources"
              // Closed on a first visit: these are references to other people's documentation, read
              // once if at all, and the page's own chapters are what a reader came for.
              defaultOpen={false}
            >
              <div className="space-y-2">
                {externalResourceLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center gap-2 text-sm text-primary hover:underline"
                    data-testid={link.testId}
                  >
                    <ExternalLink className="h-4 w-4" />
                    {link.label}
                  </a>
                ))}
              </div>
            </CollapsibleSection>
          )}
        </PageStack>
      </PageContainer>
    </div>
  );
}
