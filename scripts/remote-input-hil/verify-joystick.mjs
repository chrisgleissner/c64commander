// Verifies every joystick control by driving it with REAL touch and asserting
// the C64U firmware reports the matching held input (machine:input GET). This
// proves the app -> C64U delivery path for each direction and FIRE.
import { openApp } from "./app-touch.mjs";
import { getInput } from "./c64u.mjs";

const PORT = 2; // app default
const heldInputs = async () => {
  const s = await getInput();
  return (s.joysticks.find((j) => j.port === PORT)?.inputs ?? []).slice().sort();
};

const results = [];
const a = await openApp(process.argv[2]);

// Ensure sheet open + Joystick mode + D-pad style (discrete, one direction per cell).
if (!(await a.evaluate(`!!document.querySelector('[data-testid="remote-input-sheet"]')`))) {
  await a.evaluate(`document.querySelector('[data-testid="home-machine-inline-openRemoteInput"]')?.click()`);
  await a.sleep(900);
}
await a.tap("remote-input-mode-joystick");
await a.sleep(400);
await a.tap("remote-input-movement-style-dpad");
await a.sleep(400);

const cases = [
  { testid: "remote-input-dpad-up", expect: "up" },
  { testid: "remote-input-dpad-down", expect: "down" },
  { testid: "remote-input-dpad-left", expect: "left" },
  { testid: "remote-input-dpad-right", expect: "right" },
  { testid: "remote-input-fire-button", expect: "fire" },
];

for (const { testid, expect } of cases) {
  const { release } = await a.press(testid);
  await a.sleep(350); // let the coalesced send reach the device
  const during = await heldInputs();
  release();
  await a.sleep(350);
  const after = await heldInputs();
  const heldOk = during.includes(expect);
  const releasedOk = !after.includes(expect);
  results.push({ control: expect, heldState: during, releasedState: after, pass: heldOk && releasedOk });
}

console.log("JOYSTICK VERIFICATION (real touch -> C64U machine:input state):");
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.control.padEnd(6)} held=${JSON.stringify(r.heldState)} released=${JSON.stringify(r.releasedState)}`);
}
console.log(results.every((r) => r.pass) ? "ALL JOYSTICK CONTROLS OK" : "SOME JOYSTICK CONTROLS FAILED");
await a.close();
