import { existsSync } from "node:fs";

export type HeaderOcrCandidate = {
  label: string;
  text: string;
};

const DEFAULT_TESSERACT_PATHS = ["/usr/bin/tesseract", "/usr/local/bin/tesseract"];

const normalizeAlphaNumericWhitespace = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const normalizeHeaderOcrText = (value: string) => normalizeAlphaNumericWhitespace(value);

const tokenizeExpectedTitle = (value: string) =>
  normalizeAlphaNumericWhitespace(value)
    .split(" ")
    .filter((token) => token.length > 0);

export const ocrContainsExpectedTitle = (ocrText: string, expectedTitle: string) => {
  const normalized = normalizeAlphaNumericWhitespace(ocrText);
  const titleTokens = tokenizeExpectedTitle(expectedTitle);
  return titleTokens.length > 0 && titleTokens.every((token) => normalized.includes(token));
};

export const ocrContainsHeaderHealthState = (ocrText: string) =>
  /\b(?:healthy|degraded)\b/.test(normalizeAlphaNumericWhitespace(ocrText));

export const ocrContainsSystemLabel = (ocrText: string) => {
  const normalized = normalizeAlphaNumericWhitespace(ocrText);
  return /\bc64u\b/.test(normalized) || /\bc64\b/.test(normalized);
};

export const scoreHeaderOcrCandidate = (ocrText: string, expectedTitle: string) => {
  const normalized = normalizeAlphaNumericWhitespace(ocrText);
  if (!normalized) return 0;

  let score = Math.min(
    4,
    tokenizeExpectedTitle(expectedTitle).filter((token) => normalized.includes(token)).length * 2,
  );
  if (ocrContainsSystemLabel(ocrText)) score += 2;
  if (ocrContainsHeaderHealthState(ocrText)) score += 2;
  if (normalized.length >= expectedTitle.trim().length + 4) score += 1;
  return score;
};

export const pickBestHeaderOcrCandidate = (candidates: HeaderOcrCandidate[], expectedTitle: string) => {
  if (candidates.length === 0) {
    throw new Error(`No OCR candidates were produced for expected title: ${expectedTitle}`);
  }

  return [...candidates].sort((left, right) => {
    const scoreDelta =
      scoreHeaderOcrCandidate(right.text, expectedTitle) - scoreHeaderOcrCandidate(left.text, expectedTitle);
    if (scoreDelta !== 0) return scoreDelta;
    return normalizeAlphaNumericWhitespace(right.text).length - normalizeAlphaNumericWhitespace(left.text).length;
  })[0];
};

export const resolveTesseractCommand = (
  configuredPath = process.env.TESSERACT_PATH,
  fileExists: (path: string) => boolean = existsSync,
) => {
  if (configuredPath && configuredPath.trim().length > 0) {
    return configuredPath;
  }

  return DEFAULT_TESSERACT_PATHS.find((candidate) => fileExists(candidate)) ?? "tesseract";
};
