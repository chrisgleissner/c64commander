import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const androidWorkflowPath = path.resolve(process.cwd(), '.github/workflows/android.yaml');
const iosWorkflowPath = path.resolve(process.cwd(), '.github/workflows/ios.yaml');

describe('android CI workflow regressions', () => {
  it('starts telemetry without launching a synthetic pre-session app process', () => {
    const workflow = readFileSync(androidWorkflowPath, 'utf8');

    expect(workflow).toContain('- name: Start Android telemetry monitor');
    expect(workflow).toContain('- name: Run Maestro gating flows');
    expect(workflow).not.toContain('- name: Install APK and prime telemetry');
    expect(workflow).not.toContain('Launching app for telemetry priming...');
    expect(workflow).not.toContain('Telemetry priming OK:');
  });
});

describe('iOS CI workflow regressions', () => {
  it('reuses a prepared simulator app in the Maestro lane', () => {
    const workflow = readFileSync(iosWorkflowPath, 'utf8');

    expect(workflow).toContain('- name: Build app for simulator');
    expect(workflow).toContain('- name: Stage prepared simulator app');
    expect(workflow).toContain('cp -R ios/build-prepared/Build/Products/Debug-iphonesimulator/App.app');
    expect(workflow).toContain('!ios/build-prepared/**');
    expect(workflow).toContain('--app-path "ios/prepared-simulator-app/App.app"');
    expect(workflow).toContain('- name: Ensure prepared simulator app exists');
    expect(workflow).not.toContain('--app-path "ios/build/Build/Products/Debug-iphonesimulator/App.app"');
  });

  it('writes the tag evidence archive outside the archived directory', () => {
    const workflow = readFileSync(iosWorkflowPath, 'utf8');

    expect(workflow).toContain('mkdir -p artifacts/_combined');
    expect(workflow).toContain('tar -czf artifacts/_combined/ios-maestro-evidence.tgz artifacts/ios');
    expect(workflow).toContain('path: artifacts/_combined/ios-maestro-evidence.tgz');
    expect(workflow).not.toContain('tar -czf artifacts/ios/_combined/ios-maestro-evidence.tgz artifacts/ios');
  });
});
