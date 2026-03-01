#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const safeReadJson = async (filePath) => {
  try {
    return await readJson(filePath);
  } catch (error) {
    if ((error)?.code === 'ENOENT') return null;
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

const normalizeSource = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : '-');

const licenseUrlFallbacks = new Map([
  ['JSON', 'https://www.json.org/license.html'],
  ['Public-Domain / BSD-style', 'https://tukaani.org/xz/java.html'],
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
    const version = typeof info.version === 'string' ? info.version : existing?.version ?? 'UNKNOWN';
    let license = normalizeLicense(info.license ?? existing?.license);

    if (license === 'UNKNOWN') {
      const packageJsonPath = path.join(rootDir, lockPath, 'package.json');
      const packageJson = await safeReadJson(packageJsonPath);
      if (packageJson) {
        license = normalizeLicense(packageJson.license);
      }
    }

    entriesByName.set(name, {
      ecosystem: 'NPM',
      name,
      version,
      license,
      source: normalizeSource(info.resolved),
    });
  }

  return Array.from(entriesByName.values()).sort((a, b) => a.name.localeCompare(b.name));
};

const readAndroidDeps = async () => {
  const gradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
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
    const match = line.match(/^\s*(implementation|api|runtimeOnly|compileOnly)\s+"([^"]+)"/);
    if (!match) continue;
    const coordinate = match[2].trim();
    const parts = coordinate.split(':');
    if (parts.length < 3) continue;

    const [group, artifact, version] = parts;
    const name = `${group}:${artifact}`;
    const license = licenseByGroupPrefix.find(([prefix]) => group.startsWith(prefix))?.[1] ?? 'UNKNOWN';

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

  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
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
    ['CapacitorFilesystem', 'https://github.com/ionic-team/capacitor-plugins.git'],
    ['CapacitorShare', 'https://github.com/ionic-team/capacitor-plugins.git'],
  ]);

  const resolveCocoapodsSource = (name, source) => {
    const normalized = normalizeSource(source);
    if (normalized === '-') return cocoapodsSourceByName.get(name) ?? normalized;
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
        source: resolveCocoapodsSource(name, podspec?.source?.git ?? podspec?.homepage ?? existing?.source),
      });
    }
  }

  return Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name));
};

const readSwiftPm = async () => {
  const resolvedPath = path.join(rootDir, 'ios', 'native-tests', 'Package.resolved');
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
      version: pin.state?.version ?? pin.state?.revision?.slice(0, 12) ?? 'UNKNOWN',
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
    const linkedLicense = licenseUrl === '-'
      ? entry.license
      : `[${entry.license}](${licenseUrl})`;
    const source = entry.source || '-';
    const linkedSource = source === '-'
      ? '-'
      : `[${source}](${source})`;

    return `| ${escapeTableCell(entry.ecosystem)} | ${escapeTableCell(entry.name)} | ${escapeTableCell(entry.version)} | ${escapeTableCell(linkedLicense)} | ${escapeTableCell(linkedSource)} |`;
  });

  return [header, separator, ...rows].join('\n');
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
    throw new Error(`notice drift detected: ${path.relative(rootDir, targetPath)}`);
  }
};

const main = async () => {
  const { check } = parseArgs();
  const [npmEntries, gradleEntries, cocoapodsEntries, swiftPmEntries] = await Promise.all([
    collectNpmEntries(),
    readAndroidDeps(),
    readCocoapods(),
    readSwiftPm(),
  ]);

  const allEntries = [...npmEntries, ...gradleEntries, ...cocoapodsEntries, ...swiftPmEntries];
  const unknownCount = allEntries.filter((entry) => entry.license === 'UNKNOWN').length;

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
  ].join('\n');

  await writeOrCheck({
    targetPath: path.join(rootDir, 'THIRD_PARTY_NOTICES.md'),
    content: markdown,
    check,
  });

  if (check) {
    console.log(`third-party notices check passed (${allEntries.length} entries, ${unknownCount} unknown licenses)`);
    return;
  }

  console.log(`third-party notices generated (${allEntries.length} entries, ${unknownCount} unknown licenses)`);
};

main().catch((error) => {
  console.error('third-party notice generation failed', error);
  process.exitCode = 1;
});
