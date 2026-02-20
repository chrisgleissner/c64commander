#!/usr/bin/env node
import { spawn } from 'node:child_process';

let activeChild = null;
let interruptedBySignal = null;

const runCommand = (command, args) => new Promise((resolve) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  activeChild = child;

  child.on('error', (error) => {
    console.error(`[screenshots] Failed to start ${command} ${args.join(' ')}:`, error);
    activeChild = null;
    resolve(1);
  });

  child.on('close', (code, signal) => {
    activeChild = null;
    if (signal) {
      console.error(`[screenshots] ${command} terminated by signal ${signal}.`);
      resolve(1);
      return;
    }
    resolve(code ?? 1);
  });
});

const forwardSignalAndMarkInterrupted = (signal) => {
  interruptedBySignal = interruptedBySignal ?? signal;
  if (activeChild) {
    activeChild.kill(signal);
  }
};

process.on('SIGINT', () => {
  forwardSignalAndMarkInterrupted('SIGINT');
});

process.on('SIGTERM', () => {
  forwardSignalAndMarkInterrupted('SIGTERM');
});

const main = async () => {
  const prePruneExitCode = await runCommand('npm', ['run', 'screenshots:prune-identical']);
  if (prePruneExitCode !== 0) {
    process.exitCode = prePruneExitCode;
    return;
  }

  const testExitCode = await runCommand('npm', ['run', 'screenshots:raw']);
  const pruneExitCode = await runCommand('npm', ['run', 'screenshots:prune-identical']);

  if (pruneExitCode !== 0) {
    process.exitCode = pruneExitCode;
    return;
  }

  process.exitCode = interruptedBySignal ? 130 : testExitCode;
};

main().catch((error) => {
  console.error('[screenshots] Unexpected failure:', error);
  process.exitCode = 1;
});
