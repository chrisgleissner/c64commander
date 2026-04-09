import { existsSync, readFileSync } from 'node:fs';

export const loadPerfIterationArtifact = ({ rawFile, exitStatus }) => {
    if (!existsSync(rawFile)) {
        return null;
    }

    const parsed = JSON.parse(readFileSync(rawFile, 'utf8'));
    return {
        ...parsed,
        runnerExitCode: exitStatus ?? 0,
        runnerStatus: exitStatus === 0 ? 'passed' : 'failed',
    };
};
