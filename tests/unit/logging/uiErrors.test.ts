/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

import { toast } from "@/hooks/use-toast";
import { addErrorLog, addLog } from "@/lib/logging";
import { reportUserError } from "@/lib/uiErrors";

describe("reportUserError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs and shows a destructive toast", () => {
    const error = new Error("Boom");
    reportUserError({
      operation: "TEST_OP",
      title: "Failure",
      description: "Something went wrong",
      error,
      context: { extra: "context" },
    });

    expect(addErrorLog).toHaveBeenCalledWith(
      "TEST_OP: Failure",
      expect.objectContaining({
        operation: "TEST_OP",
        description: "Something went wrong",
        extra: "context",
      }),
    );

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Failure",
        description: "Something went wrong",
        variant: "destructive",
      }),
    );
  });

  it("uses error log with recoverableConnectivityIssue flag for connectivity errors", () => {
    reportUserError({
      operation: "HOME_ACTION",
      title: "Error",
      description: "Request timed out",
      error: new Error("Host unreachable"),
    });

    expect(addErrorLog).toHaveBeenCalledWith(
      "HOME_ACTION: Error",
      expect.objectContaining({ recoverableConnectivityIssue: true }),
    );
    expect(addLog).not.toHaveBeenCalledWith("warn", expect.anything(), expect.anything());
  });
});
