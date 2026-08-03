#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);

const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(filePath, 'utf8'));

const safeReadJson = async (filePath) => {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const normalizeLicense = (value) => {
  if (!value) return 'UNKNOWN';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.type === 'string') return value.type;
    if (Array.isArray(value)) {
      const licenses = value
        .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
        .filter(Boolean);
      return licenses.length ? licenses.join(' OR ') : 'UNKNOWN';
    }
  }
  return 'UNKNOWN';
};

const normalizeSource = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : '-';

// A package may carry no SPDX `license` field at all, or set it to
// "SEE LICENSE IN <file>", which npm defines as an instruction to read the bundled
// licence text. Either way the package itself states its terms; the generator reads
// that file rather than reporting the entry as UNKNOWN.
const LICENSE_FILE_NAMES = [
  'LICENSE',
  'LICENCE',
  'LICENSE.txt',
  'LICENCE.txt',
  'LICENSE.md',
  'License.txt',
  'license.txt',
  'COPYING',
  'COPYING.txt',
];

// Matched in order against the licence text with whitespace collapsed and lowercased,
// so the more specific variant of a family must come first.
const LICENSE_FINGERPRINTS = [
  {
    // 7-Zip is LGPL, but its RAR decompression carries a use restriction inherited from
    // unRAR: the sources may not be used to build a RAR-compatible archiver. SPDX has no
    // identifier for that restriction, so it is named after a WITH operator.
    license: 'LGPL-2.1-or-later WITH unRAR-restriction',
    matches: (text) =>
      text.includes('gnu lesser general public license') &&
      text.includes('unrar restriction'),
  },
  {
    license: 'LGPL-2.1-or-later',
    matches: (text) =>
      text.includes('gnu lesser general public license') &&
      text.includes(
        'version 2.1 of the license, or (at your option) any later version',
      ),
  },
  {
    license: 'MIT',
    matches: (text) =>
      text.includes('permission is hereby granted, free of charge') &&
      text.includes(
        'the above copyright notice and this permission notice shall be included',
      ),
  },
  {
    license: 'ISC',
    matches: (text) =>
      text.includes(
        'permission to use, copy, modify, and/or distribute this software for any purpose',
      ),
  },
  {
    // The third clause is the only thing separating BSD-3-Clause from BSD-2-Clause.
    license: 'BSD-3-Clause',
    matches: (text) =>
      text.includes('redistribution and use in source and binary forms') &&
      text.includes('neither the name'),
  },
  {
    license: 'BSD-2-Clause',
    matches: (text) =>
      text.includes('redistribution and use in source and binary forms') &&
      text.includes('redistributions in binary form must reproduce'),
  },
  {
    license: 'Apache-2.0',
    matches: (text) =>
      text.includes('apache license') && text.includes('version 2.0'),
  },
];

const safeReadText = async (filePath) => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return null;
    throw error;
  }
};

const isUnresolvedLicense = (license) =>
  !license || license === 'UNKNOWN' || /^SEE LICENSE IN\b/i.test(license);

const detectLicenseFromFiles = async (packageDir) => {
  for (const fileName of LICENSE_FILE_NAMES) {
    const text = await safeReadText(path.join(packageDir, fileName));
    if (!text) continue;

    const normalized = text.toLowerCase().replace(/\s+/g, ' ');
    const fingerprint = LICENSE_FINGERPRINTS.find((candidate) =>
      candidate.matches(normalized),
    );
    if (fingerprint) return fingerprint.license;
  }
  return null;
};

const licenseUrlFallbacks = new Map([
  ['JSON', 'https://www.json.org/license.html'],
  ['Public-Domain / BSD-style', 'https://tukaani.org/xz/java.html'],
  // Links the base licence; the unRAR restriction itself is stated in the package's
  // own License.txt and has no canonical URL.
  [
    'LGPL-2.1-or-later WITH unRAR-restriction',
    'https://spdx.org/licenses/LGPL-2.1-or-later.html',
  ],
]);

const resolveLicenseUrl = (license) => {
  if (!license || license === 'UNKNOWN') return '-';

  const fallback = licenseUrlFallbacks.get(license);
  if (fallback) return fallback;

  if (/\b(AND|OR|WITH)\b|\/|,|\(|\)/.test(license)) return '-';
  if (/^SEE LICENSE IN\b/i.test(license)) return '-';

  if (!/^[A-Za-z0-9-.+]+$/.test(license)) return '-';
  return `https://spdx.org/licenses/${encodeURIComponent(license)}.html`;
};

const packageNameFromLockPath = (lockPath) => {
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  if (index < 0) return null;
  const remainder = lockPath.slice(index + marker.length);
  if (!remainder) return null;
  const segments = remainder.split('/');
  if (segments[0].startsWith('@') && segments[1]) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0];
};

