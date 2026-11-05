# Why Next and Prev ship as a companion APK

Status: measured on 2026-11-05 on the keypad handset, against release 1.2.1.

## Summary

The Next and Prev actions cannot be launcher entries inside the main app's APK. On the keypad
handset, a key bound to an app entry raises the running app's window when that app is already open,
and the entry itself never starts. Because the main app is always open while music plays, an entry
inside its package would only bring the app to the front. The entries therefore live in a separate
package, the Next and Prev companion (`android/next-prev`, application id `<main id>.nextprev`), which
is one APK with two launcher entries. That is the smallest arrangement that works.

## How the handset binds keys

- Each Android launcher activity becomes one entry in the handset's own app list. One APK with two
  launcher activities gives two entries, "Next - <app>" and "Prev - <app>", so different keys can be
  bound to each.
- A function-key action that opens an app refers to one of those entries.

## Measurement

A throwaway build of the keypad edition added a launcher activity inside the main package. It was
configured like the companion's entries (`singleTop`, empty `taskAffinity`, `noHistory`,
`excludeFromRecents`, translucent theme). It logged its start, sent `next` to
`TransportCommandProvider`, and finished. Music was playing for every run.

| How the entry was started | Result |
|---|---|
| The handset's launch command run directly, app in front | Skipped to the next item |
| The same command, app in the background | Skipped, 3 of 3 |
| Real key press, key bound to the in-package entry | App raised, no skip, 3 of 3; the activity never started |
| Real key press, key bound to the companion's Next entry | Skipped, 3 of 3 |

The direct launch command bypasses the step that raises the existing window. A test that starts an
entry that way does not show what a key press does. Key-bound behaviour must be tested through a real
key press.

## Consequences

- Keep Next and Prev in the companion package. Do not merge them into the main APK.
- Every install of the main app on a phone should also install the companion (`./build --install-apk`
  does this), and the release attaches it as `<basename>-<version>-android-next-prev.apk`.
- On ordinary Android phones an in-package entry would work, but it would not help the device the
  feature exists for.
