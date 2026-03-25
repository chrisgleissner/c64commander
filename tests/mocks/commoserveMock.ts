import { createBaseArchiveMock, type ArchiveMockFixtures } from "./baseArchiveMock";

const DEFAULT_FIXTURES: ArchiveMockFixtures = {
  presets: [
    { type: "category", description: "Category", values: [{ aqlKey: "apps", name: "Apps" }] },
    {
      type: "type",
      description: "Type",
      values: [
        { aqlKey: "prg", name: "PRG" },
        { aqlKey: "d64", name: "D64" },
      ],
    },
    { type: "sort", description: "Sort", values: [{ aqlKey: "name", name: "Name" }] },
    { type: "order", description: "Order", values: [{ aqlKey: "asc", name: "Ascending" }] },
    { type: "date", description: "Date", values: [{ aqlKey: "2024", name: "2024" }] },
  ],
  searchByQuery: {
    '(name:"joyride") & (category:apps)': [
      { id: "100", category: 40, name: "Joyride", year: 2024, updated: "2024-03-14" },
    ],
  },
  entriesByResultKey: {
    "100:40": [{ path: "joyride.prg", id: 0, size: 2, date: 1710374400000 }],
  },
  binariesByEntryKey: {
    "100:40:0": new Uint8Array([0x01, 0x08, 0x60]),
  },
};

export const createCommoserveMock = (fixtures: Partial<ArchiveMockFixtures> = {}) =>
  createBaseArchiveMock({
    fixtures: { ...DEFAULT_FIXTURES, ...fixtures },
    expectedClientId: "Commodore",
    expectedUserAgent: "Assembly Query",
  });
