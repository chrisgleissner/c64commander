/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type BuildInfoInput = {
    appVersion?: string;
    gitSha?: string;
    buildTime?: string;
};

export type BuildInfo = {
    appVersion: string;
    gitSha: string;
    gitShaShort: string;
    versionLabel: string;
    buildTimeUtc: string;
};

const BUILD_TIME_PLACEHOLDER = '2026-01-01 12:00:00 UTC';

export const formatBuildTimeUtc = (isoString: string) => {
    if (!isoString) return BUILD_TIME_PLACEHOLDER;
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return BUILD_TIME_PLACEHOLDER;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
};

export const formatBuildInfo = ({ appVersion = '', gitSha = '', buildTime = '' }: BuildInfoInput): BuildInfo => {
    const gitShaShort = gitSha ? gitSha.slice(0, 8) : '';
    return {
        appVersion,
        gitSha,
        gitShaShort,
        versionLabel: appVersion || '—',
        buildTimeUtc: formatBuildTimeUtc(buildTime),
    };
};

export const getBuildInfo = (): BuildInfo => {
    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
    const gitSha = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : '';
    const buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
    return formatBuildInfo({ appVersion, gitSha, buildTime });
};

export type BuildInfoRow = {
    label: string;
    value: string;
    testId: string;
};

export const getBuildInfoRows = (info: BuildInfo = getBuildInfo()): BuildInfoRow[] => [
    {
        label: 'Version',
        value: info.versionLabel,
        testId: 'build-info-version',
    },
    {
        label: 'Git ID',
        value: info.gitShaShort || '—',
        testId: 'build-info-git',
    },
    {
        label: 'Build Time',
        value: info.buildTimeUtc,
        testId: 'build-info-time',
    },
];
