#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export const normalizeLicense = (value) => {
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

// 7-Zip is LGPL, but its RAR decompression carries a use restriction inherited from
// unRAR. SPDX has no identifier for that restriction, so it is named after a WITH
// operator and defined in the Licence notes section of the generated file.
export const UNRAR_LICENSE_ID = 'LGPL-2.1-or-later WITH unRAR-restriction';

export const LICENSE_NOTES = [
  '## Licence notes',
  '',
  'Identifiers below that are not plain SPDX expressions are defined here.',
  '',
  `### ${UNRAR_LICENSE_ID}`,
  '',
  'The package is [LGPL-2.1-or-later](https://spdx.org/licenses/LGPL-2.1-or-later.html), with one additional restriction that SPDX has no identifier for. Its own `License.txt` states that the RAR decompression engine was developed from unRAR sources, and that:',
  '',
  '> The unRAR sources cannot be used to re-create the RAR compression algorithm, which is proprietary. Distribution of modified unRAR sources in separate form or as a part of other software is permitted, provided that it is clearly stated in the documentation and source comments that the code may not be used to develop a RAR (WinRAR) compatible archiver.',
  '',
  'The restriction attaches to the files implementing RAR support. The full text ships in the package as `License.txt` and `unRarLicense.txt`.',
].join('\n');

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
    license: UNRAR_LICENSE_ID,
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

export const isUnresolvedLicense = (license) =>
  !license || license === 'UNKNOWN' || /^SEE LICENSE IN\b/i.test(license);

export const detectLicenseFromFiles = async (packageDir) => {
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
  // SPDX has no identifier for the unRAR restriction, so the link cannot point there.
  // It points instead at the Licence notes section below, which states the restriction
  // and links the base licence, so following the link is self-contained.
  [UNRAR_LICENSE_ID, '#licence-notes'],
]);

export const resolveLicenseUrl = (license) => {
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
  'SID Radio collections (such as competition winners or movie themes) are derived on the user\'s device from the SID Tune Information List (STIL), which the HVSC team writes and ships inside HVSC as `DOCUMENTS/STIL.txt`. The application reads the copy that comes with the user\'s own HVSC download and bundles no part of STIL.',
  '',
  'The libsidplayfp WASM engine powers on-device SID playback (the optional "This device" playback engine). libsidplayfp and libresidfp (the reSIDfp engine, an external library since libsidplayfp v3.x, linked into the same binary) are GPL-2.0-or-later, compatible with this application\'s GPL-3.0-or-later licence. Two builds of it ship: reSIDfp, the cycle-accurate default, and SIDLite, a cheaper approximation offered as the "Light" option. The binaries are not held in this repository — they come from the `libsidplayfp-wasm` npm package, pinned in `package.json` and the lockfile, and are copied verbatim into `public/wasm/libsidplayfp/` at build time by `scripts/sync-libsidplayfp-wasm.mjs` so they bundle into the application. The engine\'s own `LICENSE` and `THIRD-PARTY-NOTICES.md` are copied alongside them.',
  'C64 KERNAL/BASIC/CHARGEN ROM images are **not** distributed with this application. On-device playback needs the C64\'s own KERNAL and BASIC, so the app reads those images at the user\'s explicit request from the C64 device the user has connected to (`GET /v1/machine:readmem`, a DMA read). They are kept in that user\'s app-private storage on their own device, and are never uploaded, exported, shared or included in diagnostics bundles. The user is responsible for only connecting the app to devices they own or have been given permission to use. Without ROM images present, SID tunes are played on the C64 instead.',
  '',
].join('\n');

// Native libraries compiled from source by the Android build and packaged into the APK. They are in
// no lockfile, so they are described here, with their pins read from android/app/build.gradle so
// this file cannot name a different revision from the one that is built.
const BSD_3_CLAUSE_TEXT = [
  '> Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:',
  '>',
  '> 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.',
  '> 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.',
  '> 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.',
  '>',
  '> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',
];

