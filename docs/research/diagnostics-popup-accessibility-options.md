# Diagnostics Popup Accessibility Options

## Purpose

This note documents how transient popup messages currently interact with the top-right diagnostics controls, why the current behavior blocks an important troubleshooting affordance, and 10 different UX approaches to resolve it.

The specific problem is that popup messages can cover the circles in the app header that indicate REST, FTP, and error activity. Those circles are not decorative. They are the fastest route into Diagnostics, because clicking them opens the global Diagnostics overlay.

## Research Scope

Reviewed implementation:

- `src/components/AppBar.tsx`
- `src/components/DiagnosticsActivityIndicator.tsx`
- `src/components/ConnectivityIndicator.tsx`
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `src/components/ui/toast.tsx`
- `src/components/ui/toaster.tsx`
- `src/hooks/use-toast.ts`
- `src/lib/uiErrors.ts`

Also checked how widely popups are used across Home, Play, Config, Disks, and Settings.

## What The Code Does Today

### Header and diagnostics affordance

- The app header is a fixed top bar in `AppBar.tsx` with `z-40`.
- The top-right cluster contains `DiagnosticsActivityIndicator` and `ConnectivityIndicator`.
- `DiagnosticsActivityIndicator` shows REST, FTP, and error circles and opens Diagnostics via `requestDiagnosticsOpen("actions")`.
- The global overlay is managed by `GlobalDiagnosticsOverlay.tsx`, which opens `DiagnosticsDialog.tsx` outside the Settings route.

### Popup implementation

- Most transient messages use the custom Radix toast stack from `use-toast.ts` and `components/ui/toast.tsx`.
- `ToastViewport` is fixed with `z-[100]`.
- On narrow screens, the viewport is full-width and anchored at the very top of the screen: `left-0 top-0 w-screen max-w-screen`.
- On `sm` and larger screens, the viewport moves to the bottom-right, which means the overlap problem is mainly a compact/mobile issue.
- `TOAST_LIMIT` is `1`, so only one popup is visible at a time, but that single popup can still occupy the exact header area that contains the diagnostics controls.
- `ToastClose` exists, but its opacity is `0` until hover or focus. That is weak on touch devices, where discoverability matters most.

### Error handling and why this matters

- `reportUserError()` always logs an error and then shows a destructive toast.
- Some error toasts also include a `Retry` action.
- Success and informational toasts are used broadly across the app, so this is not a rare edge case.
- The diagnostics circles are especially important during failures, which is exactly when destructive toasts are most likely to appear.

## UX Diagnosis

The current compact-screen behavior creates a conflict between two system-level feedback surfaces:

- The toast says, "something happened right now."
- The diagnostics circles say, "inspect network activity and failures right now."

Because the toast has a higher z-index and occupies the same corner, the short-term feedback surface blocks the deeper troubleshooting surface.

That is the wrong priority order. During failures, diagnostics access should become easier, not harder.

## Design Goals

- Keep the diagnostics circles visible during popup display.
- Keep the diagnostics circles clickable during popup display.
- Preserve fast, glanceable feedback.
- Avoid major layout shift in the header.
- Support a clear early-dismiss action on touch devices.
- Keep the behavior consistent across Home, Play, Config, Disks, Docs, and Settings.

## Baseline Recommendation For Early Dismiss

Regardless of which layout option is chosen, the app should add a clearer early-dismiss pattern for popups.

Recommended baseline:

- Always show a visible dismiss button on touch, not hover-only.
- Support swipe-to-dismiss on mobile.
- Let the user dismiss by tapping a compact `x` affordance immediately.
- For error toasts, prefer two visible actions: `Retry` and `Hide` or `Dismiss`.
- When the user opens Diagnostics from the header, auto-dismiss or collapse the popup so the two surfaces do not compete.

Interaction preference:

- The best compact-screen dismissal model is not swipe _or_ `x`; it is swipe _and_ `x`.
- Swipe supports fast, low-attention dismissal.
- A visible `x` supports explicit dismissal, discoverability, and one-handed use when swipe is awkward.
- Both should be available immediately without hover.

## 10 UX Approaches

### 1. Reserve a permanent top-right no-cover zone

Summary:

- Keep the toast at the top on compact screens, but never allow it to overlap the diagnostics cluster.

How it keeps diagnostics accessible:

- The toast viewport or toast width is constrained so the right side of the header remains exposed.
- The top-right cluster becomes a protected region.

How the user hides the popup early:

