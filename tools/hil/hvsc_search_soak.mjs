#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * "Find a tune" latency soak against the shipped UI on a real HVSC.
 *
 * The whole-archive search cannot answer until the browse index is resident, and on a real library
 * that index is 13.2 MB holding 61,165 songs. Every way of getting it wrong looks the same from the
 * outside — the sheet says "Searching…" and never stops — so this measures the thing the listener
 * actually waits for: the time from the query landing in the box to rows being on screen.
 *
 * Timed from the HOST, deliberately. A page-side timer stops firing while the main thread is
 * blocked, which is one of the failures being measured, so an in-page stopwatch would report a
 * number that cannot include the fault. The cost is the CDP round trip, which is tens of
 * milliseconds and is counted against us rather than for us.
 *
 * The first query of a session pays for materialising the index and is reported separately; every
 * query after it should be a scan over memory.
 *
 *   node tools/hil/hvsc_search_soak.mjs [--iterations 100] [--cdp-port 9333]
 *                                       [--first-budget-ms 3000] [--warm-budget-ms 1000]
 *
 * Requires the app foregrounded on the device with `adb forward` pointed at its WebView, and an
 * installed HVSC. Exits non-zero if any iteration misses its budget or produces no rows.
 */

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const CDP_PORT = arg("cdp-port", "9333");
const ITERATIONS = Number(arg("iterations", "100"));
const FIRST_BUDGET_MS = Number(arg("first-budget-ms", "3000"));
const WARM_BUDGET_MS = Number(arg("warm-budget-ms", "1000"));
/** Hard stop per query, well past any budget, so a hang is reported rather than waited out. */
const HANG_MS = 60000;

/**
 * Queries with a spread of result counts, cycled so no two consecutive iterations repeat.
 *
 * A single repeated query would let any per-query memoisation stand in for the index being
 * resident, which is the opposite of what this is checking.
 */
