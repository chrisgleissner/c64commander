/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ListOrdered } from "lucide-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { requestSectionOpen } from "@/lib/ui/collapsibleSectionStore";
import { waitForElement } from "@/lib/search/navigate";
import { addLog } from "@/lib/logging";
import type { GuideChapter } from "@/lib/docs/guide/types";

export const DOCS_SCOPE = "docs";

const chapterSelector = (id: string) => `[data-section-scope="${DOCS_SCOPE}"][data-section-id="${CSS.escape(id)}"]`;

/**
 * Opens a chapter, brings its header to the top of the page, and hands it the focus, so the keypad
 * ring continues from the chapter rather than from the contents list.
 */
export const jumpToChapter = async (id: string): Promise<boolean> => {
  requestSectionOpen(DOCS_SCOPE, id);
  const card = await waitForElement(chapterSelector(id));
  if (!card) {
    addLog("warn", "Docs contents could not find the chapter it links to", { chapterId: id });
    return false;
  }
  card.scrollIntoView({ block: "start", inline: "nearest" });
  card.querySelector<HTMLButtonElement>(`#docs-toggle-${CSS.escape(id)}`)?.focus({ preventScroll: true });
  return true;
};

export const DocsContents = ({ chapters }: { chapters: readonly GuideChapter[] }) => (
  <CollapsibleSection
    scope={DOCS_SCOPE}
    id="contents"
    title="Contents"
    icon={ListOrdered}
    testId="docs-card-contents"
    toggleTestId="docs-toggle-contents"
    bodyId="docs-section-contents"
    defaultOpen
  >
    <nav aria-label="Docs contents">
      <ul className="grid grid-cols-2 gap-2">
        {chapters.map((chapter) => (
          <li key={chapter.id} className="min-w-0">
            <button
              type="button"
              className="flex min-h-11 w-full items-center rounded-md border border-border px-2 py-1 text-left text-sm hover:bg-muted"
              data-testid={`docs-contents-link-${chapter.id}`}
              aria-label={chapter.title}
              onClick={() => void jumpToChapter(chapter.id)}
            >
              <span className="min-w-0 break-words">{chapter.navLabel}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  </CollapsibleSection>
);
