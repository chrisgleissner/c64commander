/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LikedTunesList } from "@/pages/playFiles/components/LikedTunesList";
import { clearAllRankings, getRanking, setRanking } from "@/lib/sidRadio/rankingStore";
import { rebuildMd548PathIndex, resetMd548PathIndex } from "@/lib/sidRadio/md5PathIndex";

const COMMANDO = "aabbccddeeff00112233445566778899";
const ZOIDS = "112233445566778899aabbccddeeff00";
const REMOVED = "ffffffffffff00000000000000000000";

const SONGLENGTHS = [
  "; /MUSICIANS/H/Hubbard_Rob/Commando.sid",
  `${COMMANDO}=3:41`,
  "; /MUSICIANS/D/Daglish_Ben/Zoids.sid",
  `${ZOIDS}=2:10`,
].join("\n");

beforeEach(async () => {
  localStorage.clear();
  resetMd548PathIndex();
  await clearAllRankings();
  rebuildMd548PathIndex(SONGLENGTHS, { force: true });
});

describe("LikedTunesList", () => {
  it("shows an empty state when there are no likes", () => {
    render(<LikedTunesList onPlay={vi.fn()} />);
    expect(screen.getByTestId("liked-tunes")).toHaveTextContent("No liked tunes yet");
  });

  it("plays the finite list from the tapped tune via onPlay", async () => {
    await setRanking(COMMANDO, "like");
    await setRanking(ZOIDS, "like");
    const onPlay = vi.fn();
    render(<LikedTunesList onPlay={onPlay} />);
    const rows = screen.getAllByTestId("liked-tune-row");
    expect(rows).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId("liked-tune-play")[1]);
    expect(onPlay).toHaveBeenCalledTimes(1);
    const [items, startIndex] = onPlay.mock.calls[0];
    expect(items).toHaveLength(2);
    expect(items[startIndex].path).toBe("/MUSICIANS/D/Daglish_Ben/Zoids.sid");
  });

  it("un-liking removes the row and stops steering (clears the ranking)", async () => {
    await setRanking(COMMANDO, "like");
    render(<LikedTunesList onPlay={vi.fn()} />);
    expect(screen.getAllByTestId("liked-tune-row")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("liked-tune-unlike"));
    await waitFor(() => expect(getRanking(COMMANDO)).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("liked-tune-row")).toBeNull());
  });

  it("greys a tune not in the installed HVSC and disables playing it", async () => {
    await setRanking(REMOVED, "like");
    render(<LikedTunesList onPlay={vi.fn()} />);
    const row = screen.getByTestId("liked-tune-row");
    expect(row).toHaveTextContent("not in current HVSC");
    expect(screen.getByTestId("liked-tune-play")).toBeDisabled();
  });
});
