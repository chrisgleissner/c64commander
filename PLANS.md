# PLANS.md

## 1. Non-Negotiable Process
- [ ] Keep this file as the authoritative execution contract for the Home dashboard and screenshot system work.
- [ ] Track every meaningful implementation and verification step here as checkbox tasks.
- [ ] Execute a strict plan -> implement -> verify loop and only mark tasks complete after verification.
- [ ] Finish only when unit, integration/E2E, lint, and build checks pass locally and CI-parity checks are green.

## 2. Design Goal
- [ ] Redesign Home into a dense, high-value dashboard that reuses existing UI patterns and prioritizes operational shortcuts.
- [ ] Ensure the Home page compresses existing state/controls without introducing new visual language.
- [ ] Keep typography, contrast, and motion aligned with the rest of the app.

## 3. UX Philosophy and Non-Deviation Constraints
- [ ] Ensure every Home control is a shortcut to existing functionality (no new concepts introduced).
- [ ] Maintain interaction semantics and animation timing consistent with other pages.
- [ ] Increase density only via spacing, grouping, and progressive disclosure (no smaller text for primary content).

## A. Top-of-Page System Info (Collapsed by Default)
- [x] Replace the current build/device cards with a single collapsed system info strip.
- [x] Show App Version, Device Name, and Firmware Version in the collapsed view.
- [x] Expand inline to show Git ID, Build Time, FPGA Version, Core Version, and Core ID.
- [x] Ensure the block is toggleable by tap, minimal in height, and visually subordinate.

## B. Machine Control Section (Primary Actions)
- [x] Implement a 4x2 grid for machine controls with Reset/Reboot grouped and Power Off separated on another row.
- [x] Keep Reset/Reboot as primary actions and Power Off visually de-emphasized.
- [x] Preserve existing action handlers and safety confirmation.

## C. High-Visibility Core Controls (Above the Fold)
- [x] Ensure Reset, Reboot, Pause/Resume, Save RAM, Load RAM are visible above the fold.
- [x] Add a compact, non-interactive drive state summary (mounted media) above the fold.

## D. CPU Performance Quick Slider
- [x] Add a compact CPU Speed slider that reuses Config-page behavior and constraints.
- [x] Keep the slider above the fold with minimal vertical footprint.

## E. Video Mode and Video Options (Data-Driven Shortcuts)
- [x] Add data-driven Video Mode selection populated from device config options.
- [x] Add inline shortcuts for HDMI Scan Lines and Analog/Digital Video Mode.
- [x] Ensure inline selectors use existing interaction semantics and no permanent dropdown chrome.

## F. LED Strip Status and Quick Control (Summary-First)
- [x] Build a single-line LED summary based on current LED Strip Settings.
- [x] Show fixed color name + color swatch when relevant, plus tint and intensity.
- [x] Provide inline tint selection and a tap-through shortcut to LED configuration.
- [x] Exclude detailed LED strip configuration from Home.

## G. Screenshot Generation (Automatic, Intentional, Future-Proof)
- [x] Replace hardcoded per-section screenshots with dynamic section discovery.
- [x] Group screenshots by page and generate deterministic, semantic filenames.
- [x] Ensure section ordering is stable and new sections add new files without renaming existing ones.
- [x] Preserve intentional framing and above-the-fold priority across pages.

## H. Global Layout and Density Rules
- [x] Reduce padding/margins to increase density while maintaining readability.
- [x] Maintain strict alignment and avoid mid-word wrapping.
- [x] Ensure secondary information remains visually subordinate.

## I. Success Criteria + Verification
- [x] Update Home layout and data bindings to satisfy sections A-H.
- [x] Update Playwright coverage/tests for Home and screenshot behavior changes.
- [x] Update relevant docs describing Home dashboard behavior.
- [x] Run `npm run test` and pass.
- [x] Run `npm run lint` and pass.
- [x] Run `npm run build` and pass.
- [x] Run `npm run test:e2e` and pass.
- [x] Run `./build` (CI-parity helper) and pass.
