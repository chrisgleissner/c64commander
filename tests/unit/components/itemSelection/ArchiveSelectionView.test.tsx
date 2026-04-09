/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArchiveSelectionView, type ArchiveSelectionViewProps } from "@/components/itemSelection/ArchiveSelectionView";
import type { ArchiveSearchResult } from "@/lib/archive/types";
import type { OnlineArchiveState } from "@/hooks/useOnlineArchive";

vi.mock("@/hooks/useOnlineArchive", () => ({
  useOnlineArchive: vi.fn(),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <select disabled={disabled} value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
}));

const { useOnlineArchive } = await import("@/hooks/useOnlineArchive");
const { reportUserError } = await import("@/lib/uiErrors");

const defaultResolvedConfig = {
  id: "archive-commoserve",
  name: "CommoServe",
  baseUrl: "http://commoserve.files.commodore.net",
  host: "commoserve.files.commodore.net",
  headers: { "Client-Id": "Commodore", "User-Agent": "Assembly Query" },
  enabled: true,
  clientId: "Commodore",
  userAgent: "Assembly Query",
};

const baseReturn = {
  presets: [
    { type: "category", description: "Category", values: [{ aqlKey: "demos", name: "Demos" }] },
    { type: "date", description: "Date", values: [{ aqlKey: "2024", name: "2024" }] },
    { type: "type", description: "Type", values: [{ aqlKey: "d64", name: "d64" }] },
    { type: "sort", description: "Sort by", values: [{ aqlKey: "name", name: "Name" }] },
    { type: "order", description: "Order", values: [{ aqlKey: "asc", name: "Ascending" }] },
  ],
  presetsLoading: false,
  resolvedConfig: defaultResolvedConfig,
  state: { phase: "idle" } as OnlineArchiveState,
  clearError: vi.fn(),
  search: vi.fn(),
};

const defaultConfig = {
  id: "archive-commoserve",
  name: "CommoServe",
  baseUrl: "http://commoserve.files.commodore.net",
  headers: { "Client-Id": "Commodore", "User-Agent": "Assembly Query" },
  enabled: true,
};

const makeResult = (overrides: Partial<ArchiveSearchResult> = {}): ArchiveSearchResult => ({
  id: "100",
  category: 40,
  name: "Demo Reel",
  group: "Creators Inc",
  year: 2024,
  ...overrides,
});

const renderView = (props: Partial<ArchiveSelectionViewProps> = {}, state: OnlineArchiveState = { phase: "idle" }) => {
  vi.mocked(useOnlineArchive).mockReturnValue({ ...baseReturn, state } as never);
  const onToggleSelect = vi.fn();
  const onSelectAll = vi.fn();
  const onClearSelection = vi.fn();
  render(
    <ArchiveSelectionView
      config={defaultConfig}
      selection={new Map()}
      onToggleSelect={onToggleSelect}
      onSelectAll={onSelectAll}
      onClearSelection={onClearSelection}
      {...props}
    />,
  );
  return { onToggleSelect, onSelectAll, onClearSelection };
};

