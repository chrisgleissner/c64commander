import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSonglengths } from "@/pages/playFiles/hooks/useSonglengths";
import { type LocalPlayFile } from "@/lib/playback/playbackRouter";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { countSonglengthsEntries } from "@/lib/sid/songlengths";

const SONGLENGTHS_FILE_STORAGE_KEY = "c64u_songlengths_file:v1";

// Mocks
vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
}));

vi.mock("@/lib/native/platform", () => ({
  getPlatform: vi.fn(() => "web"),
  isNativePlatform: vi.fn(() => false),
}));

// Mock songlengths library
vi.mock("@/lib/songlengths", () => ({
  SongLengthServiceFacade: class {
    constructor() {}
    loadOnColdStart() {
      return Promise.resolve({ status: "ready" });
    }
  },
  InMemoryTextBackend: class {
    constructor() {}
    exportSnapshot() {
      return {};
    }
  },
}));

vi.mock("@/lib/sid/songlengths", () => ({
  countSonglengthsEntries: vi.fn(() => 42),
  parseSongLengthsFile: () => Promise.resolve([]),
}));

vi.mock("@/lib/playback/fileLibraryUtils", () => ({
  buildLocalPlayFileFromUri: (name: string, path: string, uri: string) => {
    // Mock file object with necessary methods
    const blob = new Blob([""], { type: "text/plain" });
    const file = new File([blob], name, {
      lastModified: 1000,
    }) as unknown as LocalPlayFile;
    // Ensure arrayBuffer and text are mocked if needed, but File has them in newer jsdom
    return file;
  },
}));

