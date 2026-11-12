/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

const logIndexedDbFailure = (message: string, details: Record<string, unknown>, error: unknown) =>
  addLog("warn", message, {
    ...details,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

/**
 * Opens a database and rejects, with a logged contextual error, when the open errors or is blocked
 * by another connection. A blocked open fires no success or error event until the other connection
 * closes, so without the blocked handler its caller waits indefinitely. A connection that opens
 * after the caller was already rejected is closed so it cannot block a later upgrade.
 */
export const openIndexedDb = (
  name: string,
  version: number,
  upgrade: (database: IDBDatabase) => void,
): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    let rejected = false;
    const rejectOnce = (error: Error) => {
      rejected = true;
      reject(error);
    };
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      if (rejected) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => {
      const error = request.error ?? new Error("IndexedDB open failed");
      logIndexedDbFailure("IndexedDB open failed", { dbName: name, version }, error);
      rejectOnce(error);
    };
    request.onblocked = () => {
      const error = new Error(`IndexedDB open of ${name} (version ${version}) is blocked by another open connection`);
      logIndexedDbFailure("IndexedDB open blocked", { dbName: name, version }, error);
      rejectOnce(error);
    };
  });

/** Rejects a read when its transaction aborts without any request reporting an error. */
export const rejectOnTransactionAbort = (
  transaction: IDBTransaction,
  reject: (error: Error) => void,
  description: string,
) => {
  transaction.onabort = () => {
    const error = transaction.error ?? new Error(`IndexedDB ${description} transaction aborted`);
    logIndexedDbFailure("IndexedDB read transaction aborted", { description }, error);
    reject(error);
  };
};
