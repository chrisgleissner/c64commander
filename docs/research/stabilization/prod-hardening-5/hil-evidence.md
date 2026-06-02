# HIL Evidence Capture

Use `scripts/hil-screenshot-evidence.mjs` for Android review evidence.

- Raw screenshots are written under `evidence/raw/` and are kept at device resolution for pixel analysis.
- Review screenshots are written under `evidence/review/` and are downscaled for PR review and LLM consumption.
- The default review image target is width `480px`; both review dimensions must remain below `2000px`.
- Add `--ui-dump` when page-state assertions benefit from a text accessibility dump alongside the image.

Example:

```bash
node scripts/hil-screenshot-evidence.mjs --serial 9B081FFAZ001WX --name diagnostics-back --ui-dump
```

Use raw images only for exact pixel inspection. Use `*-review.png` images for summaries, PR evidence, and any LLM-facing review.
