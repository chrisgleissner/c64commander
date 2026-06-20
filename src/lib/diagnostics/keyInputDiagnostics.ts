/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Key-event diagnostics for keypad / T9 input calibration.
 *
 * Emits a `key-input` debug log so a maintainer can read an exported diagnostics
 * bundle and see exactly how a real device's keys arrived (raw `key`/`code`/
 * `keyCode`) and how they normalized ({@link SemanticAction}), so missing
 * bindings can be added from the export. It deliberately:
 *   - emits ONLY for navigation/activation/back keys and unmapped keys (from the
 *     global handler, which never sees editable targets → never typed text), and
 *     for composer-consumed keys (from `useT9Input`). Never per-keystroke typing.
 *   - logs lengths/indices for T9 state, NEVER raw text or the field value.
 *   - redacts the key IDENTITY (`key`/`code`/`keyCode`/`which`/`normalizedAction`)
 *     when {@link KeyInputDiagnosticsParams.redactKeyIdentity} is set — the
 *     composer path (`useT9Input`) uses this so a field's typed characters are
 *     never reconstructable from the log, while `keyFamily` (digit/star/…) is
 *     retained for calibration grouping. The global handler leaves it unset
 *     because it only ever sees non-editable targets (nav keys, never text).
 *   - cheap-gates on {@link loadDebugLoggingEnabled} + suppression BEFORE building
 *     the details object, so the hot keydown path allocates nothing when off.
 *   - structures `details` so the existing recursive export redactor sanitizes
 *     anything sensitive by key name; digit/star/hash/nav keys are mapping-
 *     critical and logged verbatim.
 */

import type { InputModality } from "@/lib/input";
import type { SemanticAction } from "@/lib/input";
import { addLog } from "@/lib/logging";
import { loadDebugLoggingEnabled } from "@/lib/config/appSettings";
import { shouldSuppressDiagnosticsSideEffects } from "@/lib/diagnostics/diagnosticsOverlayState";

/** The "family" of a physical key, for grouping mapping calibration by hardware. */
export type KeyFamily =
  | "digit"
  | "numpad-digit"
  | "dpad"
  | "enter"
  | "delete"
  | "star"
  | "hash"
  | "modifier"
  | "unknown";

/** Reasons a recognized key did not produce an effect (logged when `handled` is false). */
export type KeyInputIgnoredReason =
  | "setting-disabled"
  | "pointer-modality"
  | "no-binding"
  | "editable-target-passthrough"
  | "ignored-by-controller";

