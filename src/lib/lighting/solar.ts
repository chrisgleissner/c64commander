import SunCalc from "suncalc";
import { findLightingCity } from "@/lib/lighting/cityDataset";
import type { LightingCircadianPeriod } from "@/lib/lighting/types";

export type SolarLocationInput = { lat: number; lon: number } | { city: string };

export type SolarResolvedLocation = {
  lat: number;
  lon: number;
  label: string;
  source: "coordinates" | "city";
};

export type SolarTimeSet = {
  sunrise: Date;
  sunset: Date;
  dawn: Date;
  dusk: Date;
  solarNoon: Date;
};

export type SolarCalculationResult = {
  location: SolarResolvedLocation;
  date: string;
  sunTimes: SolarTimeSet;
  fallbackActive: boolean;
};

export type CircadianPhaseResult = {
  phase: "night" | "dawn" | "day" | "sunset";
  progress: number;
};

const buildFallbackTime = (date: Date, hour: number, minute = 0) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);

const clampProgress = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const isValidDate = (value: Date | undefined) => Boolean(value && Number.isFinite(value.getTime()));

export const resolveSolarLocation = (input: SolarLocationInput): SolarResolvedLocation => {
  if ("city" in input) {
    const city = findLightingCity(input.city);
    return {
      lat: city.lat,
      lon: city.lon,
      label: city.name,
      source: "city",
    };
  }
  return {
    lat: input.lat,
    lon: input.lon,
    label: `${input.lat.toFixed(3)}, ${input.lon.toFixed(3)}`,
    source: "coordinates",
  };
};

export const calculateSolarTimes = (input: SolarLocationInput, date: Date): SolarCalculationResult => {
  const location = resolveSolarLocation(input);
  const raw = SunCalc.getTimes(date, location.lat, location.lon);

  const fallbackSunrise = buildFallbackTime(date, 6);
  const fallbackSunset = buildFallbackTime(date, 18);
  const fallback = {
    sunrise: fallbackSunrise,
    sunset: fallbackSunset,
    dawn: buildFallbackTime(date, 5, 30),
    dusk: buildFallbackTime(date, 21, 30),
    solarNoon: buildFallbackTime(date, 12),
  };

  const fallbackActive =
    !isValidDate(raw.sunrise) || !isValidDate(raw.sunset) || raw.sunrise!.getTime() >= raw.sunset!.getTime();

  return {
    location,
    date: new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString(),
    sunTimes: fallbackActive
      ? fallback
      : {
          sunrise: raw.sunrise!,
          sunset: raw.sunset!,
          dawn: isValidDate(raw.dawn) ? raw.dawn! : fallback.dawn,
          dusk: isValidDate(raw.dusk) ? raw.dusk! : fallback.dusk,
          solarNoon: isValidDate(raw.solarNoon) ? raw.solarNoon! : fallback.solarNoon,
        },
    fallbackActive,
  };
};

export const resolveCircadianPhase = (
  now: Date,
  sunTimes: SolarTimeSet,
): CircadianPhaseResult & { period: LightingCircadianPeriod; nextBoundary: Date } => {
  const morningStart = sunTimes.sunrise;
  const dayStart = new Date(sunTimes.sunrise.getTime() + 2 * 60 * 60 * 1000);
  const eveningStart = new Date(sunTimes.sunset.getTime() - 2 * 60 * 60 * 1000);
  const nightStart = new Date(sunTimes.sunset.getTime() + 45 * 60 * 1000);
  const tomorrowMorning = new Date(morningStart.getTime() + 24 * 60 * 60 * 1000);

  if (now >= nightStart || now < morningStart) {
    const phaseStart = now >= nightStart ? nightStart : new Date(nightStart.getTime() - 24 * 60 * 60 * 1000);
    return {
      phase: "night",
      period: "night",
      nextBoundary: morningStart,
      progress: clampProgress(
        (now.getTime() - phaseStart.getTime()) / (tomorrowMorning.getTime() - phaseStart.getTime()),
      ),
    };
  }
  if (now >= eveningStart) {
    return {
      phase: "sunset",
      period: "evening",
      nextBoundary: nightStart,
      progress: clampProgress(
        (now.getTime() - eveningStart.getTime()) / (nightStart.getTime() - eveningStart.getTime()),
      ),
    };
  }
  if (now >= dayStart) {
    return {
      phase: "day",
      period: "day",
      nextBoundary: eveningStart,
      progress: clampProgress((now.getTime() - dayStart.getTime()) / (eveningStart.getTime() - dayStart.getTime())),
    };
  }
  return {
    phase: "dawn",
    period: "morning",
    nextBoundary: dayStart,
    progress: clampProgress((now.getTime() - morningStart.getTime()) / (dayStart.getTime() - morningStart.getTime())),
  };
};
