import { createBaseArchiveMock, type ArchiveMockFixtures } from "./baseArchiveMock";

const DEFAULT_FIXTURES: ArchiveMockFixtures = {
  presets: [
    { type: "category", description: "Category", values: [{ aqlKey: "games", name: "Games" }] },
    { type: "type", description: "Type", values: [{ aqlKey: "d64", name: "D64" }] },
    { type: "sort", description: "Sort", values: [{ aqlKey: "year", name: "Year" }] },
    { type: "order", description: "Order", values: [{ aqlKey: "desc", name: "Descending" }] },
    { type: "date", description: "Date", values: [{ aqlKey: "1987", name: "1987" }] },
  ],
  searchByQuery: {
    '(name:"wizball") & (category:games)': [
      { id: "200", category: 10, name: "Wizball", year: 1987, updated: "1987-10-01" },
    ],
  },
  entriesByResultKey: {
    "200:10": [{ path: "wizball.d64", id: 0, size: 174848, date: 560822400000 }],
  },
  binariesByEntryKey: {
    "200:10:0": new Uint8Array(174848),
  },
};

export const createAssembly64Mock = (fixtures: Partial<ArchiveMockFixtures> = {}) =>
  createBaseArchiveMock({
    fixtures: { ...DEFAULT_FIXTURES, ...fixtures },
    expectedClientId: "Ultimate",
    expectedUserAgent: "Assembly Query",
  });