- Add a persistent visible close button.
- Keep swipe-to-dismiss enabled.

Why this is strong:

- Minimal conceptual change.
- Keeps current toast mental model.
- Preserves header stability.

Tradeoffs:

- Toast width becomes narrower on phones.
- Long messages may wrap more aggressively.

Implementation note:

- This is best if the app measures the right-side header cluster width and uses it to pad or cap `ToastViewport` on compact layouts.

### 2. Offset mobile toasts below the app bar

Summary:

- Keep top placement, but start the viewport below the app bar instead of at `top-0`.

How it keeps diagnostics accessible:

- The header remains fully visible and interactive because the toast stack starts below `--app-bar-height`.

How the user hides the popup early:

- Visible `x` button.
- Swipe up or sideways to dismiss.

Why this is strong:

- Very easy to understand.
- Keeps diagnostics controls exactly where users expect them.
- Low implementation complexity because `AppBar.tsx` already writes `--app-bar-height`.

Tradeoffs:

- Toasts may cover some page content below the header.
- Slightly reduces how "system-level" the popup feels.

Implementation note:

- This is the most direct fix if the goal is low risk and fast delivery.

### 3. Move compact-screen toasts to the bottom edge

Summary:

- On compact profiles only, show transient messages at the bottom instead of the top.

How it keeps diagnostics accessible:

- The entire header remains unblocked.
- Diagnostics and connectivity controls remain visible at all times.

How the user hides the popup early:

- Swipe down or sideways depending on animation direction.
- Visible close button on the right.

Why this is strong:

- Mobile snackbar behavior is common and easy to learn.
- Keeps urgent diagnostics affordances clear.
- Works especially well for short success and info toasts.

Tradeoffs:

- Error toasts at the bottom can feel less urgent.
- Could conflict with bottom navigation if spacing is not carefully handled.

Implementation note:

- Best paired with extra bottom offset so it clears the tab bar.

### 4. Split by severity: success/info at bottom, error at top-below-header

Summary:

- Use different placements depending on message severity.

How it keeps diagnostics accessible:

- Success and info messages go to the bottom.
- Error messages remain near the top, but below the app bar so the diagnostics circles stay free.

How the user hides the popup early:

- Consistent visible dismiss button in both placements.

Why this is strong:

- Balances urgency with access.
- Makes the most common non-critical toasts less intrusive.
- Preserves visual prominence for real failures.

Tradeoffs:

- Placement rules become more complex.
- Users need a little time to internalize why messages appear in different places.

Implementation note:

- This would likely require adding toast metadata for severity and placement rules to the custom toast layer.

### 5. Convert header-blocking popups into an inline status strip under the app bar

Summary:

- Replace mobile top toasts with a thin inline banner directly under the header.

How it keeps diagnostics accessible:

- The app bar remains untouched.
- The diagnostics circles remain visible and clickable above the banner.

How the user hides the popup early:

- Banner includes a visible dismiss button.

Why this is strong:

- Strong visual connection to the page without blocking global controls.
- Good for repetitive system feedback like "saved," "shared," or "connection settings saved."

Tradeoffs:

- More of a banner than a toast.
- Can create content push-down if not overlaid carefully.

Implementation note:

- Best suited if the product wants a calmer, more dashboard-like tone instead of floating notifications.

### 6. Elevate the diagnostics cluster above popups

Summary:

- Leave the popup where it is, but render the diagnostics controls above it with a higher z-index or separate portal layer.

How it keeps diagnostics accessible:

- The circles remain visible and clickable even when a popup occupies the same visual band.

How the user hides the popup early:

- Visible dismiss button on the toast.

Why this is strong:

- The smallest possible visual change.
- Diagnostics wins the stacking battle without redesigning message placement.

Tradeoffs:

- Can look visually messy if the dots sit on top of the popup.
- Risk of accidental overlap that feels hacked rather than designed.

Implementation note:

- This is workable as a tactical fix, but it is not the cleanest long-term composition.

### 7. Auto-collapse the popup after a short dwell into a compact pill

Summary:

- Show the full popup briefly, then collapse it into a much smaller pill that no longer covers the header controls.

How it keeps diagnostics accessible:

- After the initial read window, the popup shrinks or shifts away, returning access to the circles.

How the user hides the popup early:

- Add an explicit `x` on the full toast and the collapsed pill.

Why this is strong:

- Preserves immediate visibility for the message.
- Reduces long-lived obstruction.
- Feels polished if motion is well handled.

