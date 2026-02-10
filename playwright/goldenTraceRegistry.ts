/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TestInfo } from '@playwright/test';
import { generateTestId } from './testIdUtils';

const GOLDEN_TRACE_ANNOTATION = 'golden-trace';

const GOLDEN_TRACE_TEST_IDS = new Set<string>([
  'ctacoverage--ctacoveragespects--home-page-quick-actions--home-page-displays-quick-action-cards-for-machine-control',
  'demomode--demomodespects--automatic-demo-mode--real-connection-shows-green-c64u-indicator',
  'playbackpart2--playbackpart2spects--playback-file-browser-part-2--local-browsing-filters-supported-files-and-plays-sid-upload',
  'playback--playbackspects--playback-file-browser--rapid-playstopplay-sequences-remain-stable',
  'playbackpart2--playbackpart2spects--playback-file-browser-part-2--prevnext-navigates-within-playlist',
  'playbackpart2--playbackpart2spects--playback-file-browser-part-2--disk-image-triggers-mount-and-autostart-sequence',
  'diskmanagement--diskmanagementspects--disk-management--ftp-directory-listing-shows-hierarchy-layout',
  'diskmanagement--diskmanagementspects--disk-management--settings-changes-while-disk-mounted-preserve-mounted-state-layout',
  'itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-add-folder-returns-to-disks-and-populates-library',
  'diskmanagement--diskmanagementspects--disk-management--disk-list-view-all-shows-full-list-layout',
  'solo--solospects--config-page-sid-solo-routing--solo-switch-toggles-active-sid-instantly',
  'navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--config-reset-category-applies-defaults',
  'configvisibility--configvisibilityspects--config-visibility-across-modes--config-remains-visible-after-switching-demo-real',
  'playbackpart2--playbackpart2spects--playback-file-browser-part-2--disk-image-uses-dma-autostart-when-enabled',
  'settingsconnection--settingsconnectionspects--settings-connection-management--change-device-host-and-save-reconnects',
  'settingsdiagnostics--settingsdiagnosticsspects--settings-diagnostics-workflows--debug-logging-toggle-records-rest-calls',
  'layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--settings-logs-handle-long-error-messages-without-overflow-layout',
  'uxinteractions--uxinteractionsspects--ux-interaction-patterns--no-unrestricted-filesystem-access-language-allow-warnings',
  'demomode--demomodespects--automatic-demo-mode--demo-interstitial-appears-once-per-session-and-manual-retry-uses-discovery',
  'connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--demo-enabled-real-device-reachable-informational-only',
]);

const hasGoldenTraceAnnotation = (testInfo: TestInfo) =>
  testInfo.annotations.some((annotation: TestInfo['annotations'][number]) => annotation.type === GOLDEN_TRACE_ANNOTATION);

export const enableGoldenTrace = (testInfo: TestInfo, reason?: string) => {
  testInfo.annotations.push({
    type: GOLDEN_TRACE_ANNOTATION,
    description: reason ?? 'Golden trace comparison enabled',
  });
};

export const getGoldenTraceStatus = (testInfo: TestInfo) => {
  const testId = generateTestId(testInfo);
  const annotated = hasGoldenTraceAnnotation(testInfo);
  const allowed = GOLDEN_TRACE_TEST_IDS.has(testId);
  const shouldCompare = allowed && annotated;
  return { testId, annotated, allowed, shouldCompare };
};

export const assertGoldenTraceEligibility = (testInfo: TestInfo) => {
  const status = getGoldenTraceStatus(testInfo);
  if (status.annotated && !status.allowed) {
    throw new Error(
      `Golden trace annotation set for non-registered test "${testInfo.title}". `
        + `Remove enableGoldenTrace() or add "${status.testId}" to goldenTraceRegistry.ts.`,
    );
  }
  if (status.allowed && !status.annotated) {
    throw new Error(
      `Golden trace test "${status.testId}" is listed in goldenTraceRegistry.ts but not annotated. `
        + 'Call enableGoldenTrace(testInfo) in the test.',
    );
  }
  return status;
};

export const shouldCompareGoldenTrace = (testInfo: TestInfo) => getGoldenTraceStatus(testInfo).shouldCompare;

export const shouldRecordGoldenTrace = (testInfo: TestInfo) => {
  if (process.env.RECORD_TRACES !== '1') return false;
  return shouldCompareGoldenTrace(testInfo);
};

export const getGoldenTraceTestIds = () => Array.from(GOLDEN_TRACE_TEST_IDS);
