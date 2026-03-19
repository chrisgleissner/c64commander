export type LightingCityEntry = {
  name: string;
  lat: number;
  lon: number;
};

export const LIGHTING_CITY_DATASET: LightingCityEntry[] = [
  // --- EUROPE (Capitals) ---
  { name: "Amsterdam", lat: 52.3676, lon: 4.9041 },
  { name: "Andorra la Vella", lat: 42.5063, lon: 1.5218 },
  { name: "Athens", lat: 37.9838, lon: 23.7275 },
  { name: "Belgrade", lat: 44.7866, lon: 20.4489 },
  { name: "Berlin", lat: 52.52, lon: 13.405 },
  { name: "Bern", lat: 46.948, lon: 7.4474 },
  { name: "Bratislava", lat: 48.1486, lon: 17.1077 },
  { name: "Brussels", lat: 50.8503, lon: 4.3517 },
  { name: "Bucharest", lat: 44.4268, lon: 26.1025 },
  { name: "Budapest", lat: 47.4979, lon: 19.0402 },
  { name: "Copenhagen", lat: 55.6761, lon: 12.5683 },
  { name: "Dublin", lat: 53.3498, lon: -6.2603 },
  { name: "Helsinki", lat: 60.1699, lon: 24.9384 },
  { name: "Lisbon", lat: 38.7223, lon: -9.1393 },
  { name: "Ljubljana", lat: 46.0569, lon: 14.5058 },
  { name: "London", lat: 51.5072, lon: -0.1276 },
  { name: "Luxembourg", lat: 49.6116, lon: 6.1319 },
  { name: "Madrid", lat: 40.4168, lon: -3.7038 },
  { name: "Monaco", lat: 43.7384, lon: 7.4246 },
  { name: "Oslo", lat: 59.9139, lon: 10.7522 },
  { name: "Paris", lat: 48.8566, lon: 2.3522 },
  { name: "Prague", lat: 50.0755, lon: 14.4378 },
  { name: "Reykjavik", lat: 64.1466, lon: -21.9426 },
  { name: "Rome", lat: 41.9028, lon: 12.4964 },
  { name: "Stockholm", lat: 59.3293, lon: 18.0686 },
  { name: "Tallinn", lat: 59.437, lon: 24.7536 },
  { name: "Vienna", lat: 48.2082, lon: 16.3738 },
  { name: "Warsaw", lat: 52.2297, lon: 21.0122 },

  // --- AMERICAS (Capitals) ---
  { name: "Brasilia", lat: -15.8267, lon: -47.9218 },
  { name: "Buenos Aires", lat: -34.6037, lon: -58.3816 },
  { name: "Ottawa", lat: 45.4215, lon: -75.6972 },
  { name: "Washington DC", lat: 38.9072, lon: -77.0369 },
  { name: "Mexico City", lat: 19.4326, lon: -99.1332 },
  { name: "Santiago", lat: -33.4489, lon: -70.6693 },
  { name: "Lima", lat: -12.0464, lon: -77.0428 },
  { name: "Bogota", lat: 4.711, lon: -74.0721 },

  // --- AFRICA (Capitals subset) ---
  { name: "Cairo", lat: 30.0444, lon: 31.2357 },
  { name: "Nairobi", lat: -1.2921, lon: 36.8219 },
  { name: "Pretoria", lat: -25.7479, lon: 28.2293 },
  { name: "Cape Town", lat: -33.9249, lon: 18.4241 },
  { name: "Abuja", lat: 9.0765, lon: 7.3986 },

  // --- ASIA (Capitals subset) ---
  { name: "Tokyo", lat: 35.6762, lon: 139.6503 },
  { name: "Beijing", lat: 39.9042, lon: 116.4074 },
  { name: "Seoul", lat: 37.5665, lon: 126.978 },
  { name: "Bangkok", lat: 13.7563, lon: 100.5018 },
  { name: "Singapore", lat: 1.3521, lon: 103.8198 },
  { name: "New Delhi", lat: 28.6139, lon: 77.209 },
  { name: "Jakarta", lat: -6.2088, lon: 106.8456 },
  { name: "Riyadh", lat: 24.7136, lon: 46.6753 },

  // --- OCEANIA ---
  { name: "Canberra", lat: -35.2809, lon: 149.13 },
  { name: "Wellington", lat: -41.2866, lon: 174.7756 },

  // --- USA TIMEZONES (2 major cities each) ---
  // Pacific
  { name: "Los Angeles", lat: 34.0522, lon: -118.2437 },
  { name: "San Francisco", lat: 37.7749, lon: -122.4194 },

  // Mountain
  { name: "Denver", lat: 39.7392, lon: -104.9903 },
  { name: "Phoenix", lat: 33.4484, lon: -112.074 },

  // Central
  { name: "Chicago", lat: 41.8781, lon: -87.6298 },
  { name: "Dallas", lat: 32.7767, lon: -96.797 },

  // Eastern
  { name: "New York", lat: 40.7128, lon: -74.006 },
  { name: "Miami", lat: 25.7617, lon: -80.1918 },

  // Alaska
  { name: "Anchorage", lat: 61.2181, lon: -149.9003 },
  { name: "Juneau", lat: 58.3019, lon: -134.4197 },

  // Hawaii
  { name: "Honolulu", lat: 21.3069, lon: -157.8583 },
  { name: "Hilo", lat: 19.7076, lon: -155.0885 },

  // --- MULTI-TIMEZONE COUNTRIES (major cities) ---
  // Canada
  { name: "Toronto", lat: 43.6532, lon: -79.3832 },
  { name: "Vancouver", lat: 49.2827, lon: -123.1207 },

  // Australia
  { name: "Sydney", lat: -33.8688, lon: 151.2093 },
  { name: "Perth", lat: -31.9505, lon: 115.8605 },

  // Russia
  { name: "Moscow", lat: 55.7558, lon: 37.6173 },
  { name: "Vladivostok", lat: 43.1155, lon: 131.8855 },

  // Brazil
  { name: "Sao Paulo", lat: -23.5505, lon: -46.6333 },
  { name: "Manaus", lat: -3.119, lon: -60.0217 },

  // Indonesia
  { name: "Jakarta", lat: -6.2088, lon: 106.8456 },
  { name: "Jayapura", lat: -2.5337, lon: 140.7181 },
];

export const findLightingCity = (city: string): LightingCityEntry => {
  const normalized = city.trim().toLowerCase();
  const match = LIGHTING_CITY_DATASET.find((entry) => entry.name.toLowerCase() === normalized);
  if (!match) {
    throw new Error(`Unknown lighting city: ${city}`);
  }
  return match;
};

export const searchLightingCities = (query: string, limit = 6): LightingCityEntry[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return LIGHTING_CITY_DATASET.slice(0, limit);
  }

  const startsWith = LIGHTING_CITY_DATASET.filter((entry) => entry.name.toLowerCase().startsWith(normalized));
  const contains = LIGHTING_CITY_DATASET.filter(
    (entry) => !entry.name.toLowerCase().startsWith(normalized) && entry.name.toLowerCase().includes(normalized),
  );

  return [...startsWith, ...contains].slice(0, limit);
};
