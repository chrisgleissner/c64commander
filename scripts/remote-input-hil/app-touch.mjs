// Drives the C64 Commander Remote Input UI with REAL Android touch events
// (adb input = the same pipeline DroidMind uses), locating controls by their
// data-testid via CDP and converting CSS rects to physical screen pixels.
import { execFileSync } from "node:child_process";
import { connect } from "./cdp.mjs";

const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" });

export async function openApp(wsUrl) {
  const c = await connect(wsUrl);
  const dpr = await c.evaluate("window.devicePixelRatio");
  const phys = (rect) => ({ x: Math.round(rect.cx * dpr), y: Math.round(rect.cy * dpr) });

  const rect = async (testid) =>
    c.evaluate(`(()=>{const e=document.querySelector('[data-testid=${JSON.stringify(testid)}]');if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({cx:r.x+r.width/2,cy:r.y+r.height/2,w:r.width,h:r.height});})()`).then((s) => (s ? JSON.parse(s) : null));

  const tap = async (testid) => {
    const r = await rect(testid);
    if (!r) throw new Error(`tap: no element ${testid}`);
    const p = phys(r);
    adb("shell", "input", "tap", String(p.x), String(p.y));
  };

  // Scroll a control into the middle of its scroll container, then real-tap it
  // (keyboard keys live in the scrollable deck+grid; some are off-screen).
  const tapKey = async (testid) => {
    await c.evaluate(
      `(()=>{const e=document.querySelector('[data-testid=${JSON.stringify(testid)}]');if(e)e.scrollIntoView({block:'center'});})()`,
    );
    await c.sleep(120);
    await tap(testid);
    await c.sleep(90);
  };

  // Genuine press-and-hold: motionevent DOWN now, returns a release() that lifts
  // at the same physical point. Lets the caller inspect device state MID-hold.
  const press = async (testid) => {
    const r = await rect(testid);
    if (!r) throw new Error(`press: no element ${testid}`);
    const p = phys(r);
    adb("shell", "input", "motionevent", "DOWN", String(p.x), String(p.y));
    return { release: () => adb("shell", "input", "motionevent", "UP", String(p.x), String(p.y)) };
  };

  const evaluate = (expr) => c.evaluate(expr);
  const sleep = (ms) => c.sleep(ms);
  const close = () => c.close();
  return { c, dpr, rect, phys, tap, tapKey, press, evaluate, sleep, close };
}
