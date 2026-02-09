import { registerPlugin } from '@capacitor/core';

export type BackgroundExecutionPlugin = {
    start: () => Promise<void>;
    stop: () => Promise<void>;
};

export const BackgroundExecution = registerPlugin<BackgroundExecutionPlugin>('BackgroundExecution', {
    web: () => import('./backgroundExecution.web').then((m) => new m.BackgroundExecutionWeb()),
});
