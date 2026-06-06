/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { pickDirectoryMock } = vi.hoisted(() => ({
  pickDirectoryMock: vi.fn(),
}));

vi.mock("@/lib/native/folderPicker", () => ({
  FolderPicker: {
    pickDirectory: (...args: unknown[]) => pickDirectoryMock(...args),
    releasePersistedUris: vi.fn(),
    listChildren: vi.fn(),
    getPersistedUris: vi.fn(),
    readFile: vi.fn(),
    readFileFromTree: vi.fn(),
  },
}));

vi.mock("@/lib/native/platform", () => ({
  getPlatform: () => "android",
  isNativePlatform: () => true,
}));

vi.mock("@/lib/smoke/smokeMode", () => ({
  getSmokeConfig: () => null,
}));

import { createLocalSourceFromPicker } from "@/lib/sourceNavigation/localSourcesStore";

describe("localSourcesStore native picker without window", () => {
  beforeEach(() => {
    pickDirectoryMock.mockReset();
  });

  it("omits native picker options when no browser window overrides exist", async () => {
    expect(typeof window).toBe("undefined");
    pickDirectoryMock.mockResolvedValue({
      treeUri: "content://tree/primary%3AMusic",
      rootName: "Phone",
      permissionPersisted: true,
    });

    const result = await createLocalSourceFromPicker(null);

    expect(pickDirectoryMock).toHaveBeenCalledWith(undefined);
    expect(result?.source.android?.treeUri).toBe("content://tree/primary%3AMusic");
  });
});
