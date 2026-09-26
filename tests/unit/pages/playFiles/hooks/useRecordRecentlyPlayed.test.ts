/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { loadRecentlyPlayed } from "@/lib/sidRadio/recentlyPlayed";
import { useRecordRecentlyPlayed, type ItemCredits } from "@/pages/playFiles/hooks/useRecordRecentlyPlayed";
import type { PlaylistItem } from "@/pages/playFiles/types";

const tune = (id: string, path: string): PlaylistItem => ({
  id,
  request: { source: "hvsc", path },
  category: "sid",
  label: path.slice(path.lastIndexOf("/") + 1),
  path,
});

const TUNE_A = tune("a", "/MUSICIANS/A/Before.sid");
const TUNE_B = tune("b", "/MUSICIANS/B/Oh_No-Techno.sid");

type Props = { trackInstanceId: number; item: PlaylistItem | null; credits: ItemCredits };

const renderRecorder = (initial: Props) =>
  renderHook((props: Props) => useRecordRecentlyPlayed({ ...props, title: props.item?.label }), {
    initialProps: initial,
  });

const rowsByPath = () => Object.fromEntries(loadRecentlyPlayed().map((row) => [row.virtualPath, row.author]));

describe("useRecordRecentlyPlayed", () => {
  beforeEach(() => localStorage.clear());

  it("credits each of two consecutive tunes to its own composer when the credits arrive after the tune starts", () => {
    const { rerender } = renderRecorder({ trackInstanceId: 1, item: TUNE_A, credits: { itemId: null, author: null } });
    rerender({ trackInstanceId: 1, item: TUNE_A, credits: { itemId: "a", author: "Composer A" } });

    // B starts while the credits still hold A's header; they are reset and then read from B.
    rerender({ trackInstanceId: 2, item: TUNE_B, credits: { itemId: "a", author: "Composer A" } });
    rerender({ trackInstanceId: 2, item: TUNE_B, credits: { itemId: null, author: null } });
    rerender({ trackInstanceId: 2, item: TUNE_B, credits: { itemId: "b", author: "Composer B" } });

    expect(rowsByPath()).toEqual({ [TUNE_B.path]: "Composer B", [TUNE_A.path]: "Composer A" });
    expect(loadRecentlyPlayed().map((row) => row.virtualPath)).toEqual([TUNE_B.path, TUNE_A.path]);
  });

  it("updates the tune's existing row when its credits arrive, keeping when it was played", () => {
    const { rerender } = renderRecorder({ trackInstanceId: 1, item: TUNE_A, credits: { itemId: null, author: null } });
    const playedAt = loadRecentlyPlayed()[0].playedAt;
    rerender({ trackInstanceId: 1, item: TUNE_A, credits: { itemId: "a", author: "Composer A" } });

    expect(loadRecentlyPlayed()).toEqual([expect.objectContaining({ author: "Composer A", playedAt })]);
  });

  it("does not credit a tune with composer credits that arrive late for the tune before it", () => {
    const { rerender } = renderRecorder({ trackInstanceId: 1, item: TUNE_A, credits: { itemId: null, author: null } });
    rerender({ trackInstanceId: 2, item: TUNE_B, credits: { itemId: null, author: null } });
    rerender({ trackInstanceId: 2, item: TUNE_B, credits: { itemId: "a", author: "Composer A" } });

    expect(rowsByPath()).toEqual({ [TUNE_B.path]: null, [TUNE_A.path]: null });
  });

  it("records a repeat of the same tune with its known composer at the top", () => {
    const credits = { itemId: "a", author: "Composer A" };
    const { rerender } = renderRecorder({ trackInstanceId: 1, item: TUNE_A, credits });
    rerender({ trackInstanceId: 2, item: TUNE_B, credits: { itemId: "b", author: "Composer B" } });
    rerender({ trackInstanceId: 3, item: TUNE_A, credits });

    expect(loadRecentlyPlayed().map((row) => [row.virtualPath, row.author])).toEqual([
      [TUNE_A.path, "Composer A"],
      [TUNE_B.path, "Composer B"],
    ]);
  });
});

// The hook trusts only credits tagged with the item they were read from, so the page must tag them.
describe("PlayFilesPage recently-played wiring", () => {
  const pageSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../src/pages/PlayFilesPage.tsx"),
    "utf8",
  );

  it("records through the hook with credits tagged by the item whose SID header they came from", () => {
    expect(pageSource).toContain("credits: currentItemCredits,");
    expect(pageSource).toContain("itemId: currentItem.id,");
    expect(pageSource).not.toContain("saveRecentlyPlayed(");
  });
});
