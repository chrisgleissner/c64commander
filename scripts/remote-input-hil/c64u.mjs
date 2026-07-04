// Reusable U64/C64U REST client for HIL verification of Remote Input.
// Talks to the SAME device the app talks to, so reading machine state after
// the app sends input proves the input actually reached the device.
//
// Env: C64U_HOST (default "u64"), C64U_PASSWORD (X-Password header, optional).
const HOST = process.env.C64U_HOST || "u64";
const BASE = `http://${HOST}`;
const PW = process.env.C64U_PASSWORD || "";
const hdrs = PW ? { "X-Password": PW } : {};

const req = async (path, init = {}) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...hdrs, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} -> HTTP ${r.status}`);
  return r;
};

/** Read `length` bytes of live machine memory starting at hex `address` (e.g. "0400"). */
export const readMem = async (address, length) => {
  const r = await req(`/v1/machine:readmem?address=${address}&length=${length}`);
  return new Uint8Array(await r.arrayBuffer());
};

/** Write raw bytes to hex `address`. `bytes` is a Uint8Array or number[]. */
export const writeMem = async (address, bytes) => {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await req(`/v1/machine:writemem?address=${address}&data=${hex}`, { method: "PUT" });
};

export const reset = () => req("/v1/machine:reset", { method: "PUT" }).then(() => {});

/** Current input state the firmware is holding (proves app->device delivery). */
export const getInput = async () => (await req("/v1/machine:input")).json();

/** Send input directly (used only for harness SETUP, e.g. to SYS a detector). */
export const sendInput = (events) =>
  req("/v1/machine:input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  }).then((r) => r.json());

// --- C64 screen-code -> ASCII (uppercase/graphics set, codes 0..63 cover the
// printable ASCII we type in the harness). Unmapped -> ".". ---
export const screenCodeToChar = (code) => {
  const c = code & 0x7f; // ignore reverse-video bit
  if (c === 0) return "@";
  if (c >= 1 && c <= 26) return String.fromCharCode(64 + c); // A-Z
  if (c === 32) return " ";
  const punct = { 27: "[", 28: "£", 29: "]", 30: "^", 31: "<-", 33: "!", 34: '"', 35: "#", 36: "$", 37: "%", 38: "&", 39: "'", 40: "(", 41: ")", 42: "*", 43: "+", 44: ",", 45: "-", 46: ".", 47: "/", 58: ":", 59: ";", 60: "<", 61: "=", 62: ">", 63: "?" };
  if (c >= 48 && c <= 57) return String.fromCharCode(c); // 0-9
  return punct[c] ?? ".";
};

export const decodeScreen = (bytes) => [...bytes].map(screenCodeToChar).join("");

/** Read `rows` lines of 40 columns from the text screen at $0400. */
export const readScreenRows = async (startRow = 0, rows = 25) => {
  const addr = (0x0400 + startRow * 40).toString(16).padStart(4, "0");
  const bytes = await readMem(addr, rows * 40);
  const lines = [];
  for (let r = 0; r < rows; r += 1) lines.push(decodeScreen(bytes.slice(r * 40, r * 40 + 40)));
  return lines;
};

export const HOST_NAME = HOST;
