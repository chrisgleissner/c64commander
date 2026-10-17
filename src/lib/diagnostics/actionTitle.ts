/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const VERB_TITLES: Record<string, string> = {
  click: "Tapped",
  change: "Changed",
  toggle: "Toggled",
  select: "Selected",
};

const TESTID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const ACTION_NAME_PATTERN = /^([a-z]+) (\S+?)(?: \[(.*)\])?$/;

const SETTINGS_SECTION_TOGGLE = "settings-section-toggle-";

const wordsOf = (testId: string): string => testId.split("-").join(" ");

const describeTarget = (testId: string): string =>
  testId.startsWith(SETTINGS_SECTION_TOGGLE)
    ? `settings section ${wordsOf(testId.slice(SETTINGS_SECTION_TOGGLE.length))}`
    : wordsOf(testId);

// Raw names such as "click settings-section-toggle-diagnostics" stay available in the entry details.
export const humanizeActionName = (actionName: string): string => {
  const match = ACTION_NAME_PATTERN.exec(actionName);
  if (!match) return actionName;
  const [, verb, target, value] = match;
  const verbTitle = VERB_TITLES[verb];
  if (!verbTitle || !TESTID_PATTERN.test(target)) return actionName;
  const title = `${verbTitle} ${describeTarget(target)}`;
  return value ? `${title} to ${value}` : title;
};
