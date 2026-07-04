// GOLD-STANDARD joystick proof: install the 6502 joystick monitor, launch it by
// typing SYS49152 with real touch, then drive each direction + FIRE by real
// touch and assert the running C64 program sees it in CIA/screen RAM. Proves the
// full chain: touch -> app -> machine:input -> firmware -> CIA -> 6510 program.
import { openApp } from "./app-touch.mjs";
import { reset, writeMem, readMem, readScreenRows } from "./c64u.mjs";
import { MONITOR_ADDRESS, MONITOR_BYTES, MONITOR_SYS, SCREEN_JOY_ADDR, FIRE_COUNTER_ADDR, decodeJoyByte } from "./joystick-monitor.mjs";

const a = await openApp(process.argv[2]);

const ensureSheetOpen = async () => {
  if (!(await a.evaluate(`!!document.querySelector('[data-testid="remote-input-sheet"]')`))) {
    await a.evaluate(`document.querySelector('[data-testid="home-machine-inline-openRemoteInput"]')?.click()`);
    await a.sleep(900);
  }
};
const waitForReady = async () => {
  for (let i = 0; i < 20; i += 1) {
    const rows = await readScreenRows(0, 7);
    if (rows.some((l) => l.includes("READY."))) return true;
    await a.sleep(500);
  }
  return false;
};

// 1. Fresh machine, install the monitor.
await ensureSheetOpen();
await reset();
if (!(await waitForReady())) throw new Error("C64 did not return to READY after reset");
await a.sleep(1500); // let the app's input path recover from the reset connection blip
await writeMem(MONITOR_ADDRESS, MONITOR_BYTES);

// 2. Launch it by typing SYS49152 + RETURN with real touch (Keys tab).
await ensureSheetOpen();
await a.tap("remote-input-mode-type");
await a.sleep(700);
for (const ch of `SYS${MONITOR_SYS}`) await a.tapKey(`remote-input-key-${ch.toLowerCase()}`);
await a.tapKey("remote-input-key-return");
await a.sleep(800); // monitor now running (SEI loop)

// Confirm the monitor actually launched (it sets DDRA=$00) before asserting.
const ddra = (await readMem("dc02", 1))[0];
if (ddra !== 0x00) throw new Error(`joystick monitor did not launch (DDRA=0x${ddra.toString(16)}, expected 0x00)`);

// 3. Drive each control via real touch and read the running program's view.
await a.tap("remote-input-mode-joystick");
await a.sleep(400);
await a.tap("remote-input-movement-style-dpad");
await a.sleep(400);

const readJoy = async () => decodeJoyByte((await readMem(SCREEN_JOY_ADDR, 1))[0]);
const readFireCount = async () => (await readMem(FIRE_COUNTER_ADDR, 1))[0];

const results = [];
for (const { testid, expect } of [
  { testid: "remote-input-dpad-up", expect: "up" },
  { testid: "remote-input-dpad-down", expect: "down" },
  { testid: "remote-input-dpad-left", expect: "left" },
  { testid: "remote-input-dpad-right", expect: "right" },
]) {
  const { release } = await a.press(testid);
  await a.sleep(350);
  const during = await readJoy();
  release();
  await a.sleep(300);
  const after = await readJoy();
  results.push({ control: expect, seenByProgram: during, afterRelease: after, pass: during.includes(expect) && !after.includes(expect) });
}

// FIRE: assert the on-C64 counter increments per press edge.
const before = await readFireCount();
for (let i = 0; i < 3; i += 1) {
  const { release } = await a.press("remote-input-fire-button");
  await a.sleep(250);
  release();
  await a.sleep(250);
}
const afterCount = await readFireCount();
const fireDelta = (afterCount - before + 256) % 256;

console.log("GOLD-STANDARD JOYSTICK (real touch -> running 6502 program via CIA):");
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.control.padEnd(6)} program-saw=${JSON.stringify(r.seenByProgram)} afterRelease=${JSON.stringify(r.afterRelease)}`);
}
const fireOk = fireDelta === 3;
console.log(`  ${fireOk ? "PASS" : "FAIL"}  fire   counter +${fireDelta} over 3 presses (on-C64 $0428)`);
console.log(results.every((r) => r.pass) && fireOk ? "GOLD-STANDARD JOYSTICK OK" : "GOLD-STANDARD JOYSTICK FAILED");
await a.close();
