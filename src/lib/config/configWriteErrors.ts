/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ConfigWriteFailureCode =
  "CONFIG_ITEM_NOT_FOUND" | "INVALID_ENUM_VALUE" | "INVALID_NUMERIC_VALUE" | "OUT_OF_RANGE" | "FIRMWARE_WRITE_REJECTED";

type ConfigWriteErrorContext = {
  category?: string;
  item?: string;
  value?: string | number;
  payload?: Record<string, Record<string, string | number>>;
  firmwareErrors?: string[];
  options?: string[];
  min?: number;
  max?: number;
};

export class ConfigWriteError extends Error {
  readonly code: ConfigWriteFailureCode;
  readonly category?: string;
  readonly item?: string;
  readonly value?: string | number;
  readonly payload?: Record<string, Record<string, string | number>>;
  readonly firmwareErrors?: string[];
  readonly options?: string[];
  readonly min?: number;
  readonly max?: number;

  constructor(code: ConfigWriteFailureCode, message: string, context: ConfigWriteErrorContext = {}) {
    super(message);
    this.name = "ConfigWriteError";
    this.code = code;
    this.category = context.category;
    this.item = context.item;
    this.value = context.value;
    this.payload = context.payload;
    this.firmwareErrors = context.firmwareErrors;
    this.options = context.options;
    this.min = context.min;
    this.max = context.max;
  }
}

export class ConfigWriteValidationError extends ConfigWriteError {
  constructor(
    code: Exclude<ConfigWriteFailureCode, "FIRMWARE_WRITE_REJECTED">,
    message: string,
    context: ConfigWriteErrorContext,
  ) {
    super(code, message, context);
    this.name = "ConfigWriteValidationError";
  }
}

export class FirmwareConfigWriteError extends ConfigWriteError {
  constructor(message: string, context: ConfigWriteErrorContext) {
    super("FIRMWARE_WRITE_REJECTED", message, context);
    this.name = "FirmwareConfigWriteError";
  }
}
