import { toast } from "@/hooks/use-toast";
import { addErrorLog } from "@/lib/logging";

export const FILE_VALIDATION_FAILED_EVENT = "FILE_VALIDATION_FAILED" as const;

export type SupportedC64FileType = "d64" | "d71" | "d81" | "prg" | "sid" | "mod" | "crt";

export type FileValidationCode =
  | "VALID"
  | "INVALID_SIZE"
  | "INVALID_BLOCK_COUNT"
  | "INVALID_DIRECTORY_LOCATION"
  | "INVALID_DIRECTORY_ENTRY"
  | "INVALID_HEADER_LOCATION"
  | "INVALID_MAGIC"
  | "INVALID_VERSION"
  | "INVALID_DATA_OFFSET"
  | "INVALID_PATTERN_TABLE"
  | "INVALID_CHIP_HEADER"
  | "INVALID_CHIP_PACKET"
  | "INVALID_OUT_OF_BOUNDS"
  | "INVALID_PROGRAM_DATA"
  | "INVALID_SONG_RANGE"
  | "INVALID_HEADER_LENGTH"
  | "INVALID_FILE_TYPE"
  | "UNSUPPORTED_FILE_TYPE";

export type FileValidationFailureCode = Exclude<FileValidationCode, "VALID">;

export type ValidationSuccess = {
  ok: true;
  code: "VALID";
  detectedType: SupportedC64FileType;
};

export type ValidationFailure = {
  ok: false;
  code: FileValidationFailureCode;
  detectedType: SupportedC64FileType | "unknown";
  reason: string;
};

export type ValidationResult = ValidationSuccess | ValidationFailure;

export type TransmissionValidationContext = {
  filename?: string;
  operation: string;
  endpoint: string;
  expectedType?: SupportedC64FileType;
};

type Validator = (bytes: Uint8Array) => ValidationResult;

const FILE_TYPE_LABELS: Record<SupportedC64FileType, string> = {
  d64: "D64",
  d71: "D71",
  d81: "D81",
  prg: "PRG",
  sid: "SID",
  mod: "MOD",
  crt: "CRT",
};

const INVALID_REASONS: Record<FileValidationFailureCode, string> = {
  INVALID_SIZE: "invalid size",
  INVALID_BLOCK_COUNT: "invalid block count",
  INVALID_DIRECTORY_LOCATION: "invalid directory location",
  INVALID_DIRECTORY_ENTRY: "invalid directory entry structure",
  INVALID_HEADER_LOCATION: "invalid header location",
  INVALID_MAGIC: "invalid magic header",
  INVALID_VERSION: "invalid version",
  INVALID_DATA_OFFSET: "invalid data offset",
  INVALID_PATTERN_TABLE: "invalid pattern table",
  INVALID_CHIP_HEADER: "invalid CHIP header",
  INVALID_CHIP_PACKET: "invalid CHIP packet",
  INVALID_OUT_OF_BOUNDS: "out-of-bounds read",
  INVALID_PROGRAM_DATA: "missing program data",
  INVALID_SONG_RANGE: "invalid song range",
  INVALID_HEADER_LENGTH: "invalid header length",
  INVALID_FILE_TYPE: "file type does not match the requested operation",
  UNSUPPORTED_FILE_TYPE: "unsupported or unrecognized file type",
};

const DISK_IMAGE_SIZES: Record<"d64" | "d71" | "d81", ReadonlySet<number>> = {
  d64: new Set([174848, 175531, 196608, 197376]),
  d71: new Set([349696, 351062]),
  d81: new Set([819200, 822400]),
};

const VALID_D64_BLOCK_COUNTS = new Set([683, 685, 768, 771]);
const VALID_D71_BLOCK_COUNTS = new Set([1366, 1371]);
const VALID_D81_BLOCK_COUNTS = new Set([3200, 3210]);
const VALID_SID_VERSIONS = new Set([1, 2, 3, 4]);
const VALID_MOD_SIGNATURES = new Set(["M.K.", "M!K!", "M&K!", "FLT8", "OCTA", "OKTA"]);
const CRT_MAGIC = "C64 CARTRIDGE   ";
const VALIDATED_TYPE_PRIORITY: ReadonlyArray<SupportedC64FileType> = ["crt", "sid", "d81", "d71", "d64", "mod", "prg"];
const TYPE_SPECIFICITY: Record<SupportedC64FileType, number> = {
  crt: 4,
  sid: 4,
  d81: 3,
  d71: 3,
  d64: 3,
  mod: 2,
  prg: 1,
};

