# Bundle Size Breakdown

Source: `docs/research/review-3/metrics/web-bundle-sizes.txt`, `docs/research/review-3/logs/npm-run-build.log`

| Artifact                       |        Size |     Compressed | Notes                                           |
| ------------------------------ | ----------: | -------------: | ----------------------------------------------- |
| `dist/assets/index-*.js`       | 1,217.87 kB | 376.54 kB gzip | Main app chunk; Vite warns chunk > 1200 kB.     |
| `dist/assets/7zz-*.wasm`       | 1,651.93 kB |            n/a | Large wasm payload for archive extraction path. |
| `dist/assets/index-*.css`      |    78.84 kB |  13.76 kB gzip | Global styles and utility output.               |
| `dist/assets/7zz.es6-*.js`     |    55.01 kB |  19.35 kB gzip | JS loader/runtime for wasm path.                |
| `dist/assets/mockConfig-*.js`  |    42.08 kB |  14.49 kB gzip | Mock/config bundle segment.                     |
| `dist/assets/c64u-config-*.js` |    40.24 kB |   4.93 kB gzip | Config feature segment.                         |

## Build-time resource profile

- Build command max RSS: `1,371,180 kB`.
- Build duration: `8.76s` wall-clock on this host.
