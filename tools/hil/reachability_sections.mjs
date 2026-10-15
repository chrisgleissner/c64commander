/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** In-page expression: the ids of the active page's open cards, as `scope:id`. */
export const OPEN_SECTIONS_EXPR = `JSON.stringify([...document.querySelectorAll('[data-slot-active="true"] [data-section-id][data-open="true"]')].map((s) => s.dataset.sectionScope + ":" + s.dataset.sectionId))`;

/** The cards the sweep opened: open now, closed before it started. */
export const sectionsOpenedDuring = (before, after) => {
  const wasOpen = new Set(before);
  return after.filter((key) => !wasOpen.has(key));
};

/** In-page expression that closes the given cards through their own header toggles; returns how many it closed. */
export const closeSectionsExpr = (keys) => `(() => {
  let closed = 0;
  for (const key of ${JSON.stringify(keys)}) {
    const [scope, id] = key.split(":");
    const section = document.querySelector('[data-slot-active="true"] [data-section-scope="' + scope + '"][data-section-id="' + id + '"]');
    const toggle = section?.querySelector('button[aria-expanded="true"]');
    if (toggle) { toggle.click(); closed += 1; }
  }
  return closed;
})()`;

/**
 * The phone to sweep for an edition: the handset edition runs on the drivable keypad handset; any other edition is
 * left to droidctl's usual choice (`undefined`). Keys and page reads must reach the same phone.
 */
export const chooseReachabilityTarget = (targets, packageName, handsetPackage) => {
  if (packageName !== handsetPackage) return undefined;
  const handset = targets.find(
    (target) => target.transport === "ssh" && target.state === "device" && target.route === "container-adb",
  );
  if (!handset) throw new Error(`${packageName} runs on the keypad handset, and droidctl lists no drivable handset`);
  return handset;
};