const success = (detectedType: SupportedC64FileType): ValidationSuccess => ({
  ok: true,
  code: "VALID",
  detectedType,
});

const failure = (
  code: FileValidationFailureCode,
  detectedType: SupportedC64FileType | "unknown",
  reason?: string,
): ValidationFailure => ({
  ok: false,
  code,
  detectedType,
  reason: reason ?? INVALID_REASONS[code],
});

const hasBounds = (bytes: Uint8Array, offset: number, requiredBytes: number) =>
  offset >= 0 && requiredBytes >= 0 && offset + requiredBytes <= bytes.length;

const readAscii = (bytes: Uint8Array, offset: number, length: number) => {
  if (!hasBounds(bytes, offset, length)) {
    return null;
  }
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
};

const readLE16 = (bytes: Uint8Array, offset: number) => {
  if (!hasBounds(bytes, offset, 2)) {
    return null;
  }
  return bytes[offset]! + 256 * bytes[offset + 1]!;
};

const readBE16 = (bytes: Uint8Array, offset: number) => {
  if (!hasBounds(bytes, offset, 2)) {
    return null;
  }
  return 256 * bytes[offset]! + bytes[offset + 1]!;
};

const readBE32 = (bytes: Uint8Array, offset: number) => {
  if (!hasBounds(bytes, offset, 4)) {
    return null;
  }
  return bytes[offset]! * 16777216 + bytes[offset + 1]! * 65536 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
};

const validateD64: Validator = (bytes) => {
  if (!DISK_IMAGE_SIZES.d64.has(bytes.length)) {
    return failure("INVALID_SIZE", "d64");
  }
  const blockCount = Math.floor(bytes.length / 256);
  if (!VALID_D64_BLOCK_COUNTS.has(blockCount)) {
    return failure("INVALID_BLOCK_COUNT", "d64");
  }
  const dirBlock = 18 * 256;
  if (!hasBounds(bytes, dirBlock, 256)) {
    return failure("INVALID_DIRECTORY_LOCATION", "d64");
  }
  for (let entryIndex = 0; entryIndex < 8; entryIndex += 1) {
    const entryOffset = dirBlock + 2 + entryIndex * 32;
    if (!hasBounds(bytes, entryOffset, 32)) {
      return failure("INVALID_DIRECTORY_ENTRY", "d64");
    }
  }
  return success("d64");
};

const validateD71: Validator = (bytes) => {
  if (!DISK_IMAGE_SIZES.d71.has(bytes.length)) {
    return failure("INVALID_SIZE", "d71");
  }
  const blockCount = Math.floor(bytes.length / 256);
  if (!VALID_D71_BLOCK_COUNTS.has(blockCount)) {
    return failure("INVALID_BLOCK_COUNT", "d71");
  }
  const dirBlock = 18 * 256;
  if (!hasBounds(bytes, dirBlock, 256)) {
    return failure("INVALID_DIRECTORY_LOCATION", "d71");
  }
  return success("d71");
};

const validateD81: Validator = (bytes) => {
  if (!DISK_IMAGE_SIZES.d81.has(bytes.length)) {
    return failure("INVALID_SIZE", "d81");
  }
  const blockCount = Math.floor(bytes.length / 256);
  if (!VALID_D81_BLOCK_COUNTS.has(blockCount)) {
    return failure("INVALID_BLOCK_COUNT", "d81");
  }
  const headerOffset = 40 * 40 * 256;
  if (!hasBounds(bytes, headerOffset, 256)) {
    return failure("INVALID_HEADER_LOCATION", "d81");
  }
  return success("d81");
};

const validatePrg: Validator = (bytes) => {
  if (bytes.length < 2) {
    return failure("INVALID_SIZE", "prg");
  }
  if (readLE16(bytes, 0) === null) {
    return failure("INVALID_OUT_OF_BOUNDS", "prg");
  }
  if (bytes.length - 2 < 1) {
    return failure("INVALID_PROGRAM_DATA", "prg");
  }
  return success("prg");
};