/** Structural subset of a raw (native or React synthetic) keyboard event we record. */
export interface KeyInputRawEvent {
  readonly type?: string;
  readonly key?: string;
  readonly code?: string;
  readonly keyCode?: number;
  readonly which?: number;
  readonly location?: number;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

/** Lengths/indices only — NEVER the pending/committed text itself. */
export interface KeyInputT9State {
  readonly active: boolean;
  readonly mode: string;
  readonly pendingLength: number;
  readonly candidateIndex: number;
  readonly candidateCount: number;
  readonly committedLength: number;
}

export interface KeyInputDiagnosticsParams {
  readonly rawEvent: KeyInputRawEvent;
  readonly normalizedAction: SemanticAction | null;
  readonly handled: boolean;
  readonly ignoredReason?: KeyInputIgnoredReason;
  readonly preventDefaultApplied: boolean;
  readonly keypadEnabled: boolean;
  readonly modality: InputModality;
  readonly selectedControlId?: string | null;
  readonly activeElement?: Element | null;
  readonly t9State?: KeyInputT9State;
  /**
   * When true, the key identity (`key`/`code`/`keyCode`/`which` and
   * `normalizedAction`) is withheld from the emitted details so a field's typed
   * characters cannot be reconstructed from a diagnostics export. `keyFamily` is
   * still recorded (it groups by hardware, e.g. "digit", without revealing which
   * digit). Set by the field composer path; left unset by the global nav handler.
   */
  readonly redactKeyIdentity?: boolean;
}

const DIGIT_CODE = /^Digit[0-9]$/;
const NUMPAD_DIGIT_CODE = /^Numpad[0-9]$/;
const DPAD_CODE = /^(Arrow(Up|Down|Left|Right)|Dpad(Up|Down|Left|Right|Center))$/;
const MODIFIER_CODE = /^(Shift|Control|Alt|Meta)(Left|Right)?$/;
const SINGLE_DIGIT_KEY = /^[0-9]$/;

const DPAD_ACTIONS = new Set<SemanticAction>(["dpadUp", "dpadDown", "dpadLeft", "dpadRight", "center"]);

/**
 * Classifies the physical key for calibration grouping. Numpad digits are
 * distinguished from the top-row digits because real keypads emit either.
 */
export const resolveKeyFamily = (event: KeyInputRawEvent, action: SemanticAction | null): KeyFamily => {
  const code = event.code ?? "";
  const key = event.key ?? "";
  if (NUMPAD_DIGIT_CODE.test(code)) return "numpad-digit";
  if (DIGIT_CODE.test(code) || SINGLE_DIGIT_KEY.test(key)) return "digit";
  if ((action && DPAD_ACTIONS.has(action)) || DPAD_CODE.test(code)) return "dpad";
  if (action === "enter" || code === "Enter" || code === "NumpadEnter") return "enter";
  if (action === "delete" || code === "Backspace" || code === "Delete") return "delete";
  if (action === "star" || key === "*" || code === "NumpadMultiply") return "star";
  if (action === "hash" || key === "#") return "hash";
  if (MODIFIER_CODE.test(code)) return "modifier";
  return "unknown";
};

interface ActiveElementInfo {
  readonly tagName: string | null;
  readonly role: string | null;
  readonly ariaLabel: string | null;
  readonly dataTestId: string | null;
  readonly inputType: string | null;
}

/**
 * Describes the focused element by its structural/semantic attributes only. The
 * global handler only ever logs non-editable targets, so `ariaLabel` is a static
 * control label (never field text); the field value is never read.
 */
export const describeActiveElement = (element: Element | null | undefined): ActiveElementInfo | null => {
  if (!element) return null;
  const inputType = element instanceof HTMLInputElement ? element.type : (element.getAttribute("type") ?? null);
  return {
    tagName: element.tagName ?? null,
    role: element.getAttribute("role"),
    ariaLabel: element.getAttribute("aria-label"),
    dataTestId: element.getAttribute("data-testid"),
    inputType,
  };
};

const resolveRoute = (): string => {
  if (typeof window === "undefined") return "";
  return window.location?.pathname ?? "";
};

/**
 * Builds the `key-input` details object. Exported for unit testing; callers
 * should prefer {@link emitKeyInputDiagnostics}, which cheap-gates first.
 */
export const buildKeyInputDetails = (params: KeyInputDiagnosticsParams): Record<string, unknown> => {
  const { rawEvent, redactKeyIdentity = false } = params;
  // Classify the physical key BEFORE redaction so calibration grouping stays
  // correct even when the key's identity is withheld from the log.
  const keyFamily = resolveKeyFamily(rawEvent, params.normalizedAction);
  const details: Record<string, unknown> = {
    category: "key-input",
    timestamp: Date.now(),
    route: resolveRoute(),
    activeElement: describeActiveElement(params.activeElement),
    selectedControlId: params.selectedControlId ?? null,
    rawEvent: {
      type: rawEvent.type ?? null,
      key: redactKeyIdentity ? null : (rawEvent.key ?? null),
      code: redactKeyIdentity ? null : (rawEvent.code ?? null),
      keyCode: redactKeyIdentity ? null : (rawEvent.keyCode ?? null),
      which: redactKeyIdentity ? null : (rawEvent.which ?? null),
      location: rawEvent.location ?? null,
      repeat: Boolean(rawEvent.repeat),
      isComposing: Boolean(rawEvent.isComposing),
      altKey: Boolean(rawEvent.altKey),
      ctrlKey: Boolean(rawEvent.ctrlKey),
      metaKey: Boolean(rawEvent.metaKey),
      shiftKey: Boolean(rawEvent.shiftKey),
    },
    normalizedAction: redactKeyIdentity ? null : params.normalizedAction,
    keyFamily,
    handled: params.handled,
    preventDefaultApplied: params.preventDefaultApplied,
    keypadEnabled: params.keypadEnabled,
    modality: params.modality,
  };
  if (!params.handled && params.ignoredReason) {
    details.ignoredReason = params.ignoredReason;
  }
  if (params.t9State) {
    details.t9State = params.t9State;
  }
  return details;
};

/**
 * Emits a `key-input` debug log iff debug logging is on and diagnostics
 * side-effects are not suppressed. The gate runs BEFORE the details object is
 * built, so the hot keydown path allocates nothing when debug logging is off.
 */
export const emitKeyInputDiagnostics = (params: KeyInputDiagnosticsParams): void => {
  if (!loadDebugLoggingEnabled()) return;
  if (shouldSuppressDiagnosticsSideEffects()) return;
  addLog("debug", "key-input", buildKeyInputDetails(params));
};
