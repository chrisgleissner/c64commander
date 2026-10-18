/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/docs/externalResources", () => ({ externalLinksOpen: () => false }));

import OpenSourceLicensesPage from "@/pages/OpenSourceLicensesPage";

const NOTICES = [
  "# Third-Party Notices",
  "",
  "Summary: test notices.",
  "",
  "| Ecosystem | Package | Version | License | Source URL |",
  "| --- | --- | --- | --- | --- |",
  "| NPM | left-pad | 1.3.0 | [MIT](https://spdx.org/licenses/MIT.html) | [https://registry.npmjs.org/left-pad](https://registry.npmjs.org/left-pad) |",
].join("\n");

describe("OpenSourceLicensesPage on a phone that cannot open links", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response(NOTICES));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("shows the license name and source address as text and renders no anchor", async () => {
    render(
      <MemoryRouter initialEntries={["/settings/open-source-licenses"]}>
        <Routes>
          <Route path="/settings/open-source-licenses" element={<OpenSourceLicensesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Summary: test notices.");

    expect(screen.getAllByText(/MIT/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/registry\.npmjs\.org\/left-pad/).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('a[href^="http"]')).toHaveLength(0);
  });

  it("makes each license card a reading stop, so the keypad ring can scroll through the list", async () => {
    render(
      <MemoryRouter initialEntries={["/settings/open-source-licenses"]}>
        <Routes>
          <Route path="/settings/open-source-licenses" element={<OpenSourceLicensesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const card = await screen.findByTestId("open-source-license-card");

    expect(card).toHaveAttribute("data-key-nav-reading", "true");
    expect(card).toHaveAttribute("tabindex", "0");
  });
});