const validateSid: Validator = (bytes) => {
  if (bytes.length < 0x76) {
    return failure("INVALID_SIZE", "sid");
  }
  const magic = readAscii(bytes, 0, 4);
  if (magic !== "PSID" && magic !== "RSID") {
    return failure("INVALID_MAGIC", "sid");
  }
  const version = readBE16(bytes, 4);
  if (version === null) {
    return failure("INVALID_OUT_OF_BOUNDS", "sid");
  }
  if (!VALID_SID_VERSIONS.has(version)) {
    return failure("INVALID_VERSION", "sid");
  }
  const dataOffset = readBE16(bytes, 6);
  if (dataOffset === null) {
    return failure("INVALID_OUT_OF_BOUNDS", "sid");
  }
  if (dataOffset >= bytes.length) {
    return failure("INVALID_DATA_OFFSET", "sid");
  }
  const songs = readBE16(bytes, 14);
  const startSong = readBE16(bytes, 16);
  if (songs === null || startSong === null) {
    return failure("INVALID_OUT_OF_BOUNDS", "sid");
  }
  if (songs < 1 || startSong < 1 || startSong > songs) {
    return failure("INVALID_SONG_RANGE", "sid");
  }
  return success("sid");
};

const validateMod: Validator = (bytes) => {
  if (bytes.length < 1084) {
    return failure("INVALID_SIZE", "mod");
  }
  const signature = readAscii(bytes, 1080, 4);
  if (signature === null) {
    return failure("INVALID_OUT_OF_BOUNDS", "mod");
  }
  if (!VALID_MOD_SIGNATURES.has(signature)) {
    return failure("INVALID_MAGIC", "mod");
  }
  if (!hasBounds(bytes, 952, 128)) {
    return failure("INVALID_OUT_OF_BOUNDS", "mod");
  }
  let maxPattern = 0;
  for (let index = 952; index < 1080; index += 1) {
    maxPattern = Math.max(maxPattern, bytes[index]!);
  }
  if (maxPattern > 127) {
    return failure("INVALID_PATTERN_TABLE", "mod");
  }
  return success("mod");
};

const validateCrt: Validator = (bytes) => {
  if (bytes.length < 64) {
    return failure("INVALID_SIZE", "crt");
  }
  const magic = readAscii(bytes, 0, 16);
  if (magic !== CRT_MAGIC) {
    return failure("INVALID_MAGIC", "crt");
  }
  const headerLength = readBE32(bytes, 16);
  if (headerLength === null) {
    return failure("INVALID_OUT_OF_BOUNDS", "crt");
  }
  if (headerLength !== 64) {
    return failure("INVALID_HEADER_LENGTH", "crt");
  }
  const version = readBE16(bytes, 20);
  if (version === null) {
    return failure("INVALID_OUT_OF_BOUNDS", "crt");
  }
  if (version !== 0x0100 && version !== 0x0101 && version !== 0x0200) {
    return failure("INVALID_VERSION", "crt");
  }
  let offset = 64;
  while (offset < bytes.length) {
    const chipHeader = readAscii(bytes, offset, 4);
    if (chipHeader === null) {
      return failure("INVALID_OUT_OF_BOUNDS", "crt");
    }
    if (chipHeader !== "CHIP") {
      return failure("INVALID_CHIP_HEADER", "crt");
    }
    const packetLength = readBE32(bytes, offset + 4);
    if (packetLength === null) {
      return failure("INVALID_OUT_OF_BOUNDS", "crt");
    }
    if (packetLength < 16 || offset + packetLength > bytes.length) {
      return failure("INVALID_CHIP_PACKET", "crt");
    }
    offset += packetLength;
  }
  return success("crt");
};

export const FileValidatorRegistry = {
  validators: {
    d64: validateD64,
    d71: validateD71,
    d81: validateD81,
    prg: validatePrg,
    sid: validateSid,
    mod: validateMod,
    crt: validateCrt,
  } satisfies Record<SupportedC64FileType, Validator>,

  validate(type: SupportedC64FileType, bytes: Uint8Array): ValidationResult {
    return this.validators[type](bytes);
  },
};

const detectStrongType = (bytes: Uint8Array): SupportedC64FileType | null => {
  const crtMagic = readAscii(bytes, 0, 16);
  if (crtMagic === CRT_MAGIC) {
    return "crt";
  }
  const sidMagic = readAscii(bytes, 0, 4);
  if (sidMagic === "PSID" || sidMagic === "RSID") {
    return "sid";
  }
  if (DISK_IMAGE_SIZES.d64.has(bytes.length)) {
    return "d64";
  }
  if (DISK_IMAGE_SIZES.d71.has(bytes.length)) {
    return "d71";
  }
  if (DISK_IMAGE_SIZES.d81.has(bytes.length)) {
    return "d81";
  }
  return null;
};

export const FileTypeDetector = {
  detect(bytes: Uint8Array, preferredType?: SupportedC64FileType) {
    return detectStrongType(bytes) ?? preferredType ?? "unknown";
  },
};

