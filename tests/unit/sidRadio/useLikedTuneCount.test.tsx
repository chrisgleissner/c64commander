/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { useLikedTuneCount } from "@/lib/sidRadio/useLikedTuneCount";
import { clearAllRankings, setRanking, simulateRankingRestartForTests } from "@/lib/sidRadio/rankingStore";

const MD5_A = "0123456789abcdef0123456789abcdef";
const MD5_B = "fedcba9876543210fedcba9876543210";

beforeEach(async () => {
  localStorage.clear();
  await clearAllRankings();
});

describe("useLikedTuneCount", () => {
  it("reports the likes stored before the app was relaunched", async () => {
    await setRanking(MD5_A, "like");
    await setRanking(MD5_B, "like");
    await simulateRankingRestartForTests();

    const { result } = renderHook(() => useLikedTuneCount());

    // 0 until the durable store has been read; the point is that it does get read.
    await waitFor(() => expect(result.current).toBe(2));
  });

  it("follows a like added while it is mounted", async () => {
    const { result } = renderHook(() => useLikedTuneCount());
    await waitFor(() => expect(result.current).toBe(0));

    await act(async () => {
      await setRanking(MD5_A, "like");
    });

    expect(result.current).toBe(1);
  });

  it("does not count a rejection as a like", async () => {
    await setRanking(MD5_A, "notForMe");
    await simulateRankingRestartForTests();

    const { result } = renderHook(() => useLikedTuneCount());

    await waitFor(() => expect(result.current).toBe(0));
  });
});
