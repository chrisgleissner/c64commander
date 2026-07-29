/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HvscStageSteps } from "@/pages/playFiles/components/HvscStageSteps";

const statusOf = (id: string) => screen.getByTestId(`hvsc-stage-steps-${id}`).getAttribute("data-status");

describe("HvscStageSteps", () => {
  it("names all four stages so the user can see what is left", () => {
    render(<HvscStageSteps state="DOWNLOADING" stage="download" />);

    for (const label of ["Download", "Unpack", "Find songs", "Song details"]) {
      expect(screen.getByText(label)).toBeVisible();
    }
  });

  it("marks the running stage and credits the finished ones", () => {
    render(<HvscStageSteps state="INGESTING" stage="sid_enumeration" />);

    expect(statusOf("download")).toBe("done");
    expect(statusOf("unpack")).toBe("done");
    expect(statusOf("scan")).toBe("active");
    expect(statusOf("details")).toBe("pending");
  });

  it("shows the running stage's own figure alongside its rate", () => {
    render(<HvscStageSteps state="DOWNLOADING" stage="download" stagePercent={42} detailLabel="13 MB/s" />);

    expect(screen.getByTestId("hvsc-stage-steps-detail")).toHaveTextContent("42% · 13 MB/s");
  });

  it("shows counts in preference to a percentage that would read 0%", () => {
    // Measured on the device: song details ran for minutes showing "0% · 15 items/s", because 128 of
    // 61,157 rounds to zero. The counts move from the first song.
    render(
      <HvscStageSteps
        state="INGESTING"
        stage="sid_metadata_hydration"
        stagePercent={0}
        stageDone={128}
        stageTotal={61_157}
        detailLabel="15 items/s"
      />,
    );

    expect(screen.getByTestId("hvsc-stage-steps-detail")).toHaveTextContent("128 / 61,157 · 15 items/s");
    expect(screen.getByTestId("hvsc-stage-steps-detail")).not.toHaveTextContent("0%");
    expect(statusOf("details")).toBe("active");
  });

  it("omits the detail line entirely when there is nothing to report", () => {
    render(<HvscStageSteps state="NOT_PRESENT" />);

    expect(screen.queryByTestId("hvsc-stage-steps-detail")).toBeNull();
  });

  it("shows the finished state plainly once the library is reachable", () => {
    // The bar it replaced hid itself at exactly this moment, so its 100% was never seen.
    render(<HvscStageSteps state="READY" />);

    for (const id of ["download", "unpack", "scan", "details"]) {
      expect(statusOf(id)).toBe("done");
    }
  });

  it("points at the stage that failed", () => {
    render(<HvscStageSteps state="ERROR" stage="archive_extraction" />);

    expect(statusOf("download")).toBe("done");
    expect(statusOf("unpack")).toBe("failed");
    expect(statusOf("scan")).toBe("pending");
  });
});
