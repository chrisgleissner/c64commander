# libsidplayfp WebAssembly Build

This bundle is produced by the Docker build located in `packages/libsidplayfp-wasm/`. It exposes
`SidPlayerContext` through an embind wrapper so you can drive the C64 SID player
from JavaScript or TypeScript.

## Quick Start

```ts
import createLibsidplayfp from "./libsidplayfp.js";

const module = await createLibsidplayfp();
const player = new module.SidPlayerContext();

const response = await fetch("Team_Patrol.sid");
const buffer = new Uint8Array(await response.arrayBuffer());

if (!player.loadSidBuffer(buffer)) {
  throw new Error(player.getLastError());
}

const samples = player.render(20000); // Int16Array with PCM samples
```

The generated module supports both browsers and Node.js. When using filesystem
paths, mount files into Emscripten's virtual FS (`FS`).
