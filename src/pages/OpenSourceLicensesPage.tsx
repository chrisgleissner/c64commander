/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Fragment, useEffect, useMemo, useState, type ReactElement } from "react";
import { externalLinksOpen } from "@/lib/docs/externalResources";
import { READING_STOP_ATTR } from "@/lib/input/discovery";
import { addErrorLog } from "@/lib/logging";
import { useNavigate } from "react-router-dom";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

const loadNoticeText = async (): Promise<string> => {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const markdownUrl = `${baseUrl}THIRD_PARTY_NOTICES.md`;
  const markdownResponse = await fetch(markdownUrl, { cache: "no-store" });
  if (!markdownResponse.ok) {
    throw new Error(`Failed to load third-party notices (${markdownResponse.status})`);
  }
  return markdownResponse.text();
};

const parseMarkdownBlocks = (source: string): MarkdownBlock[] => {
  const lines = source.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  const splitTableRow = (line: string) =>
    line
      .trim()
      .replace(/^\|\s*/, "")
      .replace(/\s*\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const isTableSeparator = (line: string) => {
    const cells = splitTableRow(line);
    if (cells.length === 0) return false;
    return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  };

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (line.startsWith("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = splitTableRow(lines[index]);
      const normalizedHeaders = headers.map((cell) => cell.toLowerCase());
      index += 2;

      const rows: string[][] = [];
      while (index < lines.length) {
        const tableLine = lines[index].trim();
        if (!tableLine.startsWith("|")) break;
        if (isTableSeparator(tableLine)) {
          index += 1;
          continue;
        }

        const rowCells = splitTableRow(tableLine);
        rows.push(normalizedHeaders.map((_, cellIndex) => rowCells[cellIndex] ?? "-"));

        index += 1;
      }

      if (rows.length > 0) {
        blocks.push({ type: "table", headers, rows });
      }
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length) {
        const listLine = lines[index].trim();
        if (!listLine.startsWith("- ")) break;

        let item = listLine.slice(2).trim();
        index += 1;

        while (index < lines.length) {
          const continuationLine = lines[index];
          if (!continuationLine.trim()) break;
          if (!/^\s{2,}\S/.test(continuationLine)) break;
          item += `\n${continuationLine.trim()}`;
          index += 1;
        }

        items.push(item);
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const paragraphLine = lines[index].trim();
      if (!paragraphLine) break;
      if (/^(#{1,6})\s+/.test(paragraphLine)) break;
      if (paragraphLine.startsWith("- ")) break;
      paragraphLines.push(paragraphLine);
      index += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
      continue;
    }

    index += 1;
  }

  return blocks;
};

/** The file's own title and its note on how it is generated are for the repository, not the reader. */
const isReaderContent = (block: MarkdownBlock): boolean =>
  !(block.type === "heading" && block.level === 1) &&
  !(block.type === "paragraph" && block.text.startsWith("This file is generated"));

const renderTextWithBreaks = (text: string, keyPrefix: string) => {
  const lines = text.split("\n");
  return lines.flatMap((line, lineIndex) => {
    if (lineIndex === 0) return [<Fragment key={`${keyPrefix}-line-${lineIndex}`}>{line}</Fragment>];
    return [
      <br key={`${keyPrefix}-br-${lineIndex}`} />,
      <Fragment key={`${keyPrefix}-line-${lineIndex}`}>{line}</Fragment>,
    ];
  });
};

/** A link someone taps or selects on its own, so it gets the 44 px target. */
const STANDALONE_LINK_CLASS = "inline-flex min-h-11 min-w-11 items-center break-all text-primary underline";
const INLINE_LINK_CLASS = "break-all text-primary underline";

const renderInlineText = (value: string, linkClassName = INLINE_LINK_CLASS) => {
  const tokenRegex = /(`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const nodes: ReactElement[] = [];
  let cursor = 0;
  let keyIndex = 0;

  for (const match of value.matchAll(tokenRegex)) {
    const token = match[0];
    const start = match.index ?? 0;

    if (start > cursor) {
      const plainText = value.slice(cursor, start);
      nodes.push(<Fragment key={`plain-${keyIndex}`}>{renderTextWithBreaks(plainText, `plain-${keyIndex}`)}</Fragment>);
      keyIndex += 1;
    }

    const codeMatch = token.match(/^`([^`]+)`$/);
    if (codeMatch) {
      nodes.push(
        <code
          key={`code-${keyIndex}`}
          className="break-all whitespace-pre-wrap rounded-sm bg-muted px-1 py-0.5 text-[0.85em]"
        >
          {codeMatch[1]}
        </code>,
      );
      keyIndex += 1;
      cursor = start + token.length;
      continue;
    }

    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch && !externalLinksOpen()) {
      nodes.push(<Fragment key={`link-${keyIndex}`}>{linkMatch[1]}</Fragment>);
      keyIndex += 1;
      cursor = start + token.length;
      continue;
    }
    if (linkMatch) {
      nodes.push(
        <a
          key={`link-${keyIndex}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClassName}
        >
          {linkMatch[1]}
        </a>,
      );
      keyIndex += 1;
      cursor = start + token.length;
      continue;
    }

    nodes.push(<Fragment key={`fallback-${keyIndex}`}>{renderTextWithBreaks(token, `fallback-${keyIndex}`)}</Fragment>);
    keyIndex += 1;
    cursor = start + token.length;
  }

  if (cursor < value.length) {
    nodes.push(
      <Fragment key={`tail-${keyIndex}`}>{renderTextWithBreaks(value.slice(cursor), `tail-${keyIndex}`)}</Fragment>,
    );
  }

  return nodes;
};

const readingStopProps = () => (externalLinksOpen() ? {} : ({ tabIndex: 0, [READING_STOP_ATTR]: "true" } as const));

export default function OpenSourceLicensesPage() {
  const navigate = useNavigate();
  const [noticeText, setNoticeText] = useState<string>("Loading open source licenses...");
  const [hasError, setHasError] = useState(false);
  const blocks = useMemo(
    () => (hasError ? [] : parseMarkdownBlocks(noticeText).filter(isReaderContent)),
    [noticeText, hasError],
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const text = await loadNoticeText();
        if (cancelled) return;
        setNoticeText(text);
        setHasError(false);
      } catch (error) {
        if (cancelled) return;
        const message = (error as Error).message;
        setNoticeText(`Unable to load open source licenses. ${message}`);
        setHasError(true);
        addErrorLog("Failed to load third-party notices", {
          error: message,
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppSheet
      open
      onOpenChange={(open) => {
        if (!open) navigate("/settings");
      }}
    >
      <AppSheetContent
        className="overflow-hidden p-0"
        data-testid="open-source-licenses-overlay"
        closeTestId="open-source-licenses-close"
      >
        <AppSheetHeader>
          <AppSheetTitle>Open source licenses</AppSheetTitle>
          <AppSheetDescription>The open source software this app uses, and the license of each.</AppSheetDescription>
        </AppSheetHeader>
        <AppSheetBody data-testid="open-source-licenses-scroll" className="overflow-x-hidden">
          <div className={`min-w-0 space-y-4 p-4 sm:p-6 ${hasError ? "text-destructive" : "text-foreground"}`}>
            {hasError ? (
              <p className="break-words text-sm">{noticeText}</p>
            ) : (
              blocks.map((block, blockIndex) => {
                if (block.type === "heading") {
                  if (block.level === 2) {
                    return (
                      <h3 key={`h-${blockIndex}`} className="break-words pt-2 text-xl font-semibold">
                        {block.text}
                      </h3>
                    );
                  }
                  return (
                    <h4 key={`h-${blockIndex}`} className="break-words text-lg font-medium">
                      {block.text}
                    </h4>
                  );
                }

                if (block.type === "paragraph") {
                  return (
                    <p key={`p-${blockIndex}`} className="break-words text-sm leading-6" {...readingStopProps()}>
                      {renderInlineText(block.text)}
                    </p>
                  );
                }

                if (block.type === "list") {
                  return (
                    <ul
                      key={`l-${blockIndex}`}
                      className="list-disc space-y-2 pl-5 text-sm leading-6"
                      {...readingStopProps()}
                    >
                      {block.items.map((item, itemIndex) => (
                        <li key={`li-${itemIndex}`} className="min-w-0 break-words">
                          {renderInlineText(item)}
                        </li>
                      ))}
                    </ul>
                  );
                }

                if (block.type === "table") {
                  const normalizedHeaders = block.headers.map((header) => header.trim().toLowerCase());
                  const isDependencyTable =
                    normalizedHeaders.includes("ecosystem") &&
                    normalizedHeaders.includes("package") &&
                    normalizedHeaders.includes("version") &&
                    normalizedHeaders.includes("license") &&
                    (normalizedHeaders.includes("source") || normalizedHeaders.includes("source url"));

                  if (isDependencyTable) {
                    const getCell = (row: string[], header: string) => {
                      const index = normalizedHeaders.indexOf(header);
                      return index >= 0 ? (row[index] ?? "-") : "-";
                    };

                    return (
                      <div
                        key={`t-${blockIndex}`}
                        data-testid="open-source-licenses-dependency-table"
                        className="space-y-3"
                      >
                        {block.rows.map((row, rowIndex) => {
                          const ecosystem = getCell(row, "ecosystem");
                          const packageName = getCell(row, "package");
                          const version = getCell(row, "version");
                          const license = getCell(row, "license");
                          const source =
                            getCell(row, "source") !== "-" ? getCell(row, "source") : getCell(row, "source url");

                          return (
                            <article
                              key={`t-${blockIndex}-row-${rowIndex}`}
                              data-testid="open-source-license-card"
                              {...readingStopProps()}
                              className="rounded-panel border border-border/70 bg-muted/20 p-4 [contain-intrinsic-size:180px] [content-visibility:auto]"
                            >
                              <div className="flex flex-wrap items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <h4 className="break-words text-base font-semibold">
                                    {renderInlineText(packageName)}
                                  </h4>
                                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                    {renderInlineText(ecosystem)}
                                  </p>
                                </div>
                                {version && version !== "-" ? (
                                  <span className="rounded-full border border-border/70 px-2 py-1 text-xs font-medium text-muted-foreground">
                                    {renderInlineText(version)}
                                  </span>
                                ) : null}
                              </div>
                              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[auto,1fr]">
                                <dt className="font-medium text-muted-foreground">License</dt>
                                <dd className="min-w-0 break-words">
                                  {renderInlineText(license, STANDALONE_LINK_CLASS)}
                                </dd>
                                <dt className="font-medium text-muted-foreground">Source</dt>
                                <dd className="min-w-0 break-words">
                                  {renderInlineText(source, STANDALONE_LINK_CLASS)}
                                </dd>
                              </dl>
                            </article>
                          );
                        })}
                      </div>
                    );
                  }

                  return (
                    <div key={`t-${blockIndex}`} className="overflow-x-auto rounded-panel border border-border/70">
                      <table className="min-w-full border-collapse text-sm">
                        <thead className="bg-muted/40 text-left">
                          <tr>
                            {block.headers.map((header, headerIndex) => (
                              <th key={`th-${headerIndex}`} className="px-3 py-2 font-medium text-foreground">
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {block.rows.map((row, rowIndex) => (
                            <tr key={`tr-${rowIndex}`} className="border-t border-border/70 align-top">
                              {row.map((cell, cellIndex) => (
                                <td key={`td-${rowIndex}-${cellIndex}`} className="px-3 py-2 break-words">
                                  {renderInlineText(cell)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }

                return null;
              })
            )}
          </div>
        </AppSheetBody>
      </AppSheetContent>
    </AppSheet>
  );
}