const collectNpmEntries = async () => {
  const lockfile = await readJson(path.join(rootDir, 'package-lock.json'));
  const packages = lockfile.packages ?? {};
  const entriesByName = new Map();

  for (const [lockPath, info] of Object.entries(packages)) {
    if (!lockPath || lockPath === '') continue;
    const name = packageNameFromLockPath(lockPath);
    if (!name) continue;

    const existing = entriesByName.get(name);
    const version =
      typeof info.version === 'string'
        ? info.version
        : (existing?.version ?? 'UNKNOWN');
    let license = normalizeLicense(info.license ?? existing?.license);

    if (license === 'UNKNOWN') {
      const packageJsonPath = path.join(rootDir, lockPath, 'package.json');
      const packageJson = await safeReadJson(packageJsonPath);
      if (packageJson) {
        license = normalizeLicense(packageJson.license);
      }
    }

    if (isUnresolvedLicense(license)) {
      const detected = await detectLicenseFromFiles(path.join(rootDir, lockPath));
      if (detected) license = detected;
    }

    entriesByName.set(name, {
      ecosystem: 'NPM',
      name,
      version,
      license,
      source: normalizeSource(info.resolved),
    });
  }

  return Array.from(entriesByName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
};

const readAndroidDeps = async () => {
  const gradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
  if (!(await fileExists(gradlePath))) {
    console.warn(
      `android dependency metadata missing at ${gradlePath}; skipping Gradle dependency extraction`,
    );
    return [];
  }
  const content = await fs.readFile(gradlePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const entries = [];

  const licenseByGroupPrefix = [
    ['androidx.', 'Apache-2.0'],
    ['commons-net', 'Apache-2.0'],
    ['org.apache.commons', 'Apache-2.0'],
    ['org.tukaani', 'Public-Domain / BSD-style'],
    ['junit', 'EPL-1.0'],
    ['org.mockito', 'MIT'],
    ['org.json', 'JSON'],
    ['com.google.errorprone', 'Apache-2.0'],
    ['com.google.code.findbugs', 'BSD-3-Clause'],
    ['org.robolectric', 'MIT'],
    ['org.jetbrains.kotlinx', 'Apache-2.0'],
  ];

  for (const line of lines) {
    const match = line.match(
      /^\s*(implementation|api|runtimeOnly|compileOnly)\s+"([^"]+)"/,
    );
    if (!match) continue;
    const coordinate = match[2].trim();
    const parts = coordinate.split(':');
    if (parts.length < 3) continue;

    const [group, artifact, version] = parts;
    const name = `${group}:${artifact}`;
    const license =
      licenseByGroupPrefix.find(([prefix]) => group.startsWith(prefix))?.[1] ??
      'UNKNOWN';

    entries.push({
      ecosystem: 'Gradle',
      name,
      version,
      license,
      source: normalizeSource(coordinate),
    });
  }

  entries.push(
    {
      ecosystem: 'Gradle',
      name: 'project(:capacitor-android)',
      version: '6.2.1',
      license: 'MIT',
      source: 'Capacitor Android runtime',
    },
    {
      ecosystem: 'Gradle',
      name: 'project(:capacitor-cordova-android-plugins)',
      version: '6.2.1',
      license: 'MIT',
      source: 'Capacitor Cordova bridge',
    },
  );

  const deduped = new Map();
  for (const entry of entries) {
    if (!deduped.has(entry.name)) deduped.set(entry.name, entry);
  }

  return Array.from(deduped.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
};

const readCocoapods = async () => {
  const entries = new Map();
  const podfileLockPath = path.join(rootDir, 'ios', 'App', 'Podfile.lock');
  const cocoapodsLicenseByName = new Map([
    ['Capacitor', 'MIT'],
    ['CapacitorCordova', 'MIT'],
    ['CapacitorFilesystem', 'MIT'],
    ['CapacitorShare', 'MIT'],
  ]);
  const cocoapodsSourceByName = new Map([
    ['Capacitor', 'https://github.com/ionic-team/capacitor.git'],
    ['CapacitorCordova', 'https://github.com/ionic-team/capacitor'],
    [
      'CapacitorFilesystem',
      'https://github.com/ionic-team/capacitor-plugins.git',
    ],
    ['CapacitorShare', 'https://github.com/ionic-team/capacitor-plugins.git'],
  ]);

  const resolveCocoapodsSource = (name, source) => {
    const normalized = normalizeSource(source);
    if (normalized === '-')
      return cocoapodsSourceByName.get(name) ?? normalized;
    if (/^\.\.\/\.\.\/node_modules\//.test(normalized)) {
      return cocoapodsSourceByName.get(name) ?? normalized;
    }
    return normalized;
  };

  if (await fileExists(podfileLockPath)) {
    const content = await fs.readFile(podfileLockPath, 'utf8');
    const lines = content.split(/\r?\n/);

    let section = '';
    let currentExternalSourcePod = null;
    const externalSourceByPod = new Map();

    for (const rawLine of lines) {
      const sectionMatch = rawLine.match(/^([A-Z][A-Z\s]+):\s*$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        currentExternalSourcePod = null;
        continue;
      }

      if (section === 'PODS') {
        const podMatch = rawLine.match(/^\s{2}-\s+([^\s(]+)\s+\(([^)]+)\)/);
        if (!podMatch) continue;
        const [, rawName, rawVersion] = podMatch;
        const name = rawName.replace(/^"|"$/g, '').trim();
        const version = rawVersion.trim();

        entries.set(name, {
          ecosystem: 'CocoaPods',
          name,
          version,
          license: cocoapodsLicenseByName.get(name) ?? 'UNKNOWN',
          source: cocoapodsSourceByName.get(name) ?? '-',
        });
        continue;
      }

      if (section === 'EXTERNAL SOURCES') {
        const podLineMatch = rawLine.match(/^\s{2}([^:]+):\s*$/);
        if (podLineMatch) {
          currentExternalSourcePod = podLineMatch[1].trim();
          continue;
        }

        const pathMatch = rawLine.match(/^\s{4}:path:\s+"([^"]+)"/);
        if (pathMatch && currentExternalSourcePod) {
          externalSourceByPod.set(currentExternalSourcePod, pathMatch[1]);
        }
      }
    }

    for (const [name, sourcePath] of externalSourceByPod.entries()) {
      const existing = entries.get(name);
      if (!existing) continue;
      entries.set(name, {
        ...existing,
        source: resolveCocoapodsSource(name, sourcePath),
      });
    }
  }

  const podspecDir = path.join(rootDir, 'ios', 'App', 'Pods', 'Local Podspecs');
  if (await fileExists(podspecDir)) {
    const fileNames = await fs.readdir(podspecDir);
    for (const fileName of fileNames) {
      if (!fileName.endsWith('.podspec.json')) continue;
      const podspec = await readJson(path.join(podspecDir, fileName));
      const name = podspec.name ?? fileName.replace('.podspec.json', '');
      const existing = entries.get(name);

      entries.set(name, {
        ecosystem: 'CocoaPods',
        name,
        version: podspec.version ?? existing?.version ?? 'UNKNOWN',
        license: normalizeLicense(podspec.license ?? existing?.license),
        source: resolveCocoapodsSource(
          name,
          podspec?.source?.git ?? podspec?.homepage ?? existing?.source,
        ),
      });
    }
  }

  return Array.from(entries.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
};

const readSwiftPm = async () => {
  const resolvedPath = path.join(
    rootDir,
    'ios',
    'native-tests',
    'Package.resolved',
  );
  const resolved = await safeReadJson(resolvedPath);
  if (!resolved) return [];

  const pins = Array.isArray(resolved.pins)
    ? resolved.pins
    : Array.isArray(resolved.object?.pins)
      ? resolved.object.pins
      : [];

  return pins
    .map((pin) => ({
      ecosystem: 'SwiftPM',
      name: pin.identity ?? pin.location ?? 'UNKNOWN',
      version:
        pin.state?.version ?? pin.state?.revision?.slice(0, 12) ?? 'UNKNOWN',
      license: 'UNKNOWN',
      source: normalizeSource(pin.location),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const escapeTableCell = (value) => value.replaceAll('|', '\\|');

const renderNotices = (entries) => {
  const header = '| Ecosystem | Package | Version | License | Source URL |';
  const separator = '| --- | --- | --- | --- | --- |';
  const rows = entries.map((entry) => {
    const licenseUrl = resolveLicenseUrl(entry.license);
    const linkedLicense =
      licenseUrl === '-' ? entry.license : `[${entry.license}](${licenseUrl})`;
    const source = entry.source || '-';
    const linkedSource = source === '-' ? '-' : `[${source}](${source})`;

    return `| ${escapeTableCell(entry.ecosystem)} | ${escapeTableCell(entry.name)} | ${escapeTableCell(entry.version)} | ${escapeTableCell(linkedLicense)} | ${escapeTableCell(linkedSource)} |`;
  });

  return [header, separator, ...rows].join('\n');
};

// Bundled data assets that are not npm/native dependencies (so they never
// appear in a lockfile) but must still be attributed. Curated here so
// generation and `--check` stay consistent.
const DATA_NOTICES = [
  '## Data notices',
  '',
  'The following bundled data assets are not npm/Gradle/CocoaPods/SwiftPM dependencies and are attributed separately:',
  '',
  '| Asset | Source | License |',
  '| --- | --- | --- |',
  '| SID Radio similarity bundle (`sidcorr-tiny-1`) | [chrisgleissner/sidflow-data](https://github.com/chrisgleissner/sidflow-data) | [GPL-3.0-or-later](https://www.gnu.org/licenses/gpl-3.0.html) |',
  '| libsidplayfp WASM engine (`public/wasm/libsidplayfp/`, from `libsidplayfp-wasm`) | [chrisgleissner/libsidplayfp-wasm](https://github.com/chrisgleissner/libsidplayfp-wasm) / [libsidplayfp](https://github.com/libsidplayfp/libsidplayfp) | [GPL-2.0-or-later](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) |',
  '',
  'The SID Radio similarity bundle is a compact, content-addressed index derived from analysis of the High Voltage SID Collection (HVSC, <https://www.hvsc.c64.org/>). SID tunes and their metadata remain the property of their respective composers and the HVSC team; this application bundles only the derived similarity index — not the SID files themselves and not any C64 ROM images.',
  '',
  'The libsidplayfp WASM engine powers on-device SID playback (the optional "This device" playback engine). libsidplayfp and libresidfp (the reSIDfp engine, an external library since libsidplayfp v3.x, linked into the same binary) are GPL-2.0-or-later, compatible with this application\'s GPL-3.0-or-later licence. Two builds of it ship: reSIDfp, the cycle-accurate default, and SIDLite, a cheaper approximation offered as the "Light" option. The binaries are not held in this repository — they come from the `libsidplayfp-wasm` npm package, pinned in `package.json` and the lockfile, and are copied verbatim into `public/wasm/libsidplayfp/` at build time by `scripts/sync-libsidplayfp-wasm.mjs` so they bundle into the application. The engine\'s own `LICENSE` and `THIRD-PARTY-NOTICES.md` are copied alongside them.',
  'C64 KERNAL/BASIC/CHARGEN ROM images are **not** distributed with this application. On-device playback needs the C64\'s own KERNAL and BASIC, so the app reads those images at the user\'s explicit request from the C64 device the user has connected to (`GET /v1/machine:readmem`, a DMA read). They are kept in that user\'s app-private storage on their own device, and are never uploaded, exported, shared or included in diagnostics bundles. The user is responsible for only connecting the app to devices they own or have been given permission to use. Without ROM images present, SID tunes are played on the C64 instead.',
  '',
].join('\n');

const parseArgs = () => {
  const args = process.argv.slice(2);
  return {
    check: args.includes('--check'),
  };
};

const writeOrCheck = async ({ targetPath, content, check }) => {
  if (!check) {
    await fs.writeFile(targetPath, content, 'utf8');
    return;
  }

  let existing = null;
  try {
    existing = await fs.readFile(targetPath, 'utf8');
  } catch {
    existing = null;
  }

  if (typeof existing !== 'string' || existing !== content) {
    throw new Error(
      `notice drift detected: ${path.relative(rootDir, targetPath)}`,
    );
  }
};

const main = async () => {
  const { check } = parseArgs();
  const [npmEntries, gradleEntries, cocoapodsEntries, swiftPmEntries] =
    await Promise.all([
      collectNpmEntries(),
      readAndroidDeps(),
      readCocoapods(),
      readSwiftPm(),
    ]);

  const allEntries = [
    ...npmEntries,
    ...gradleEntries,
    ...cocoapodsEntries,
    ...swiftPmEntries,
  ];
  const unknownCount = allEntries.filter(
    (entry) => entry.license === 'UNKNOWN',
  ).length;

  const markdown = [
    '# Third-Party Notices',
    '',
    'This file is generated by `scripts/generate-third-party-notices.mjs` using local dependency metadata and lockfiles.',
    '',
    `Summary: ${allEntries.length} dependencies across NPM (${npmEntries.length}), Gradle (${gradleEntries.length}), CocoaPods (${cocoapodsEntries.length}), SwiftPM (${swiftPmEntries.length}).`,
    '',
    '## Dependency notices',
    '',
    renderNotices(allEntries),
    '',
    DATA_NOTICES,
  ].join('\n');

  await writeOrCheck({
    targetPath: path.join(rootDir, 'THIRD_PARTY_NOTICES.md'),
    content: markdown,
    check,
  });

  if (check) {
    console.log(
      `third-party notices check passed (${allEntries.length} entries, ${unknownCount} unknown licenses)`,
    );
    return;
  }

  console.log(
    `third-party notices generated (${allEntries.length} entries, ${unknownCount} unknown licenses)`,
  );
};

main().catch((error) => {
  console.error('third-party notice generation failed', error);
  process.exitCode = 1;
});
