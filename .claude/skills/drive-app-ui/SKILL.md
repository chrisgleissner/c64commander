---
name: drive-app-ui
description: >-
  Drive the C64 Commander UI on the Pixel 4 reliably — tap by testid with a hit-test, click
  through CDP when an overlay is in the way, set React-controlled inputs, and work with
  dialogs and virtualised lists. Use for any on-device UI flow, and especially when a button
  "does nothing", a dialog seems not to open, or an element is missing from the DOM that is
  visibly on screen.
---

# Drive the app on the device

Two mechanisms, used for different things. Load the `droidctl` skill first — it's the
interface for the plain tap/screenshot/shell primitives these build on or substitute for.

`taptid.sh` (a local, git-ignored helper under `docs/agentic/`, predating `droidctl`) adds a
hit-test-before-tap step that matters for this app's overlays, but shells out to raw `adb`
internally rather than `droid_input.tap` — a known gap in that local script, not a reason to
write new raw-adb code elsewhere. For a plain tap with no overlay risk (already `--check`ed,
or a fixed-position control), use `droid_input.tap` directly instead.

## Tapping — `taptid.sh`

```bash
cd docs/agentic/hil-rc4
./taptid.sh <testid>              # scroll into the band, hit-test, then tap
./taptid.sh --check <testid>      # hit-test only, no tap
./taptid.sh --noscroll <testid>   # fixed elements: tab bar, dialog footers
```

It scrolls the element into the interactive band with a real swipe and **hit-tests with
`elementFromPoint` before tapping**, so an open sheet can never silently swallow the tap. A
plain tap — whether `droid_input.tap` or raw `adb shell input tap` — lands on whatever
overlay happens to be there, hit-test or not.

**When a visible, enabled button "does nothing", hit-test it before blaming the handler.**
A fixed toast viewport once sat over the Play transport and ate every tap; two "the button
is broken" findings were raised before anyone checked. `--check` answers it in a second.

## Clicking — CDP

```bash
./campaign/js.sh '(()=>{document.querySelector("[data-testid=foo]").click();return "ok";})()'
```

A CDP `element.click()` **bypasses overlays entirely**. That is exactly what makes it the
right diagnostic — if the click works and the tap does not, the handler is fine and
something is on top. It is also more reliable for driving multi-step flows, where a swipe
from `taptid.sh` can dismiss the dialog you are trying to use.

Do not use it to *prove* a user can reach a control. For that, use `--check`.

## Dialogs

Read the dialog rather than the whole page — and give it time to render, because a read
immediately after the click will show the page underneath and look like the dialog never
opened:

```bash
./campaign/js.sh '(()=>{document.querySelector("[data-testid=add-items-to-playlist]").click();return "ok";})()'
sleep 3
./campaign/js.sh '(()=>{const d=document.querySelector("[role=dialog]");
  return JSON.stringify({open:!!d, text:(d?.innerText||"").slice(0,200).replace(/\n/g," | ")});})()'
```

**Rows versus checkboxes.** In the file picker, clicking a `source-entry-row` *navigates*.
To select a file you must click its checkbox, whose id is `select-<filename>`:

```bash
./campaign/js.sh '(()=>{document.getElementById("select-barcode.sid").click();return "ok";})()'
./campaign/js.sh '(()=>JSON.stringify({count:document.querySelector("[data-testid=add-items-selection-count]")?.innerText}))()'
```

Verify the count changed before confirming — a click that navigated instead of selecting
leaves it at "0 selected" and the confirm silently adds nothing.

## React-controlled inputs

Setting `.value` does nothing; React overwrites it. Use the native setter and dispatch:

```bash
./campaign/js.sh '(()=>{const f=document.querySelector("[data-testid=list-filter-input]");
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
  set.call(f,"barcode"); f.dispatchEvent(new Event("input",{bubbles:true})); return "ok";})()'
```

## Virtualised lists

The playlist renders a window, so an item that exists is often not in the DOM. **Filter
first**, then act. After filtering, the play affordance is a button with an aria-label, not
a testid:

```bash
./campaign/js.sh '(()=>{const b=[...document.querySelectorAll("button")]
  .find(x=>x.getAttribute("aria-label")==="Play barcode.sid"); b.click(); return "ok";})()'
```

## Discovering what is on screen

```bash
./campaign/js.sh '(()=>{const ids=[...new Set([...document.querySelectorAll("[data-testid]")]
  .map(e=>e.getAttribute("data-testid")))]; return JSON.stringify(ids.filter(t=>/radio|station/i.test(t)));})()'
```

A screenshot (`droid_capture.screenshot`) is worth reading when the DOM is confusing, but
confirm state from the DOM — the screenshot cannot tell you whether a control is disabled,
pressed, or covered.

## Verifying an action landed

Never infer success from the tap returning. Read the state back:

```bash
./campaign/js.sh '(()=>{const t=id=>document.querySelector(`[data-testid="${id}"]`);
  return JSON.stringify({pressed:t("playback-engine-local")?.getAttribute("aria-pressed"),
                         elapsed:t("playback-elapsed")?.innerText});})()'
```

And for anything that should have changed the machine or the audio, confirm from outside the
app too — the in-app Diagnostics log, `dumpsys audio`, or a REST read. A toggle can report
its new state while the effect never happened.
