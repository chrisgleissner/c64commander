/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
export interface LightingCityEntry {
  name: string;
  country: string; // ISO 3166-1 alpha-2 code
  lat: number;
  lon: number;
}

export const LIGHTING_CITY_DATASET: LightingCityEntry[] = [
  // --- EUROPE ---
  { name: "Amsterdam", country: "NL", lat: 52.374, lon: 4.8897 },
  { name: "Athens", country: "GR", lat: 37.9795, lon: 23.7162 },
  { name: "Belgrade", country: "RS", lat: 44.804, lon: 20.4651 },
  { name: "Berlin", country: "DE", lat: 52.5244, lon: 13.4105 },
  { name: "Bern", country: "CH", lat: 46.9481, lon: 7.4474 },
  { name: "Brussels", country: "BE", lat: 50.8505, lon: 4.3488 },
  { name: "Bucharest", country: "RO", lat: 44.4323, lon: 26.1063 },
  { name: "Budapest", country: "HU", lat: 47.4984, lon: 19.0405 },
  { name: "Copenhagen", country: "DK", lat: 55.6759, lon: 12.5655 },
  { name: "Dublin", country: "IE", lat: 53.3331, lon: -6.2489 },
  { name: "Helsinki", country: "FI", lat: 60.1695, lon: 24.9355 },
  { name: "Istanbul", country: "TR", lat: 41.0138, lon: 28.9497 },
  { name: "Kyiv", country: "UA", lat: 50.4547, lon: 30.5238 },
  { name: "Lisbon", country: "PT", lat: 38.7167, lon: -9.1333 },
  { name: "London", country: "GB", lat: 51.5085, lon: -0.1257 },
  { name: "Madrid", country: "ES", lat: 40.4165, lon: -3.7026 },
  { name: "Moscow", country: "RU", lat: 55.7522, lon: 37.6156 },
  { name: "Oslo", country: "NO", lat: 59.9127, lon: 10.7461 },
  { name: "Paris", country: "FR", lat: 48.8534, lon: 2.3488 },
  { name: "Prague", country: "CZ", lat: 50.088, lon: 14.4208 },
  { name: "Reykjavik", country: "IS", lat: 64.1355, lon: -21.8954 },
  { name: "Rome", country: "IT", lat: 41.8919, lon: 12.5113 },
  { name: "Sarajevo", country: "BA", lat: 43.8486, lon: 18.3564 },
  { name: "Stockholm", country: "SE", lat: 59.3326, lon: 18.0649 },
  { name: "Tallinn", country: "EE", lat: 59.437, lon: 24.7535 },
  { name: "Vienna", country: "AT", lat: 48.2085, lon: 16.3721 },
  { name: "Warsaw", country: "PL", lat: 52.2297, lon: 21.0118 },
  { name: "Zagreb", country: "HR", lat: 45.8144, lon: 15.978 },
  { name: "Zurich", country: "CH", lat: 47.3667, lon: 8.55 },

  // --- NORTH AMERICA ---
  { name: "Anchorage, AK", country: "US", lat: 61.2181, lon: -149.9003 },
  { name: "Calgary, AB", country: "CA", lat: 51.0501, lon: -114.0853 },
  { name: "Chicago, IL", country: "US", lat: 41.85, lon: -87.65 },
  { name: "Dallas, TX", country: "US", lat: 32.7831, lon: -96.8067 },
  { name: "Denver, CO", country: "US", lat: 39.7392, lon: -104.9847 },
  { name: "Honolulu, HI", country: "US", lat: 21.3069, lon: -157.8583 },
  { name: "Los Angeles, CA", country: "US", lat: 34.0522, lon: -118.2437 },
  { name: "Mexico City", country: "MX", lat: 19.4285, lon: -99.1277 },
  { name: "Miami, FL", country: "US", lat: 25.7743, lon: -80.1937 },
  { name: "Montreal, QC", country: "CA", lat: 45.5088, lon: -73.5878 },
  { name: "New York, NY", country: "US", lat: 40.7143, lon: -74.006 },
  { name: "Phoenix, AZ", country: "US", lat: 33.4484, lon: -112.074 },
  { name: "San Francisco, CA", country: "US", lat: 37.7749, lon: -122.4194 },
  { name: "Toronto, ON", country: "CA", lat: 43.7001, lon: -79.4163 },
  { name: "Vancouver, BC", country: "CA", lat: 49.2497, lon: -123.1193 },
  { name: "Washington DC", country: "US", lat: 38.8951, lon: -77.0364 },
  { name: "Winnipeg, MB", country: "CA", lat: 49.8844, lon: -97.147 },

  // --- SOUTH AMERICA ---
  { name: "Asuncion", country: "PY", lat: -25.2637, lon: -57.5759 },
  { name: "Bogota", country: "CO", lat: 4.6097, lon: -74.0817 },
  { name: "Brasilia", country: "BR", lat: -15.7797, lon: -47.9297 },
  { name: "Buenos Aires", country: "AR", lat: -34.6132, lon: -58.3772 },
  { name: "Caracas", country: "VE", lat: 10.488, lon: -66.8792 },
  { name: "Lima", country: "PE", lat: -12.0433, lon: -77.0283 },
  { name: "Manaus", country: "BR", lat: -3.1019, lon: -60.025 },
  { name: "Montevideo", country: "UY", lat: -34.8333, lon: -56.1667 },
  { name: "Santiago", country: "CL", lat: -33.4569, lon: -70.6483 },
  { name: "Sao Paulo", country: "BR", lat: -23.5475, lon: -46.6358 },

  // --- AFRICA ---
  { name: "Abuja", country: "NG", lat: 9.0579, lon: 7.4951 },
  { name: "Accra", country: "GH", lat: 5.556, lon: -0.1969 },
  { name: "Addis Ababa", country: "ET", lat: 9.025, lon: 38.7469 },
  { name: "Algiers", country: "DZ", lat: 36.7525, lon: 3.042 },
  { name: "Cairo", country: "EG", lat: 30.0626, lon: 31.2497 },
  { name: "Cape Town", country: "ZA", lat: -33.9258, lon: 18.4232 },
  { name: "Casablanca", country: "MA", lat: 33.5883, lon: -7.6114 },
  { name: "Johannesburg", country: "ZA", lat: -26.2023, lon: 28.0436 },
  { name: "Lagos", country: "NG", lat: 6.4541, lon: 3.3947 },
  { name: "Nairobi", country: "KE", lat: -1.2833, lon: 36.8167 },

  // --- ASIA & MIDDLE EAST ---
  { name: "Bangkok", country: "TH", lat: 13.75, lon: 100.5167 },
  { name: "Beijing", country: "CN", lat: 39.9075, lon: 116.3972 },
  { name: "Dubai", country: "AE", lat: 25.0772, lon: 55.3093 },
  { name: "Hong Kong", country: "HK", lat: 22.2855, lon: 114.1577 },
  { name: "Islamabad", country: "PK", lat: 33.7215, lon: 73.0433 },
  { name: "Jakarta", country: "ID", lat: -6.1744, lon: 106.8294 },
  { name: "Jerusalem", country: "IL", lat: 31.769, lon: 35.2163 },
  { name: "Manila", country: "PH", lat: 14.6042, lon: 120.9822 },
  { name: "Mumbai", country: "IN", lat: 18.975, lon: 72.8258 },
  { name: "New Delhi", country: "IN", lat: 28.6358, lon: 77.2245 },
  { name: "Osaka", country: "JP", lat: 34.6937, lon: 135.5023 },
  { name: "Riyadh", country: "SA", lat: 24.6877, lon: 46.7219 },
  { name: "Seoul", country: "KR", lat: 37.566, lon: 126.9784 },
  { name: "Singapore", country: "SG", lat: 1.2897, lon: 103.8501 },
  { name: "Taipei", country: "TW", lat: 25.0478, lon: 121.5319 },
  { name: "Tehran", country: "IR", lat: 35.6944, lon: 51.4215 },
  { name: "Tokyo", country: "JP", lat: 35.6895, lon: 139.6917 },
  { name: "Vladivostok", country: "RU", lat: 43.1056, lon: 131.8735 },

  // --- OCEANIA ---
  { name: "Adelaide", country: "AU", lat: -34.9287, lon: 138.5986 },
  { name: "Auckland", country: "NZ", lat: -36.8485, lon: 174.7633 },
  { name: "Brisbane", country: "AU", lat: -27.4679, lon: 153.0278 },
  { name: "Canberra", country: "AU", lat: -35.2835, lon: 149.1281 },
  { name: "Perth", country: "AU", lat: -31.9522, lon: 115.8614 },
  { name: "Sydney", country: "AU", lat: -33.8678, lon: 151.2073 },
  { name: "Wellington", country: "NZ", lat: -41.2865, lon: 174.7762 },
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
