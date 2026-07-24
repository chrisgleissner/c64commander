// [c64commander vendored] path rewritten "../dist/" → "./" for the flat public/wasm/libsidplayfp/ layout.
import createLibsidplayfp from "./libsidplayfp.js";
// Only check environment variables in Node.js/server contexts, not in browsers/workers
const wasmPathOverride = (typeof process !== "undefined" && typeof process.env === "object")
    ? (process.env.SIDFLOW_LIBSIDPLAYFP_WASM_PATH ?? process.env.LIBSIDPLAYFP_WASM_PATH)?.trim() || undefined
    : undefined;
// Detect if we're in a server-like environment (Node.js) vs browser/worker
const isServerLikeEnvironment = typeof globalThis === "object"
    ? (typeof globalThis.window === "undefined" && typeof process !== "undefined")
    : false;
// [c64commander vendored] "../dist/" → "./" so the .wasm loads as a sibling here.
const artifactBaseUrl = new URL("./", import.meta.url);
let cachedDefaultModulePromise = null;
function createModulePromise(options) {
    const locate = options.locateFile ?? ((asset) => {
        if (isServerLikeEnvironment && wasmPathOverride) {
            return wasmPathOverride;
        }
        return new URL(asset, artifactBaseUrl).href;
    });
    return createLibsidplayfp({
        ...options,
        locateFile: locate
    });
}
function isCacheableDefaultLoad(options) {
    return Object.keys(options).length === 0;
}
export async function loadLibsidplayfp(options = {}) {
    if (isCacheableDefaultLoad(options)) {
        if (!cachedDefaultModulePromise) {
            cachedDefaultModulePromise = createModulePromise(options).catch((error) => {
                cachedDefaultModulePromise = null;
                throw error;
            });
        }
        return await cachedDefaultModulePromise;
    }
    return await createModulePromise(options);
}
export { SidAudioEngine } from "./player.js";
export default loadLibsidplayfp;