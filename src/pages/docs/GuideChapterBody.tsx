/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Fragment, type ReactNode } from "react";
import { READING_STOP_ATTR } from "@/lib/input/discovery";
import type { GuideBlock, GuideChapter, GuideText } from "@/lib/docs/guide/types";
import { cn } from "@/lib/utils";

const MARKUP = /(\*\*[^*]+\*\*|`[^`]+`)/g;
const LABEL = /^\*\*[^*]+\*\*$/;
const KEY = /^`[^`]+`$/;

export const renderGuideText = (text: GuideText): ReactNode =>
  text.split(MARKUP).map((part, index) => {
    if (LABEL.test(part)) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (KEY.test(part)) {
      return (
        <kbd key={index} className="rounded border border-border bg-muted px-1 font-mono">
          {part.slice(1, -1)}
        </kbd>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });

/**
 * Each paragraph, step and key is a stop for the keypad ring, so a chapter longer than the screen
 * can be read to its end with Down: the ring scrolls every stop into view. At 44 px or taller, a
 * stop is also a fair target for a tap.
 */
const readingStop = { tabIndex: 0, [READING_STOP_ATTR]: "true" } as const;
const STOP_CLASS = "min-h-11 rounded-md";

const BlockHeading = ({ text }: { text?: string }) =>
  text ? <h3 className="pt-1 text-sm font-semibold">{text}</h3> : null;

const GuideBlockView = ({ block, testId }: { block: GuideBlock; testId: string }) => {
  switch (block.kind) {
    case "text":
      return (
        <p {...readingStop} className={STOP_CLASS} data-testid={testId}>
          {renderGuideText(block.text)}
        </p>
      );
    case "tip":
      return (
        <p
          {...readingStop}
          className={cn(STOP_CLASS, "border-l-4 border-primary/60 bg-primary/5 px-3 py-2")}
          data-testid={testId}
        >
          {renderGuideText(block.text)}
        </p>
      );
    case "steps":
      return (
        <div className="space-y-1" data-testid={testId}>
          <BlockHeading text={block.heading} />
          <ol className="space-y-1">
            {block.items.map((item, index) => (
              <li key={index} {...readingStop} className={cn(STOP_CLASS, "flex gap-2")} data-guide-step="true">
                <span className="w-6 shrink-0 text-right font-semibold text-primary" aria-hidden>
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1">{renderGuideText(item)}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    case "keys":
      return (
        <div className="space-y-1" data-testid={testId}>
          <BlockHeading text={block.heading} />
          <dl className="space-y-1">
            {block.items.map((item, index) => (
              <div key={index} {...readingStop} className={STOP_CLASS} data-guide-key="true">
                <dt className="font-semibold">{renderGuideText(item.key)}</dt>
                <dd className="text-muted-foreground">{renderGuideText(item.action)}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
  }
};

export const GuideChapterBody = ({ chapter }: { chapter: GuideChapter }) => (
  <div className="space-y-2 text-sm" data-testid={`docs-chapter-body-${chapter.id}`}>
    {chapter.blocks.map((block, index) => (
      <GuideBlockView key={index} block={block} testId={`docs-chapter-${chapter.id}-block-${index}`} />
    ))}
  </div>
);