const describeType = (type: SupportedC64FileType | "unknown") =>
  type === "unknown" ? "Unknown" : FILE_TYPE_LABELS[type];

const basename = (filename?: string) => {
  if (!filename) {
    return "upload.bin";
  }
  const normalized = filename.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? filename;
};

const buildPopupDescription = (filename: string, reason: string) =>
  `${filename} is structurally invalid (${reason}). Transmission to C64U was aborted.`;

type ReportableValidationError = Error & { c64uHandled?: boolean };

const markHandled = (error: ReportableValidationError) => {
  error.c64uHandled = true;
};

export const isHandledUiError = (error: unknown) =>
  Boolean((error as ReportableValidationError | undefined)?.c64uHandled);

export class FileValidationError extends Error {
  readonly code: FileValidationFailureCode;
  readonly detectedType: SupportedC64FileType | "unknown";
  readonly filename: string;
  readonly attemptedOperation: string;
  readonly endpoint: string;
  readonly validationReason: string;
  c64uHandled?: boolean;

  constructor(context: TransmissionValidationContext, result: ValidationFailure) {
    const filename = basename(context.filename);
    super(`${filename} is structurally invalid (${result.reason}). Transmission to C64U was aborted.`);
    this.name = "FileValidationError";
    this.code = result.code;
    this.detectedType = result.detectedType;
    this.filename = filename;
    this.attemptedOperation = context.operation;
    this.endpoint = context.endpoint;
    this.validationReason = result.reason;
  }
}

export const reportFileValidationFailure = (error: FileValidationError) => {
  if (error.c64uHandled) {
    return;
  }

  addErrorLog(FILE_VALIDATION_FAILED_EVENT, {
    eventType: FILE_VALIDATION_FAILED_EVENT,
    filename: error.filename,
    detectedType: describeType(error.detectedType),
    validationCode: error.code,
    validationError: error.validationReason,
    attemptedOperation: error.attemptedOperation,
    endpoint: error.endpoint,
    transmissionAborted: true,
  });

  toast({
    title: "Upload blocked",
    description: buildPopupDescription(error.filename, error.validationReason),
    variant: "destructive",
  });

  markHandled(error);
};

const validateAgainstType = (type: SupportedC64FileType, bytes: Uint8Array) =>
  FileValidatorRegistry.validate(type, bytes);

const detectValidatedType = (bytes: Uint8Array, excludeType?: SupportedC64FileType): SupportedC64FileType | null => {
  for (const type of VALIDATED_TYPE_PRIORITY) {
    if (type === excludeType) {
      continue;
    }
    if (validateAgainstType(type, bytes).ok) {
      return type;
    }
  }
  return null;
};

export const validateFileBytes = (bytes: Uint8Array, expectedType?: SupportedC64FileType): ValidationResult => {
  const detectedType = FileTypeDetector.detect(bytes, expectedType);
  if (expectedType) {
    const strongType = detectStrongType(bytes);
    if (strongType && strongType !== expectedType) {
      return failure(
        "INVALID_FILE_TYPE",
        strongType,
        `${describeType(strongType)} data cannot be sent via a ${describeType(expectedType)} upload`,
      );
    }
    const expectedResult = validateAgainstType(expectedType, bytes);
    const alternateType = detectValidatedType(bytes, expectedType);

    if (!expectedResult.ok) {
      if (alternateType && TYPE_SPECIFICITY[alternateType] > TYPE_SPECIFICITY[expectedType]) {
        return failure(
          "INVALID_FILE_TYPE",
          alternateType,
          `${describeType(alternateType)} data cannot be sent via a ${describeType(expectedType)} upload`,
        );
      }
      return expectedResult;
    }

    if (alternateType && TYPE_SPECIFICITY[alternateType] > TYPE_SPECIFICITY[expectedType]) {
      return failure(
        "INVALID_FILE_TYPE",
        alternateType,
        `${describeType(alternateType)} data cannot be sent via a ${describeType(expectedType)} upload`,
      );
    }

    return expectedResult;
  }

  if (detectedType === "unknown") {
    return failure("UNSUPPORTED_FILE_TYPE", "unknown");
  }

  return validateAgainstType(detectedType, bytes);
};

export const TransmissionGuard = {
  validateOrThrow(bytes: Uint8Array, context: TransmissionValidationContext) {
    const result = validateFileBytes(bytes, context.expectedType);
    if (result.ok) {
      return result;
    }

    const error = new FileValidationError(context, {
      ...result,
      detectedType: result.detectedType,
    });
    reportFileValidationFailure(error);
    throw error;
  },
};
