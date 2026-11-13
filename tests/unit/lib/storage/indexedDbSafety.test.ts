/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import { openIndexedDb, rejectOnTransactionAbort } from "@/lib/storage/indexedDbSafety";

type FakeRequest = {
  result?: unknown;
  error?: Error | null;
  onsuccess?: () => void;
  onerror?: () => void;
  onblocked?: () => void;
  onupgradeneeded?: () => void;
};

const stubOpen = () => {
  const request: FakeRequest = {};
  vi.stubGlobal("indexedDB", { open: () => request });
  return request;
};

const settles = (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(
      () => "resolved",
      (error: Error) => error,
    ),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 200)),
  ]);

describe("openIndexedDb", () => {
  beforeEach(() => vi.mocked(addLog).mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it("rejects with a contextual error and logs a warning when the open is blocked", async () => {
    const request = stubOpen();
    const pending = openIndexedDb("playlist-db", 3, () => undefined);
    request.onblocked?.();

    const outcome = await settles(pending);

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe(
      "IndexedDB open of playlist-db (version 3) is blocked by another open connection",
    );
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "IndexedDB open blocked",
      expect.objectContaining({ dbName: "playlist-db", version: 3, stack: expect.any(String) }),
    );
  });

  it("closes a connection that opens after the open was rejected as blocked", async () => {
    const request = stubOpen();
    const pending = openIndexedDb("playlist-db", 3, () => undefined);
    request.onblocked?.();
    await settles(pending);
    const close = vi.fn();
    request.result = { close };

    request.onsuccess?.();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("logs and rejects with the request error when the open fails", async () => {
    const request = stubOpen();
    const pending = openIndexedDb("playlist-db", 3, () => undefined);
    request.error = new Error("UnknownError");
    request.onerror?.();

    expect(await settles(pending)).toBe(request.error);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "IndexedDB open failed",
      expect.objectContaining({ dbName: "playlist-db" }),
    );
  });

  it("resolves with the database and runs the upgrade callback", async () => {
    const request = stubOpen();
    const database = { close: vi.fn() };
    const upgrade = vi.fn();
    const pending = openIndexedDb("playlist-db", 3, upgrade);
    request.result = database;
    request.onupgradeneeded?.();
    request.onsuccess?.();

    await expect(pending).resolves.toBe(database);
    expect(upgrade).toHaveBeenCalledWith(database);
  });
});

describe("rejectOnTransactionAbort", () => {
  beforeEach(() => vi.mocked(addLog).mockClear());

  it("rejects with the transaction error and logs a warning when a read transaction aborts", () => {
    const transaction = { error: new Error("QuotaExceededError") } as unknown as IDBTransaction;
    const reject = vi.fn();
    rejectOnTransactionAbort(transaction, reject, "ranking read");

    transaction.onabort?.(new Event("abort"));

    expect(reject).toHaveBeenCalledWith(transaction.error);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "IndexedDB read transaction aborted",
      expect.objectContaining({ description: "ranking read", error: "QuotaExceededError" }),
    );
  });

  it("falls back to a described error when the aborted transaction carries none", () => {
    const transaction = { error: null } as unknown as IDBTransaction;
    const reject = vi.fn();
    rejectOnTransactionAbort(transaction, reject, "orphan sweep");

    transaction.onabort?.(new Event("abort"));

    expect(reject).toHaveBeenCalledWith(
      expect.objectContaining({ message: "IndexedDB orphan sweep transaction aborted" }),
    );
  });

  it("rejects with a described error when the failed open carries no request error", async () => {
    const request = stubOpen();
    const pending = openIndexedDb("playlist-db", 3, () => undefined);
    request.error = null;
    request.onerror?.();

    const outcome = await settles(pending);

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe("IndexedDB open failed");
  });

  it("logs the text of a request error that is not an Error, without a stack", async () => {
    const request = stubOpen();
    const pending = openIndexedDb("playlist-db", 3, () => undefined);
    request.error = "plain failure" as unknown as Error;
    request.onerror?.();
    await settles(pending);

    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "IndexedDB open failed",
      expect.objectContaining({ error: "plain failure", stack: undefined }),
    );
  });
});