const QUERIES = [
  "commando",
  "hubbard",
  "galway",
  "last ninja",
  "monty",
  "delta",
  "wizball",
  "cybernoid",
  "sanxion",
  "parallax",
  "zoolook",
  "myth",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One CDP socket for the whole run.
 *
 * A process per evaluation would add a node start-up to every poll — three hundred milliseconds
 * charged against a one-second budget — and would turn any moment the page is busy into a dead
 * harness rather than a slow poll.
 */
const connect = async () => {
  const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) ?? targets[0];
  if (!page) throw new Error(`no CDP page on port ${CDP_PORT}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = message.id ? pending.get(message.id) : null;
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  const send = (method, params = {}, timeoutMs) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`cdp timeout: ${method}`));
      }, timeoutMs);
    });
  await send("Runtime.enable", {}, 30000);
  return {
    evaluate: async (expression, timeoutMs = 30000) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      }
      const value = result.result.value;
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    },
    close: () => socket.close(),
  };
};

let client = null;

/** Evaluate, retrying briefly: a page that is momentarily busy is a slow poll, not a dead run. */
const evaluate = async (expression, timeoutMs = 30000) => {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.evaluate(expression, timeoutMs);
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw lastError;
};

const READ = `(()=>{const q=(id)=>document.querySelector('[data-testid="'+id+'"]');
 const r=q("hvsc-search-results"); const input=q("hvsc-search-input");
 const t=r?r.innerText:"";
 return JSON.stringify({sheet:!!q("hvsc-search-sheet"), value:input?input.value:null,
   rows:document.querySelectorAll('[data-testid="hvsc-search-play"]').length,
   recent:t.indexOf("Recently played")>=0,
   none:t.indexOf("Nothing found")>=0||t.indexOf("not ready")>=0});})()`;

const setQuery = (query) =>
  evaluate(`(()=>{const f=document.querySelector('[data-testid="hvsc-search-input"]');
   if(!f) return "no-input";
   const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
   set.call(f,${JSON.stringify(query)}); f.dispatchEvent(new Event("input",{bubbles:true})); return "ok";})()`);

/**
 * Refuse to measure a page the browser has suspended.
 *
 * Chromium stops firing timers in a hidden page, and the search debounce is a timer — so a phone
 * that has locked itself produces a box that says "Searching…" and never moves, which is
 * indistinguishable from the fault this exists to catch. It cost hours of chasing an app bug that
 * was a lock screen. `adb shell wm dismiss-keyguard` is the fix; `svc power stayon usb` keeps the
 * screen lit but does NOT dismiss the keyguard.
 */
const assertPageVisible = async () => {
  const visibility = await evaluate(`(()=>JSON.stringify({hidden:document.hidden,state:document.visibilityState}))()`);
  if (visibility.hidden) {
    throw new Error(
      `the WebView is ${visibility.state}: Chromium suspends timers there, so the search debounce never fires. ` +
        `Run "adb shell wm dismiss-keyguard" and try again.`,
    );
  }
};

const openSheet = async () => {
  await assertPageVisible();
  const before = await evaluate(READ);
  if (before.sheet) return;
  await evaluate(`(()=>{const t=document.querySelector('[data-testid="tab-play"]'); if(t) t.click(); return 1})()`);
  await sleep(3500);
  await evaluate(
    `(()=>{const t=document.querySelector('[data-testid="hvsc-search-open"]'); if(t) t.click(); return 1})()`,
  );
  await sleep(2500);
  const after = await evaluate(READ);
  if (!after.sheet) throw new Error("could not open the Find a tune sheet");
};

/** One query, from the keystroke to rows on screen. */
const runQuery = async (query) => {
  await setQuery("");
  await sleep(350);
  const startedAt = Date.now();
  await setQuery(query);
  while (Date.now() - startedAt < HANG_MS) {
    let state;
    try {
      state = await evaluate(READ, HANG_MS);
    } catch {
      continue;
    }
    if (!state.recent && (state.rows > 0 || state.none)) {
      return { query, ms: Date.now() - startedAt, rows: state.rows, empty: state.none };
    }
    await sleep(25);
  }
  // A query that ran out of time is only evidence if the page was awake for all of it.
  await assertPageVisible();
  return { query, ms: null, rows: 0, empty: false };
};

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const main = async () => {
  client = await connect();
  console.log(
    `HVSC search soak — ${ITERATIONS} iterations, first ≤ ${FIRST_BUDGET_MS} ms, warm ≤ ${WARM_BUDGET_MS} ms`,
  );
  await openSheet();

  const failures = [];
  const warm = [];
  let first = null;

  for (let index = 0; index < ITERATIONS; index += 1) {
    const query = QUERIES[index % QUERIES.length];
    const result = await runQuery(query);
    const budget = index === 0 ? FIRST_BUDGET_MS : WARM_BUDGET_MS;

    if (result.ms === null) {
      failures.push(`#${index + 1} "${query}": no results within ${HANG_MS} ms`);
    } else if (result.rows === 0 && !result.empty) {
      failures.push(`#${index + 1} "${query}": finished with no rows`);
    } else if (result.ms > budget) {
      failures.push(`#${index + 1} "${query}": ${result.ms} ms exceeds the ${budget} ms budget`);
    }

    if (index === 0) first = result;
    else if (result.ms !== null) warm.push(result.ms);

    if (index === 0 || (index + 1) % 10 === 0 || result.ms === null || result.ms > budget) {
      console.log(
        `  #${String(index + 1).padStart(3)} ${query.padEnd(11)} ${String(result.ms ?? "HANG").padStart(6)} ms  rows=${result.rows}`,
      );
    }
  }

  const sorted = [...warm].sort((a, b) => a - b);
  console.log(`\nfirst query:   ${first?.ms ?? "HANG"} ms (rows=${first?.rows ?? 0})`);
  if (sorted.length) {
    const mean = Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length);
    console.log(
      `warm queries:  n=${sorted.length} min=${sorted[0]} p50=${percentile(sorted, 50)} p95=${percentile(sorted, 95)} max=${sorted[sorted.length - 1]} mean=${mean} ms`,
    );
  }
  console.log(`\n${ITERATIONS - failures.length}/${ITERATIONS} within budget`);
  client.close();
  if (failures.length) {
    console.error(`\nFAILURES:\n- ${failures.slice(0, 20).join("\n- ")}`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(`fatal: ${error.message}`);
  process.exit(2);
});
