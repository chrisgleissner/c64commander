import { describe, it, expect, beforeEach, vi } from "vitest";
import { getMockConfigPayload, setMockConfigLoader, clearMockConfigLoader } from "@/lib/mock/mockConfig";

describe("mockConfig", () => {
  beforeEach(() => {
    clearMockConfigLoader();
    vi.resetModules();
  });

  it("parses custom loader data", async () => {
    const rawConfig = {
      config: {
        general: {
          base_url: "http://test",
          firmware_version: "9.9.9",
        },
        categories: {
          Audio: {
            items: {
              Volume: {
                selected: "0 dB",
                options: ["0 dB", "6 dB"],
                details: { min: 0, max: 10, presets: ["A", "B"] },
              },
              Mute: {
                selected: 1, // Number value
                details: { min: "0", max: "1" }, // String details
              },
            },
          },
        },
      },
    };

    setMockConfigLoader(() => rawConfig);
    const payload = await getMockConfigPayload();

    expect(payload.general.baseUrl).toBe("http://test");
    expect(payload.general.firmwareVersion).toBe("9.9.9");

    const audio = payload.categories.Audio;
    expect(audio.Volume.value).toBe("0 dB");
    expect(audio.Volume.options).toEqual(["0 dB", "6 dB"]);
    expect(audio.Volume.details?.min).toBe(0);
    expect(audio.Volume.details?.presets).toEqual(["A", "B"]);

    expect(audio.Mute.value).toBe(1);
    expect(audio.Mute.details?.min).toBe(0);
  });

  it("handles empty or malformed data", async () => {
    setMockConfigLoader(() => ({}));
    const payload = await getMockConfigPayload();
    expect(payload.categories).toEqual({});
  });

  it("handles weird types in normalization", async () => {
    setMockConfigLoader(() => ({
      config: {
        categories: {
          Test: {
            items: {
              BadVal: {
                // @ts-expect-error - intentionally passing null for test
                selected: null,
                details: { min: "invalid" },
              },
            },
          },
        },
      },
    }));
    const payload = await getMockConfigPayload();
    expect(payload.categories.Test.BadVal.value).toBe("");
    expect(payload.categories.Test.BadVal.details?.min).toBeUndefined();
  });

  it("handles string input from loader (yaml string)", async () => {
    const yamlStr = `config:
  general:
    device_type: TestDevice
`;
    setMockConfigLoader(() => yamlStr);
    const payload = await getMockConfigPayload();
    expect(payload.general.deviceType).toBe("TestDevice");
  });

  it("handles null return from custom loader (line 144 ?? fallback)", async () => {
    setMockConfigLoader(() => null as unknown as string);
    const payload = await getMockConfigPayload();
    expect(payload.categories).toEqual({});
  });

  it("handles empty string from loader → yaml.load returns null (line 142 ?? fallback)", async () => {
    setMockConfigLoader(() => "");
    const payload = await getMockConfigPayload();
    expect(payload.categories).toEqual({});
  });

  it("handles category with no items property (line 171 ?? fallback)", async () => {
    setMockConfigLoader(() => ({
      config: {
        categories: {
          EmptyCat: {} as Record<string, unknown>,
        },
      },
    }));
    const payload = await getMockConfigPayload();
    expect(payload.categories.EmptyCat).toEqual({});
  });

  it("caches payload on second call without clearing", async () => {
    setMockConfigLoader(() => ({ config: { general: { base_url: "http://cached" } } }));
    const first = await getMockConfigPayload();
    const second = await getMockConfigPayload();
    expect(first).toBe(second);
    expect(first.general.baseUrl).toBe("http://cached");
  });

  it("filters out empty-string options", async () => {
    setMockConfigLoader(() => ({
      config: {
        categories: {
          Test: {
            items: {
              Item: {
                selected: "a",
                options: ["valid", 0, ""],
              },
            },
          },
        },
      },
    }));
    const payload = await getMockConfigPayload();
    // empty string filtered, 0 converted by asString to "0"
    expect(payload.categories.Test.Item.options).toEqual(["valid", "0"]);
  });

  it("stores format in details and uses empty presets array as undefined", async () => {
    setMockConfigLoader(() => ({
      config: {
        categories: {
          Test: {
            items: {
              Item: {
                selected: "x",
                details: { format: "hex", presets: [] },
              },
            },
          },
        },
      },
    }));
    const payload = await getMockConfigPayload();
    expect(payload.categories.Test.Item.details?.format).toBe("hex");
    // empty presets array → presets not set on payload
    expect(payload.categories.Test.Item.details?.presets).toBeUndefined();
  });

  it("falls back to defaults when general fields are missing", async () => {
    setMockConfigLoader(() => ({ config: {} }));
    const payload = await getMockConfigPayload();
    expect(payload.general.baseUrl).toBe("http://c64u");
    expect(payload.general.restApiVersion).toBe("0.1");
    expect(payload.general.deviceType).toBe("Ultimate 64");
    expect(payload.general.firmwareVersion).toBe("3.12a");
  });
});