Tradeoffs:

- More moving parts.
- Can become distracting if the animation is too frequent.

Implementation note:

- Best for higher-frequency success feedback.

### 8. Turn the popup into a left-anchored compact card on mobile

Summary:

- Keep the toast near the top, but anchor it to the top-left with a capped width that intentionally avoids the right-side indicator area.

How it keeps diagnostics accessible:

- The right side remains clear for diagnostics and connectivity controls.

How the user hides the popup early:

- Visible close button plus swipe-to-dismiss.

Why this is strong:

- Preserves the "top toast" feeling.
- Easier than full collision-aware positioning.

Tradeoffs:

- Message width can become tight.
- Asymmetry may look odd if not integrated into the visual language.

Implementation note:

- This is a good middle ground if the team wants a stable, deterministic layout rather than measurement-heavy logic.

### 9. Replace many toast cases with a diagnostics-first status model

Summary:

- For network and import/export issues, reduce popup reliance and route feedback through the diagnostics surfaces first.

How it keeps diagnostics accessible:

- Instead of a large popup, the app updates the diagnostics dots and optionally shows a smaller supporting hint like `Tap diagnostics for details`.

How the user hides the popup early:

- The supporting hint is dismissible with a visible close button.

Why this is strong:

- Aligns the error path with the actual troubleshooting destination.
- Especially good for REST/FTP failures, where the diagnostics overlay is the natural next step.

Tradeoffs:

- Requires rethinking error communication patterns.
- Some users may miss feedback if the hint is too subtle.

Implementation note:

- Best for operational failures, not generic success confirmation.

### 10. Add collision-aware adaptive placement

Summary:

- Detect the app bar and diagnostics indicator bounds at runtime and place each popup in the first safe region that does not block them.

How it keeps diagnostics accessible:

- The popup dynamically avoids the actual indicator hitbox instead of relying on one static layout rule.

How the user hides the popup early:

- Visible dismiss button.
- Swipe-to-dismiss.

Why this is strong:

- Most robust across future header changes, localization, and responsive states.
- Can adapt to compact and non-compact layouts automatically.

Tradeoffs:

- Highest implementation complexity.
- Harder to test and reason about.
- Can feel inconsistent if placement changes too often.

Implementation note:

- This is the most technically flexible option, but not the best first move unless header layout changes frequently.

## Best Candidates

Given the preference to avoid covering page content below the header, the strongest candidates are:

1. **Option 1: reserve a permanent top-right no-cover zone**
2. **Option 8: left-anchored compact card on mobile**
3. **Option 9: diagnostics-first status model for operational failures**

## Preferred Direction

My preferred direction is a three-part solution:

1. Use **Option 1** as the baseline compact-screen layout fix.
2. Make **both swipe dismissal and a permanently visible `x` button** part of the default compact-screen toast behavior.
3. For REST/FTP failures specifically, evolve toward **Option 9** so the diagnostics system becomes the primary recovery path.

Why this combination is strongest:

- It keeps transient messages in the header band instead of covering page content below the header.
- It protects the only important header affordance in this context: the diagnostics status circles.
- It resolves the immediate visibility and hit-target problem without waiting for a larger notification redesign.
- It respects the current architecture, where diagnostics already has a strong global entry point.
- It improves touch usability by making dismissal both discoverable and fast.
- It preserves room to later specialize operational failures without forcing all notifications into one model.

## Implementation Implications

The most likely files to change for a production solution are:

- `src/components/ui/toast.tsx`
- `src/components/ui/toaster.tsx`
- `src/hooks/use-toast.ts`
- `src/lib/uiErrors.ts`
- `src/components/AppBar.tsx`

Potential supporting work:

- Introduce toast placement variants for compact vs non-compact screens.
- Add both swipe-to-dismiss and a visible mobile-first `x` affordance.
- Add message-type metadata so operational failures can route differently from success confirmations.
- Optionally dismiss or collapse a visible toast when Diagnostics is opened.

## Conclusion

The issue is real and rooted in the current layering model, not just subjective perception. On compact layouts, the popup system currently outranks and overlaps the app's most important diagnostics affordance. The cleanest near-term fix is to keep compact toasts inside the header band while reserving a protected no-cover zone for the diagnostics circles, and to make early dismissal available through both swipe and a visible `x`. The best longer-term fix is to treat network and diagnostics-related failures as diagnostics-native events rather than ordinary toasts.
