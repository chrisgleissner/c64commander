import { describe, expect, it } from "vitest";
import { validateConfigBatchWrite, validateConfigWrite } from "@/lib/config/validateConfigWrite";

describe("validateConfigWrite", () => {
  it("accepts declared enum values exactly as published by the live config spec", () => {
    expect(() =>
      validateConfigWrite({
        category: "U64 Specific Settings",
        item: "CPU Speed",
        value: " 4",
        categoryPayload: {
          "U64 Specific Settings": {
            items: {
              "CPU Speed": {
                selected: " 1",
                options: [" 1", " 2", " 4"],
              },
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it("rejects enum values that are not present in the live option list", () => {
    expect(() =>
      validateConfigWrite({
        category: "U64 Specific Settings",
        item: "CPU Speed",
        value: "4",
        categoryPayload: {
          "U64 Specific Settings": {
            items: {
              "CPU Speed": {
                selected: " 1",
                options: [" 1", " 2", " 4"],
              },
            },
          },
        },
      }),
    ).toThrowError(expect.objectContaining({ name: "ConfigWriteValidationError", code: "INVALID_ENUM_VALUE" }));
  });

  it("accepts numeric values inside configured bounds", () => {
    expect(() =>
      validateConfigWrite({
        category: "LED Strip Settings",
        item: "Strip Intensity",
        value: 12,
        categoryPayload: {
          "LED Strip Settings": {
            items: {
              "Strip Intensity": {
                selected: 6,
                min: 0,
                max: 31,
              },
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it("rejects non-numeric values for bounded numeric items", () => {
    expect(() =>
      validateConfigWrite({
        category: "LED Strip Settings",
        item: "Strip Intensity",
        value: "bright",
        categoryPayload: {
          "LED Strip Settings": {
            items: {
              "Strip Intensity": {
                selected: 6,
                min: 0,
                max: 31,
              },
            },
          },
        },
      }),
    ).toThrowError(expect.objectContaining({ name: "ConfigWriteValidationError", code: "INVALID_NUMERIC_VALUE" }));
  });

  it("rejects bounded numeric values outside the live min/max range", () => {
    expect(() =>
      validateConfigWrite({
        category: "LED Strip Settings",
        item: "Strip Intensity",
        value: 40,
        categoryPayload: {
          "LED Strip Settings": {
            items: {
              "Strip Intensity": {
                selected: 6,
                min: 0,
                max: 31,
              },
            },
          },
        },
      }),
    ).toThrowError(expect.objectContaining({ name: "ConfigWriteValidationError", code: "OUT_OF_RANGE" }));
  });

  it("rejects writes when the item is missing from the live category payload", () => {
    expect(() =>
      validateConfigWrite({
        category: "Audio Mixer",
        item: "Vol UltiSid 1",
        value: "0 dB",
        categoryPayload: {
          "Audio Mixer": {
            items: {},
          },
        },
      }),
    ).toThrowError(expect.objectContaining({ name: "ConfigWriteValidationError", code: "CONFIG_ITEM_NOT_FOUND" }));
  });
});

describe("validateConfigBatchWrite", () => {
  it("validates every update in a batch payload", () => {
    expect(() =>
      validateConfigBatchWrite({
        category: "Audio Mixer",
        updates: {
          "Vol UltiSid 1": "0 dB",
          "Vol UltiSid 2": "+6 dB",
        },
        categoryPayload: {
          "Audio Mixer": {
            items: {
              "Vol UltiSid 1": {
                selected: "0 dB",
                options: ["-6 dB", "0 dB", "+6 dB"],
              },
              "Vol UltiSid 2": {
                selected: "0 dB",
                options: ["-6 dB", "0 dB", "+6 dB"],
              },
            },
          },
        },
      }),
    ).not.toThrow();
  });
});
