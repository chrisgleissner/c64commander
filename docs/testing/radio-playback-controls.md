# Radio history and playback controls

## Callback 8020 evidence

Measured on the Callback 8020, using the `c64u-remote` edition, at 320 × 427 CSS
pixels (480 × 640 physical pixels, DPR 1.5), with the C64U. Pixel measurements do
not stand in for these results.

| Exercise                                                              | Result                                                                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Chill/Ambient radio: select the last queued tune, then Next, 35 times | 360 candidates served; queue and handover IDs stayed at 200 after reaching the default limit                                                  |
| Queue at the limit, 17 samples                                        | JavaScript heap 113–185 MB, with garbage collection; Next completed in 744–1109 ms                                                            |
| Refill work                                                           | Maximum asynchronous refill 448.4 ms; maximum synchronous main-thread work 2.6 ms; no audio underruns reported by the app                     |
| Repeat-one, a real short SID                                          | Two complete tune endings restarted the same tune; manual Next launched the immediate successor                                               |
| Shuffle during radio                                                  | Cancel retained the running station; confirmation stopped radio and enabled playlist shuffle                                                  |
| Playlist View all                                                     | Native swipe moved title and filter above the viewport; alphabet rail remained beside rows; D-pad focus stayed visible; Back closed the sheet |
| Radio playlist limit                                                  | Native keypad editing saved 200 → 300 → 200                                                                                                   |
| Android picker cancellation                                           | CFG, SID, CFG selections cancelled and returned to the app after injected Android Back events, including an open menu                         |

The tail-selection exercise used a 200-row preview. Selecting the tail and
refilling took about five seconds at the limit; the Next measurements above are
only the subsequent Next operation. The soak demonstrates bounded queue storage,
not a proof that total process memory can never grow.

The picker uses Android's native key map. On the Callback the right soft key
produces Android Back and the left produces Menu. The app remaps these inside its
own activity; DocumentsUI does not receive that remapping. Back can first close a
menu or leave a folder, so the user may need to press the right soft key again.
The cancellation exercise injected Android key events; it did not independently
re-measure the physical scan codes.

## Automated regressions

- 1,000 ten-tune refills retain the current tune, lookahead and user additions,
  while rebasing indices and bounding station history.
- Station replacement and user additions survive overlapping functional updates.
- A pending Next follows tune IDs when retention removes earlier rows.
- Next during a repeat restart launches the immediate successor, using the tune
  actually launched rather than the optimistic selection shown on screen.
- Removed pending targets resolve to the following available tune.
- Repeat-one affects automatic progression; manual Next/Previous and station Stop
  keep their normal meaning.
- View-all title/filter live inside the virtual scroller; filtering keeps the
  input mounted, including empty results.
- The Shuffle and Repeat icon buttons share the volume row at 320 × 426 CSS
  pixels, with 44 × 44 targets, 20px icons, named button roles and exposed toggle states.
  Their columns match the neutral × and heart beside the facts. Credits stay below the title and before the transport.
- Each new shuffle cycle starts at the current tune and visits every other item once, including without Repeat; its anchor survives session restoration.

The cap, repeat-restart race and scrolling-header regressions were observed failing with their respective fix removed. The Shuffle off/on regression failed against the previous seed-reuse behavior.
