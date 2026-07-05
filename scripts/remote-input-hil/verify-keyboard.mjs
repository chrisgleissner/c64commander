// Verifies the keyboard by driving it with REAL touch and asserting the typed
// text lands in the C64's screen RAM (READY echoes typed chars) — machine-level
// proof the keystrokes reached the actual C64, not just the firmware.
import { openApp } from "./app-touch.mjs";
import { reset, readScreenRows } from "./c64u.mjs";

const PHRASE = "HELLO WORLD 42"; // letters + space + digits

const testidFor = (ch) => {
  if (ch === " ") return "remote-input-key-space";
  return `remote-input-key-${ch.toLowerCase()}`;
};

const a = await openApp(process.argv[2]);

// Fresh machine so the phrase lands on a known, empty area.
await reset();
await a.sleep(4000); // reboot to READY

// Ensure sheet open + Keys mode.
if (!(await a.evaluate(`!!document.querySelector('[data-testid="remote-input-sheet"]')`))) {
  await a.evaluate(`document.querySelector('[data-testid="home-machine-inline-openRemoteInput"]')?.click()`);
  await a.sleep(900);
}
await a.tap("remote-input-mode-type");
await a.sleep(600);

// Type each character by real touch (scrolling it into view first).
const typed = [];
for (const ch of PHRASE) {
  const testid = testidFor(ch);
  const exists = await a.evaluate(`!!document.querySelector('[data-testid=${JSON.stringify(testid)}]')`);
  if (!exists) {
    typed.push({ ch, testid, missing: true });
    continue;
  }
  await a.tapKey(testid);
  typed.push({ ch, testid });
}

await a.sleep(600);
const rows = await readScreenRows(0, 12);
const screen = rows.join("\n");
const found = rows.some((line) => line.includes(PHRASE));

console.log("KEYBOARD VERIFICATION (real touch -> C64 screen RAM):");
console.log("  phrase typed:", PHRASE);
console.log("  missing key testids:", typed.filter((t) => t.missing).map((t) => t.testid));
console.log("  screen (rows 0-11):");
rows.forEach((l, i) => console.log("   " + String(i).padStart(2) + " |" + l + "|"));
console.log(found ? `PASS: phrase "${PHRASE}" found on screen` : `FAIL: phrase "${PHRASE}" NOT found on screen`);
await a.close();
