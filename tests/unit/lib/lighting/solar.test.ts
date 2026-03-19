import { describe, expect, it } from "vitest";
import { searchLightingCities } from "@/lib/lighting/cityDataset";
import { calculateSolarTimes, resolveCircadianPhase, resolveSolarLocation } from "@/lib/lighting/solar";

describe("lighting solar module", () => {
  it("resolves bundled cities case-insensitively", () => {
    const resolved = resolveSolarLocation({ city: "lOnDoN" });
    expect(resolved.label).toBe("London");
    expect(resolved.source).toBe("city");
  });

  it("throws for unknown cities", () => {
    expect(() => resolveSolarLocation({ city: "Atlantis" })).toThrow("Unknown lighting city");
  });

  it("searches the bundled city list with prefix and contains matching", () => {
    expect(searchLightingCities("to").map((city) => city.name)).toContain("Tokyo");
    expect(searchLightingCities("ange").map((city) => city.name)).toContain("Los Angeles, CA");
  });

  it("passes through coordinates directly", () => {
    const resolved = resolveSolarLocation({ lat: 12.34, lon: 56.78 });
    expect(resolved.lat).toBe(12.34);
    expect(resolved.lon).toBe(56.78);
    expect(resolved.source).toBe("coordinates");
  });

  it("calculates solar times without fallback for an ordinary city/date", () => {
    const result = calculateSolarTimes({ city: "London" }, new Date("2026-03-19T12:00:00Z"));
    expect(result.fallbackActive).toBe(false);
    expect(result.sunTimes.sunrise.getTime()).toBeLessThan(result.sunTimes.sunset.getTime());
    expect(result.sunTimes.solarNoon.getTime()).toBeGreaterThan(result.sunTimes.sunrise.getTime());
  });

  it("uses deterministic fallback boundaries when solar events are invalid", () => {
    const result = calculateSolarTimes({ lat: 89.9, lon: 0 }, new Date("2026-12-19T12:00:00Z"));
    expect(result.fallbackActive).toBe(true);
    expect(result.sunTimes.sunrise.getHours()).toBe(6);
    expect(result.sunTimes.sunset.getHours()).toBe(18);
  });

  it("maps current time into night, dawn, day, and sunset phases with normalized progress", () => {
    const sunrise = new Date("2026-03-19T06:00:00Z");
    const sunset = new Date("2026-03-19T18:00:00Z");
    const sunTimes = {
      sunrise,
      sunset,
      dawn: new Date("2026-03-19T05:30:00Z"),
      dusk: new Date("2026-03-19T18:30:00Z"),
      solarNoon: new Date("2026-03-19T12:00:00Z"),
    };

    expect(resolveCircadianPhase(new Date("2026-03-19T04:00:00Z"), sunTimes).phase).toBe("night");
    expect(resolveCircadianPhase(new Date("2026-03-19T06:30:00Z"), sunTimes).phase).toBe("dawn");
    expect(resolveCircadianPhase(new Date("2026-03-19T12:30:00Z"), sunTimes).phase).toBe("day");
    const sunsetPhase = resolveCircadianPhase(new Date("2026-03-19T17:00:00Z"), sunTimes);
    expect(sunsetPhase.phase).toBe("sunset");
    expect(sunsetPhase.progress).toBeGreaterThanOrEqual(0);
    expect(sunsetPhase.progress).toBeLessThanOrEqual(1);
  });
});
