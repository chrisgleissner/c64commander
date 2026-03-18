/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const KNOWN_PRODUCT_TOKENS = new Set(["c64u", "u64", "u64e", "u64e2"] as const);

const compact = (value: string): string => value.replace(/[^a-z0-9]+/g, "");

const resolveMockLabel = (value?: string | null): "demo" | "sandbox" | null => {
  const normalized = compact((value ?? "").trim().toLowerCase());
  if (!normalized) return null;
  if (normalized === "mock" || normalized === "internalmock" || normalized === "demo") return "demo";
  if (normalized === "externalmock" || normalized === "sandbox") return "sandbox";
  return null;
};

const normalizeKnownProduct = (value?: string | null): "c64u" | "u64" | "u64e" | "u64e2" | null => {
  const raw = (value ?? "").trim().toLowerCase();
  const normalized = compact(raw);
  if (!raw) return null;
  if (normalized === "c64u" || normalized === "c64ultimate") return "c64u";
  if (
    normalized === "u64e2" ||
    normalized.includes("u64e2") ||
    normalized.includes("u64emk2") ||
    normalized.includes("ultimate64ii") ||
    normalized.includes("ultimate64mk2")
  ) {
    return "u64e2";
  }
  if (normalized === "u64e" || normalized.includes("u64e") || normalized.includes("ultimate64elite")) return "u64e";
  if (normalized === "u64" || normalized.includes("ultimate64")) return "u64";
  return null;
};

export const inferConnectedDeviceCode = (product?: string | null): "c64u" | "u64" | "u64e" | "u64e2" | null =>
  normalizeKnownProduct(product);

export const inferConnectedDeviceLabel = (product?: string | null): "C64U" | "U64" | "U64E" | "U64E2" | null => {
  const code = normalizeKnownProduct(product);
  switch (code) {
    case "c64u":
      return "C64U";
    case "u64":
      return "U64";
    case "u64e":
      return "U64E";
    case "u64e2":
      return "U64E2";
    default:
      return null;
  }
};

export const mapTargetDisplayLabel = (targetType?: string | null, product?: string | null): string => {
  const normalizedTargetType = (targetType ?? "").trim().toLowerCase();
  const mockLabelFromTarget = resolveMockLabel(normalizedTargetType);
  if (mockLabelFromTarget) return mockLabelFromTarget;

  if (!normalizedTargetType) return "unknown";
  if (normalizedTargetType === "real-device") {
    const mockLabelFromProduct = resolveMockLabel(product);
    if (mockLabelFromProduct) return mockLabelFromProduct;
    return inferConnectedDeviceCode(product) ?? "device";
  }

  if (KNOWN_PRODUCT_TOKENS.has(normalizedTargetType as "c64u" | "u64" | "u64e" | "u64e2")) {
    return normalizedTargetType;
  }

  return normalizedTargetType === "c64" ? "device" : normalizedTargetType;
};
