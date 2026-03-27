/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { addErrorLog } from "@/lib/logging";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

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
      const headerCells = splitTableRow(lines[index]).map((cell) => cell.toLowerCase());
      index += 2;

      const items: string[] = [];
      while (index < lines.length) {
        const tableLine = lines[index].trim();
        if (!tableLine.startsWith("|")) break;
        if (isTableSeparator(tableLine)) {
          index += 1;
          continue;
        }

        const rowCells = splitTableRow(tableLine);
        const rowByHeader = new Map<string, string>();
        for (let i = 0; i < headerCells.length; i += 1) {
          rowByHeader.set(headerCells[i], rowCells[i] ?? "-");
        }

        const ecosystem = rowByHeader.get("ecosystem") ?? "-";
        const packageName = rowByHeader.get("package") ?? "-";
        const version = rowByHeader.get("version") ?? "-";
        const license = rowByHeader.get("license") ?? "-";
        const source = rowByHeader.get("source") ?? rowByHeader.get("source url") ?? "-";

        const firstLine = [ecosystem, packageName, version, license].filter((part) => part && part !== "-").join(" ");
        const secondLine = `Source: ${source || "-"}`;
        items.push(`${firstLine}\n${secondLine}`);

        index += 1;
      }

      if (items.length > 0) {
        blocks.push({ type: "list", items });
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

const renderInlineText = (value: string) => {
  const tokenRegex = /(`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const nodes: JSX.Element[] = [];
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
        <code key={`code-${keyIndex}`} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {codeMatch[1]}
        </code>,
      );
      keyIndex += 1;
      cursor = start + token.length;
      continue;
    }

    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      nodes.push(
        <a
          key={`link-${keyIndex}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-primary underline"
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

export default function OpenSourceLicensesPage() {
  const navigate = useNavigate();
  const [noticeText, setNoticeText] = useState<string>("Loading open source licenses...");
  const [hasError, setHasError] = useState(false);

  const blocks = useMemo(() => parseMarkdownBlocks(noticeText), [noticeText]);

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
    <div className="fixed inset-0 z-50 bg-background/84 backdrop-blur-sm supports-[backdrop-filter]:bg-background/72">
      <div className="mx-auto flex h-full max-w-6xl flex-col px-4 py-4 sm:px-6">
        <div className="mb-3 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">Open Source Licenses</h1>
            <p className="text-sm text-muted-foreground">Rendered from bundled `THIRD_PARTY_NOTICES.md`.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} aria-label="Close licenses overlay">
            <span className="text-lg leading-none">×</span>
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
          <ScrollArea className="h-full">
            <div className={`space-y-4 p-4 sm:p-6 ${hasError ? "text-destructive" : "text-foreground"}`}>
              {hasError ? (
                <p className="text-sm">{noticeText}</p>
              ) : (
                blocks.map((block, blockIndex) => {
                  if (block.type === "heading") {
                    if (block.level === 1) {
                      return (
                        <h2 key={`h-${blockIndex}`} className="text-2xl font-semibold tracking-tight">
                          {block.text}
                        </h2>
                      );
                    }
                    if (block.level === 2) {
                      return (
                        <h3 key={`h-${blockIndex}`} className="pt-2 text-xl font-semibold">
                          {block.text}
                        </h3>
                      );
                    }
                    return (
                      <h4 key={`h-${blockIndex}`} className="text-lg font-medium">
                        {block.text}
                      </h4>
                    );
                  }

                  if (block.type === "paragraph") {
                    return (
                      <p key={`p-${blockIndex}`} className="text-sm leading-6">
                        {renderInlineText(block.text)}
                      </p>
                    );
                  }

                  if (block.type === "list") {
                    return (
                      <ul key={`l-${blockIndex}`} className="list-disc space-y-2 pl-5 text-sm leading-6">
                        {block.items.map((item, itemIndex) => (
                          <li key={`li-${itemIndex}`} className="break-words">
                            {renderInlineText(item)}
                          </li>
                        ))}
                      </ul>
                    );
                  }

                  return null;
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
