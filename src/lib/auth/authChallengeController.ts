/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { applyC64APIConfigFromStorage } from "@/lib/c64api";
import { isAuthRequiredError } from "@/lib/c64api/transportErrors";
import { verifyCurrentConnectionTarget } from "@/lib/connection/connectionManager";
import { addLog } from "@/lib/logging";
import { setPassword, setPasswordForDevice } from "@/lib/secureStorage";
import {
  dismissAuthChallenge,
  getAuthChallengeRetry,
  getAuthChallengeSnapshot,
  resolveAuthChallenge,
  setAuthChallengeError,
  setAuthChallengeStatus,
} from "@/lib/auth/authChallenge";

const EMPTY_PASSWORD_MESSAGE = "Enter the network password for this device.";
const WRONG_PASSWORD_MESSAGE = "The device rejected that password. Check it on the device and try again.";
const UNREACHABLE_MESSAGE = "Saved the password, but the device didn't respond — it may be busy. Try again.";
const GENERIC_FAILURE_MESSAGE = "Couldn't apply the password. Check the connection and try again.";

type RecoveryOutcome = "recovered" | "auth-rejected" | "unreachable";

/**
 * Recover from a Forbidden device by applying a user-entered network password.
 *
 * Stores the password for the affected device, re-applies the runtime config so
 * the live REST client sends it, then re-probes the device. On success the
 * challenge closes; a continued 401/403 re-prompts (and the device is never
 * marked healthy). The password is only ever passed to secure storage / the
 * X-Password header — it is never written to logs, diagnostics, or evidence.
 *
 * @returns true when the device accepted the password and recovered.
 */
export const submitAuthChallengePassword = async (rawPassword: string): Promise<boolean> => {
  const challenge = getAuthChallengeSnapshot();
  if (!challenge) return false;

  const password = rawPassword.trim();
  if (!password) {
    setAuthChallengeError(EMPTY_PASSWORD_MESSAGE);
    return false;
  }

  setAuthChallengeStatus("submitting");
  try {
    if (challenge.deviceId) {
      await setPasswordForDevice(challenge.deviceId, password);
    } else {
      await setPassword(password);
    }
    await applyC64APIConfigFromStorage();

    const outcome = await runRecoveryProbe();
    if (outcome === "recovered") {
      resolveAuthChallenge();
      return true;
    }
    // Still Forbidden → wrong password. A transient/unreachable failure is NOT a
    // wrong password (the C64U drops out intermittently); say so honestly. Either
    // way we never mark the device healthy, and a later successful call auto-closes
    // this popup via notifyAuthSatisfied().
    setAuthChallengeError(outcome === "auth-rejected" ? WRONG_PASSWORD_MESSAGE : UNREACHABLE_MESSAGE);
    return false;
  } catch (error) {
    // SECRET HANDLING: never include the password in any log payload.
    addLog("warn", "Auth challenge password submission failed", {
      deviceId: challenge.deviceId,
      host: challenge.host,
      authRequired: isAuthRequiredError(error),
      error: error instanceof Error ? error.message : String(error ?? "unknown error"),
    });
    setAuthChallengeError(isAuthRequiredError(error) ? WRONG_PASSWORD_MESSAGE : GENERIC_FAILURE_MESSAGE);
    return false;
  }
};

/**
 * Retry the original operation when one was captured; otherwise re-probe the
 * active connection. Distinguishes three outcomes so the popup messaging is
 * honest: `recovered` (device accepted the password), `auth-rejected` (still
 * 401/403 → wrong password), or `unreachable` (a non-auth failure — the device
 * may simply be busy/dropped, which must NOT be reported as a wrong password).
 */
const runRecoveryProbe = async (): Promise<RecoveryOutcome> => {
  const retry = getAuthChallengeRetry();
  if (retry) {
    try {
      await retry();
      return "recovered";
    } catch (error) {
      return isAuthRequiredError(error) ? "auth-rejected" : "unreachable";
    }
  }
  const result = await verifyCurrentConnectionTarget();
  if (result.ok === true) return "recovered";
  return isAuthRequiredError(result.error) ? "auth-rejected" : "unreachable";
};

export const cancelAuthChallenge = (): void => {
  dismissAuthChallenge();
};
