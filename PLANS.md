# Diagnostics Actions Redesign Plan

- [x] Verify current Diagnostics Actions rendering and aggregation behavior in Settings and global overlay.
- [x] Fix action aggregation boundary handling so action summaries only include traces within the correct action scope.
- [x] Redesign expanded action details for higher density while preserving existing REST/FTP card visual style.
- [x] Ensure header badges/counts exactly match visible child elements (REST/FTP/error) and keep duration prominent/right-aligned.
- [x] Ensure origin is always displayed (fallback `unknown`) and device identity labels render lowercase.
- [x] Remove empty/placeholder sections in expanded action details.
- [x] Add/update unit tests for aggregation boundaries and count consistency.
- [x] Add/update Playwright coverage for expanded action view behavior.
- [x] Run required validation (`npm run test`, `npm run lint`, `npm run build`, `./build`, `npm run test:coverage`) and fix only issues related to this scope.
