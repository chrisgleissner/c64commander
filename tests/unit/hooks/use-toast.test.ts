/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { toast } from "@/hooks/use-toast";
import { saveNotificationVisibility } from "@/lib/config/appSettings";

beforeEach(() => {
  localStorage.clear();
  // Default visibility is errors-only
  saveNotificationVisibility("errors-only");
});

describe("toast() visibility filtering", () => {
  it("dispatches destructive toast when visibility is errors-only", () => {
    const { id } = toast({ title: "Error occurred", variant: "destructive" });
    expect(id).not.toBe("");
  });

  it("suppresses default toast when visibility is errors-only", () => {
    const { id } = toast({ title: "Success" });
    expect(id).toBe("");
  });

  it("suppresses explicit default-variant toast when visibility is errors-only", () => {
    const { id } = toast({ title: "Info", variant: "default" });
    expect(id).toBe("");
  });

  it("dispatches default toast when visibility is all", () => {
    saveNotificationVisibility("all");
    const { id } = toast({ title: "Success" });
    expect(id).not.toBe("");
  });

  it("dispatches destructive toast when visibility is all", () => {
    saveNotificationVisibility("all");
    const { id } = toast({ title: "Error", variant: "destructive" });
    expect(id).not.toBe("");
  });

  it("suppressed toast returns no-op dismiss and update", () => {
    const result = toast({ title: "Success" });
    // No-op functions must be callable without throwing
    expect(() => result.dismiss()).not.toThrow();
    expect(() => result.update({ id: "", title: "x" })).not.toThrow();
  });
});