describe("ArchiveSelectionView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the archive config info (name, host)", () => {
    renderView();
    expect(screen.getByTestId("archive-selection-config")).toHaveTextContent("CommoServe");
    expect(screen.getByTestId("archive-selection-config")).toHaveTextContent("commoserve.files.commodore.net");
  });

  it("does not show override host notice when host matches default", () => {
    renderView();
    expect(screen.queryByText(/Override host active/i)).toBeNull();
  });

  it("shows override host notice when config host differs from default", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      resolvedConfig: {
        ...defaultResolvedConfig,
        host: "custom.example.com",
        baseUrl: "http://custom.example.com",
      },
    } as never);
    render(
      <ArchiveSelectionView
        config={{ ...defaultConfig, baseUrl: "http://custom.example.com" }}
        selection={new Map()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByText(/Override host active/i)).toBeInTheDocument();
  });

  it("shows placeholder text when form is empty and no query preview", () => {
    renderView();
    expect(screen.getByText("Enter at least one search term.")).toBeInTheDocument();
    expect(screen.queryByTestId("archive-query-preview")).toBeNull();
  });

  it("shows query preview when name field is not empty", () => {
    renderView();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "joyride" } });
    expect(screen.getByTestId("archive-query-preview")).toHaveTextContent('(name:"joyride")');
  });

  it("search button is disabled when form is empty", () => {
    renderView();
    expect(screen.getByTestId("archive-search-button")).toBeDisabled();
  });

  it("search button is disabled when presetsLoading is true", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      presetsLoading: true,
    } as never);
    render(
      <ArchiveSelectionView
        config={defaultConfig}
        selection={new Map()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "test" } });
    expect(screen.getByTestId("archive-search-button")).toBeDisabled();
  });

  it("search button is disabled when phase is searching", () => {
    renderView({}, { phase: "searching" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "test" } });
    expect(screen.getByTestId("archive-search-button")).toBeDisabled();
  });

  it("search button shows spinner when phase is searching", () => {
    renderView({}, { phase: "searching" });
    expect(screen.getByTestId("archive-search-button").querySelector("svg")).toBeInTheDocument();
  });

  it("calls search with form params when search button clicked", async () => {
    const search = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useOnlineArchive).mockReturnValue({ ...baseReturn, search } as never);
    render(
      <ArchiveSelectionView
        config={defaultConfig}
        selection={new Map()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "rambo" } });
    fireEvent.click(screen.getByTestId("archive-search-button"));
    await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ name: "rambo" })));
  });

  it("shows idle empty state message when no results", () => {
    renderView({}, { phase: "idle" });
    expect(screen.getByText("Search results appear here.")).toBeInTheDocument();
  });

  it("shows no results found message when results are empty after search", () => {
    renderView({}, { phase: "results", params: { name: "xyz" }, results: [] });
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  it("renders result rows with name, group, and year", () => {
    const result = makeResult();
    renderView({}, { phase: "results", params: {}, results: [result] });
    expect(screen.getByTestId("archive-result-row")).toBeInTheDocument();
    const row = screen.getByTestId("archive-result-row");
    expect(within(row).getByText("Demo Reel")).toBeInTheDocument();
    expect(within(row).getByText(/Creators Inc/)).toBeInTheDocument();
    expect(within(row).getByText(/2024/)).toBeInTheDocument();
  });

  it('shows "Unknown group" when result.group is undefined', () => {
    const result = makeResult({ group: undefined });
    renderView({}, { phase: "results", params: {}, results: [result] });
    expect(screen.getByText(/Unknown group/)).toBeInTheDocument();
  });

  it('shows "Unknown year" when result.year is falsy', () => {
    const result = makeResult({ year: undefined });
    renderView({}, { phase: "results", params: {}, results: [result] });
    expect(screen.getByText(/Unknown year/)).toBeInTheDocument();
  });

  it("shows select all button when results exist", () => {
    const result = makeResult();
    renderView({}, { phase: "results", params: {}, results: [result] });
    expect(screen.getByTestId("archive-select-all")).toBeInTheDocument();
  });

  it("does not show clear selection button when selection is empty", () => {
    const result = makeResult();
    renderView({ selection: new Map() }, { phase: "results", params: {}, results: [result] });
    expect(screen.queryByTestId("archive-clear-selection")).toBeNull();
  });

  it("shows clear selection button when selection.size > 0", () => {
    const result = makeResult();
    const key = `${result.id}:${result.category}`;
    renderView({ selection: new Map([[key, result]]) }, { phase: "results", params: {}, results: [result] });
    expect(screen.getByTestId("archive-clear-selection")).toBeInTheDocument();
  });

  it("calls onSelectAll with result rows when select all is clicked", () => {
    const result = makeResult();
    const { onSelectAll } = renderView({}, { phase: "results", params: {}, results: [result] });
    fireEvent.click(screen.getByTestId("archive-select-all"));
    expect(onSelectAll).toHaveBeenCalledWith([result]);
  });

  it("calls onClearSelection when clear selection is clicked", () => {
    const result = makeResult();
    const key = `${result.id}:${result.category}`;
    const { onClearSelection } = renderView(
      { selection: new Map([[key, result]]) },
      { phase: "results", params: {}, results: [result] },
    );
    fireEvent.click(screen.getByTestId("archive-clear-selection"));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("calls onToggleSelect when a result checkbox is clicked", () => {
    const result = makeResult({ name: "Unique Title" });
    const { onToggleSelect } = renderView({}, { phase: "results", params: {}, results: [result] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Unique Title" }));
    expect(onToggleSelect).toHaveBeenCalledWith(result);
  });

  it("calls reportUserError and clearError when phase is error", async () => {
    const clearError = vi.fn();
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      clearError,
      state: { phase: "error", message: "Connection refused", recoverableState: null },
    } as never);
    render(
      <ArchiveSelectionView
        config={defaultConfig}
        selection={new Map()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({ description: "Connection refused" }));
      expect(clearError).toHaveBeenCalledTimes(1);
    });
  });

  it("uses aqlKey as display label when preset value has no name", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      presets: [
        { type: "category", description: "Category", values: [{ aqlKey: "apps" }] },
        ...baseReturn.presets.filter((p) => p.type !== "category"),
      ],
    } as never);
    render(
      <ArchiveSelectionView
        config={defaultConfig}
        selection={new Map()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: "apps" })).toBeInTheDocument();
  });

  it("select field is disabled when preset is unavailable for that type", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      presets: baseReturn.presets.filter((p) => p.type !== "sort"),
    } as never);
    render(
      <ArchiveSelectionView
        config={defaultConfig}
        selection={new Map()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    // SELECT_FIELDS order: category(0), date(1), type(2), sort(3), order(4)
    // Sort preset was removed, so selects[3] (sort) should be disabled
    const selects = screen.getAllByRole("combobox");
    expect(selects[3]).toBeDisabled();
  });

  it("maps select value to empty string when __any__ is chosen", async () => {
    const search = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useOnlineArchive).mockReturnValue({ ...baseReturn, search } as never);
    render(
      <ArchiveSelectionView
        config={defaultConfig}
        selection={new Map()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "demos" } });
    fireEvent.change(selects[0], { target: { value: "__any__" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "test" } });
    fireEvent.click(screen.getByTestId("archive-search-button"));
    await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ category: "", name: "test" })));
  });
});
