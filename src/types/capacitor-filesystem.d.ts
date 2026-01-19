declare module '@capacitor/filesystem' {
  export enum Directory {
    Data = 'DATA',
    Cache = 'CACHE',
    Documents = 'DOCUMENTS',
    External = 'EXTERNAL',
    ExternalStorage = 'EXTERNAL_STORAGE',
  }

  export type ProgressStatus = { loaded: number; total?: number };

  export const Filesystem: {
    mkdir: (options: { directory: Directory; path: string; recursive?: boolean }) => Promise<void>;
    readFile: (options: { directory: Directory; path: string }) => Promise<{ data: string }>; 
    writeFile: (options: { directory: Directory; path: string; data: string }) => Promise<void>;
    downloadFile: (options: {
      url: string;
      directory: Directory;
      path: string;
      progress?: (status: ProgressStatus) => void;
    }) => Promise<{ path?: string }>;
  };
}