export const readNativePins = (gradleText) => {
  const value = (name) => {
    const match = new RegExp(`def ${name} = "([^"]+)"`).exec(gradleText);
    if (!match)
      throw new Error(`android/app/build.gradle does not define ${name}`);
    return match[1];
  };
  const revision = value('libsidplayezRevision');
  return {
    libsidplayez: {
      revision,
      url: value('libsidplayezSourceUrl').replace(
        '${libsidplayezRevision}',
        revision,
      ),
      sha256: value('libsidplayezSourceSha256'),
    },
    sevenZip: {
      url: value('upstream7zipSourceUrl'),
      sha256: value('upstream7zipSourceSha256'),
    },
  };
};

export const renderNativeNotices = ({ libsidplayez, sevenZip }) => {
  const sevenZipVersion =
    (/7z(\d{2})(\d{2})-src/.exec(sevenZip.url) ?? []).slice(1).join('.') ||
    'pinned';
  return [
    '## Native components (Android)',
    '',
    "The Android build compiles these from pinned, checksum-verified source archives and packages the resulting libraries into the app. Their license texts are packaged too, under `licenses/` in the app's web assets. They are not part of the web or iOS builds.",
    '',
    '| Component | Version | Source (SHA-256 of the archive) | License |',
    '| --- | --- | --- | --- |',
    `| libSidplayEZ (\`libc64sidplayez.so\`), the "Fast & accurate" SID renderer | commit ${libsidplayez.revision.slice(0, 12)} | [${libsidplayez.url}](${libsidplayez.url}) (\`${libsidplayez.sha256}\`) | [GPL-2.0-or-later](https://spdx.org/licenses/GPL-2.0-or-later.html) |`,
    `| 7-Zip (\`lib7zz.so\`), used to unpack the HVSC archive | ${sevenZipVersion} | [${sevenZip.url}](${sevenZip.url}) (\`${sevenZip.sha256}\`) | [LGPL-2.1-or-later](https://spdx.org/licenses/LGPL-2.1-or-later.html), with BSD-3-Clause and BSD-2-Clause parts |`,
    '| LLVM libc++ and libc++abi, linked statically into both libraries by the Android NDK | NDK r27 | [https://github.com/llvm/llvm-project](https://github.com/llvm/llvm-project) | [Apache-2.0 WITH LLVM-exception](https://spdx.org/licenses/LLVM-exception.html) |',
    '',
    '### libSidplayEZ',
    '',
    "libSidplayEZ is Michael Hartmann's modified version of libsidplayfp, the C64 music player library by Leandro Nini, which integrates the reSIDfp SID chip emulation into a cycle-based C64 emulator. It is GPL-2.0-or-later, compatible with this application's GPL-3.0-or-later license.",
    '',
    'The compiled files carry these copyright notices: Copyright 2000-2001 Simon White; Copyright 2001 and 2004, 2010 Dag Lem; Copyright 2007-2010 Antti Lankila; Copyright 2009-2018 VICE Project; Copyright 2011-2025 Leandro Nini; Copyright 2023-2026 Michael Hartmann; Copyright (C) Michael Schwendt; Copyright (C) 1989-1997 André Fachat; Copyright (C) 1999 Aladdin Enterprises. The `AUTHORS` files credit, in order of contribution: Dag Lem (reSID), Michael Schwendt (SidTune library, MD5 wrapper), Simon White (libsidplay2), Antti Lankila (reSID-fp, distortion and combined waveforms), Ken Händel (conversion of reSID to Java), Leandro Nini (libsidplayfp, the C++ port and merge with reSID 1.0), André Fachat (reloc65) and Michael Hartmann (libSidplayEZ); the VIC-II, CIA and CPU-port emulation is based on VICE code, and CIA serial port and interrupt handling on the Denise emulator. The license (`COPYING`), both `AUTHORS` files and the README are packaged under `licenses/libsidplayez/`.',
    '',
    "What this application changes. The build compiles every file under `src/` except `src/EZ/*.cpp`, the ultraSID application layer (chip profiles selected by file path, SID player identification, digi selection), which this application does not use. On 2026-10-11 Christian Gleissner modified four upstream files, `src/player.h`, `src/player.cpp`, `src/sidemu.h` and `src/sidplayfp/residfp/SID.h`, with the patch `android/app/src/main/cpp/sidplayez/patches/0001-match-residfp-output.patch`; each modified file carries a notice saying so. The patch adds `Player::set8580ExternalInput` (with `sidemu::filter8580ExternalInput` and `SID::set8580ExternalInput`), which drives the 8580's EXT IN pin as libsidplayfp's digiBoost option does; `Player::setStartupDeclick` (with `sidemu::disarmStartupDeclick` and `SID::disarmStartupDeclick`), a switch for libSidplayEZ's start-up declick whose default is unchanged; and `Player::setChipSetup`, a hook that `sidCreate` runs on each new chip before the power-on warm-up. It changes one behaviour: `Player::initialise` waited up to about 935 emulated seconds for a PSID's init routine to return and then failed the load; it now waits about 10 emulated seconds, as its comment states, and then lets the tune play on, as libsidplayfp does. The application drives `libsidplayfp::Player` through its own JNI wrapper (`android/app/src/main/cpp/sidplayez/`, GPL-3.0-or-later), which chooses the fallback SID model from the application's setting, sets the analogue model so that the output matches reSIDfp's, places a tune's second and third chips in stereo as reSIDfp does, and converts the engine's float output to 16-bit samples.",
    '',
    `Corresponding source: the archive above, of upstream commit \`${libsidplayez.revision}\` (also at [https://github.com/chrisgleissner/libSidplayEZ/tree/${libsidplayez.revision}](https://github.com/chrisgleissner/libSidplayEZ/tree/${libsidplayez.revision})), together with this application\'s source at the matching release tag, which contains the patch; \`android/scripts/build-libsidplayez.sh\` applies it and rebuilds the library.`,
    '',
    'The MD5 implementation in libSidplayEZ (`src/MD5/`) was derived by Michael Schwendt from code by L. Peter Deutsch, under this notice:',
    '',
    '> Copyright (C) 1999 Aladdin Enterprises. All rights reserved.',
    '>',
    "> This software is provided 'as-is', without any express or implied warranty. In no event will the authors be held liable for any damages arising from the use of this software.",
    '>',
    '> Permission is granted to anyone to use this software for any purpose, including commercial applications, and to alter it and redistribute it freely, subject to the following restrictions:',
    '>',
    '> 1. The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.',
    '> 2. Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.',
    '> 3. This notice may not be removed or altered from any source distribution.',
    '>',
    '> L. Peter Deutsch, ghost@aladdin.com',
    '',
    '### 7-Zip',
    '',
    `7-Zip Copyright (C) 1999-2026 Igor Pavlov, licensed under the GNU LGPL 2.1 or later. The library is built with \`DISABLE_RAR=1\`, so the RAR code and its unRAR license restriction are not part of it. The build script removes \`-Werror\` from 7-Zip\'s \`7zip_gcc.mak\`; no source file is changed. Corresponding source: the archive above, rebuilt by \`android/scripts/build-upstream-7zip.sh\`.`,
    '',
    "Its LZFSE decoder (derived from Apple's LZFSE library; Copyright (c) 2015-2016, Apple Inc. All rights reserved.) and Zstandard decoder (developed with reference to Facebook's zstd decoder; Copyright (c) Facebook, Inc. All rights reserved.), Copyright (c) 2023-2026 Igor Pavlov, are under the BSD 3-Clause License:",
    '',
    ...BSD_3_CLAUSE_TEXT,
    '',
    "Its XXH64 code (derived from Yann Collet's; Copyright (c) 2012-2021 Yann Collet, Copyright (c) 2023-2026 Igor Pavlov) is under the BSD 2-Clause License, whose terms are the first two conditions and the disclaimer above.",
    '',
  ].join('\n');
};

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

  // Only emitted when an entry actually uses a non-SPDX identifier, so the anchor the
  // table links to exists exactly when something links to it.
  const needsLicenseNotes = allEntries.some(
    (entry) => entry.license === UNRAR_LICENSE_ID,
  );

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
    ...(needsLicenseNotes ? [LICENSE_NOTES, ''] : []),
    renderNativeNotices(
      readNativePins(
        await fs.readFile(
          path.join(rootDir, 'android', 'app', 'build.gradle'),
          'utf8',
        ),
      ),
    ),
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

// Only generate when run as a script. The licence helpers above are imported by
// tests, which must not trigger a full notices run as a side effect.
const isDirectInvocation = () => {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
};

if (isDirectInvocation()) {
  main().catch((error) => {
    console.error('third-party notice generation failed', error);
    process.exitCode = 1;
  });
}
