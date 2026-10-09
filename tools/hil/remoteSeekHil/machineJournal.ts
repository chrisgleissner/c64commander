/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What a seek HIL run changes on a real machine, written down before it changes anything.
 *
 * A run that is killed never reaches its own `finally`, and a killed run in the middle of a jump has
 * left a key held, a raised CPU Speed, a muted Vol Master and another System Mode behind. The journal
 * survives the kill, and `npx tsx tools/hil/remoteSeekHil/machineJournal.ts <host>` puts the machine
 * back from it. A run that restores and reads back every setting removes the journal itself.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const JOURNAL_DIR = "artifacts/hil-journal";

/** Category, item and the value the machine had before the run. */
export type JournalEntry = [category: string, item: string, value: string];

const journalPath = (host: string) => path.join(JOURNAL_DIR, `${host}.json`);

const configUrl = (host: string, category: string, item: string, value?: string) =>
  `http://${host}/v1/configs/${encodeURIComponent(category)}/${encodeURIComponent(item)}` +
  (value === undefined ? "" : `?value=${encodeURIComponent(value)}`);

const readItem = async (host: string, category: string, item: string): Promise<string | null> => {
  const response = await fetch(configUrl(host, category, item), { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const body = (await response.json()) as Record<string, Record<string, { current?: string }>>;
  return body[category]?.[item]?.current ?? null;
};

/** Record the items the run may change, unless an earlier killed run's journal is still waiting. */
export const openMachineJournal = async (host: string, items: Array<[string, string]>): Promise<void> => {
  if (existsSync(journalPath(host)))
    throw new Error(`${journalPath(host)} is left from a run that did not finish; restore ${host} from it first`);
  const entries: JournalEntry[] = [];
  for (const [category, item] of items) {
    const value = await readItem(host, category, item);
    if (value !== null) entries.push([category, item, value]);
  }
  mkdirSync(JOURNAL_DIR, { recursive: true });
  writeFileSync(journalPath(host), JSON.stringify(entries, null, 2));
};

/**
 * Release every key, write back each journalled value, read them back, and remove the journal once
 * all match. Returns what still differs.
 */
export const restoreFromMachineJournal = async (host: string): Promise<string[]> => {
  if (!existsSync(journalPath(host))) return [];
  const entries = JSON.parse(readFileSync(journalPath(host), "utf8")) as JournalEntry[];
  await fetch(`http://${host}/v1/machine:input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: [{ kind: "keyboard", inputs: ["arrow_left"], transition: "release" }] }),
    signal: AbortSignal.timeout(8000),
  }).catch((error: unknown) => console.warn(`could not release the keys on ${host}: ${String(error)}`));
  const differing: string[] = [];
  for (const [category, item, value] of entries) {
    if ((await readItem(host, category, item)) !== value)
      await fetch(configUrl(host, category, item, value), { method: "PUT", signal: AbortSignal.timeout(8000) });
    const now = await readItem(host, category, item);
    if (now !== value) differing.push(`${item} is ${JSON.stringify(now)}, was ${JSON.stringify(value)}`);
  }
  if (differing.length === 0) rmSync(journalPath(host));
  return differing;
};

if (process.argv[1]?.endsWith("machineJournal.ts") && process.argv[2]) {
  const host = process.argv[2];
  const differing = await restoreFromMachineJournal(host);
  console.log(differing.length ? `${host}: still differs: ${differing.join("; ")}` : `${host}: as journalled`);
  process.exit(differing.length ? 1 : 0);
}