describe("useSonglengths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("initializes defaults", () => {
    const { result } = renderHook(() => useSonglengths({ playlist: [] }));
    expect(result.current.songlengthsFiles).toEqual([]);
  });

  it("handles songlengths input", async () => {
    const { result } = renderHook(() => useSonglengths({ playlist: [] }));

    const file = new File(["md5=123"], "Songlengths.txt", {
      type: "text/plain",
    });
    // Mock arrayBuffer/text if missing in environment
    if (!file.text) {
      // @ts-expect-error - polyfilling text() for test environment
      file.text = async () => "md5=123";
      // @ts-expect-error - polyfilling arrayBuffer() for test environment
      file.arrayBuffer = async () => new TextEncoder().encode("md5=123").buffer;
    }

    act(() => {
      // @ts-expect-error - passing File[] instead of FileList for test
      result.current.handleSonglengthsInput([file]);
    });

    expect(result.current.songlengthsFiles).toHaveLength(1);
    expect(result.current.songlengthsFiles[0].name).toBe("Songlengths.txt");

    await waitFor(() => {
      expect(result.current.songlengthsSummary.entryCount).toBe(42);
    });
  });

  it("handles picked file persistence", () => {
    const { result } = renderHook(() => useSonglengths({ playlist: [] }));

    act(() => {
      result.current.handleSonglengthsPicked({
        uri: "file://sl.txt",
        name: "Songlengths.txt",
        path: "/Songlengths.txt",
      });
    });

    expect(localStorage.getItem(SONGLENGTHS_FILE_STORAGE_KEY)).toContain("file://sl.txt");
  });

  it("ignores invalid file types", () => {
    const { result } = renderHook(() => useSonglengths({ playlist: [] }));
    const file = new File([""], "readme.md", { type: "text/plain" });
    act(() => {
      // @ts-expect-error - passing File[] instead of FileList for test
      result.current.handleSonglengthsInput([file]);
    });
    // Should ignore
    expect(result.current.songlengthsFiles).toHaveLength(0);
  });

  it("formatKiB returns null for zero-size file (BRDA:119)", async () => {
    const { result } = renderHook(() => useSonglengths({ playlist: [] }));
    const file = new File([""], "Songlengths.txt", { type: "text/plain" });
    // @ts-expect-error - polyfilling arrayBuffer() for test environment
    file.arrayBuffer = async () => new ArrayBuffer(0);
    act(() => {
      // @ts-expect-error - passing File[] instead of FileList for test
      result.current.handleSonglengthsInput([file]);
    });
    await waitFor(() => {
      expect(result.current.songlengthsSummary.entryCount).toBe(42);
    });
    expect(result.current.songlengthsSummary.sizeLabel).toBeNull();
  });

  it("formatKiB returns toFixed(0) for size >= 10 KiB (BRDA:121)", async () => {
    const { result } = renderHook(() => useSonglengths({ playlist: [] }));
    const fakeFile = {
      arrayBuffer: async () => new TextEncoder().encode("x").buffer,
    } as unknown as LocalPlayFile;
    act(() => {
      result.current.mergeSonglengthsFiles([
        {
          path: "/test/Songlengths.txt",
          file: fakeFile,
          sizeBytes: 10240,
        },
      ]);
    });
    await waitFor(() => {
      expect(result.current.songlengthsSummary.sizeLabel).toBe("10 KiB");
    });
  });

  it("sets error when entryCount is zero (BRDA:212)", async () => {
    vi.mocked(countSonglengthsEntries).mockReturnValueOnce(0);
    const { result } = renderHook(() => useSonglengths({ playlist: [] }));
    const content = "md5=abc";
    const file = new File([content], "Songlengths.txt", { type: "text/plain" });
    // @ts-expect-error - polyfilling arrayBuffer() for test environment
    file.arrayBuffer = async () => new TextEncoder().encode(content).buffer;
    act(() => {
      // @ts-expect-error - passing File[] instead of FileList for test
      result.current.handleSonglengthsInput([file]);
    });
    await waitFor(() => {
      expect(result.current.songlengthsSummary.error).toBe("Songlengths file contains no entries.");
    });
    expect(result.current.songlengthsSummary.entryCount).toBe(0);
  });

  it("uses path-derived name when entry has no name or file.name (BRDA:212)", async () => {
    const { result } = renderHook(() => useSonglengths({ playlist: [] }));
    const fakeFile = {
      arrayBuffer: async () => new TextEncoder().encode("md5=123").buffer,
    } as unknown as LocalPlayFile;
    act(() => {
      result.current.mergeSonglengthsFiles([{ path: "/some/dir/Songlengths.txt", file: fakeFile }]);
    });
    await waitFor(() => {
      expect(result.current.songlengthsSummary.fileName).toBe("Songlengths.txt");
    });
  });

  it("loads persisted file on Android with missing sizeBytes/modifiedAt (BRDA:136,144,145)", async () => {
    vi.mocked(getPlatform).mockReturnValue("android" as any);
    vi.mocked(isNativePlatform).mockReturnValue(true);
    const stored = {
      uri: "file://sl.txt",
      name: "Songlengths.txt",
      path: "/Songlengths.txt",
    };
    localStorage.setItem(SONGLENGTHS_FILE_STORAGE_KEY, JSON.stringify(stored));
    const { result } = renderHook(() => useSonglengths({ playlist: [] }));
    await waitFor(() => {
      expect(result.current.songlengthsFiles).toHaveLength(1);
    });
    expect(result.current.songlengthsFiles[0].sizeBytes).toBeNull();
    expect(result.current.songlengthsFiles[0].modifiedAt).toBeNull();
  });

  it("skips Android restore when stored data has missing required field (BRDA:136)", async () => {
    vi.mocked(getPlatform).mockReturnValue("android" as any);
    vi.mocked(isNativePlatform).mockReturnValue(true);
    const stored = { uri: "file://sl.txt", name: "Songlengths.txt" }; // missing path
    localStorage.setItem(SONGLENGTHS_FILE_STORAGE_KEY, JSON.stringify(stored));
    const { result } = renderHook(() => useSonglengths({ playlist: [] }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current.songlengthsFiles).toHaveLength(0);
  });
});
