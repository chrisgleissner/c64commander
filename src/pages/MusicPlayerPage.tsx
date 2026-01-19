import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Music, Shuffle, SkipBack, SkipForward, Play, Folder, FolderOpen } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSidPlayer } from '@/hooks/useSidPlayer';
import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';
import { FolderPicker } from '@/lib/native/folderPicker';
import {
  buildHvscIndex,
  checkHvscUpdate,
  downloadHvscArchive,
  extractHvscArchive,
  getHvscMeta,
  HvscIndex,
  isHvscExtractionSupported,
  loadHvscIndex,
  readHvscSidFile,
  resolveDurationMs,
  setHvscMeta,
} from '@/lib/sid/hvsc';

const formatTime = (ms?: number) => {
  if (!ms && ms !== 0) return '—';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

type LocalSidFile = File | {
  name: string;
  webkitRelativePath?: string;
  lastModified: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type FileSystemHandleLike = {
  kind: 'file' | 'directory';
  name: string;
};

type FileSystemFileHandleLike = FileSystemHandleLike & {
  kind: 'file';
  getFile: () => Promise<File>;
};

type FileSystemDirectoryHandleLike = FileSystemHandleLike & {
  kind: 'directory';
  entries: () => AsyncIterableIterator<[string, FileSystemHandleLike]>;
};

const isDirectoryHandle = (handle: FileSystemHandleLike): handle is FileSystemDirectoryHandleLike =>
  handle.kind === 'directory' && 'entries' in handle;

const normalizeLocalPath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

const getLocalPath = (file: LocalSidFile) =>
  normalizeLocalPath(file.webkitRelativePath || file.name);

const base64ToArrayBuffer = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

const buildTrackFromPath = async (
  path: string,
  index: HvscIndex | null,
) => {
  const data = await readHvscSidFile(path);
  const durationMs = await resolveDurationMs(data.buffer, index, path);
  return {
    id: `${path}-${Date.now()}`,
    title: path.split('/').pop() || path,
    source: 'hvsc' as const,
    path,
    data,
    durationMs,
  };
};

export default function MusicPlayerPage() {
  const {
    queue,
    currentTrack,
    elapsedMs,
    durationMs,
    shuffle,
    isPlaying,
    setShuffle,
    playQueue,
    playTrack,
    next,
    previous,
  } = useSidPlayer();

  const [hvscIndex, setHvscIndex] = useState<HvscIndex | null>(null);
  const [hvscLoading, setHvscLoading] = useState(false);
  const [hvscProgress, setHvscProgress] = useState<number | null>(null);
  const [hvscActionLabel, setHvscActionLabel] = useState<string | null>(null);
  const [hvscFolderFilter, setHvscFolderFilter] = useState('');
  const [selectedHvscFolder, setSelectedHvscFolder] = useState<string>('');
  const [localFiles, setLocalFiles] = useState<LocalSidFile[]>([]);
  const [localFolderFilter, setLocalFolderFilter] = useState('');
  const [selectedLocalFolder, setSelectedLocalFolder] = useState('');
  const localInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadHvscIndex().then(setHvscIndex);
  }, []);

  const hvscFolderOptions = useMemo(() => {
    if (!hvscIndex) return [];
    if (!hvscFolderFilter) return hvscIndex.folderPaths;
    return hvscIndex.folderPaths.filter((folder) =>
      folder.toLowerCase().includes(hvscFolderFilter.toLowerCase()),
    );
  }, [hvscIndex, hvscFolderFilter]);

  const hvscTracks = useMemo(() => {
    if (!hvscIndex || !selectedHvscFolder) return [];
    return hvscIndex.trackPaths.filter((path) =>
      path.toLowerCase().startsWith(selectedHvscFolder.toLowerCase()),
    );
  }, [hvscIndex, selectedHvscFolder]);

  const localFolders = useMemo(() => {
    const folders = new Set<string>();
    localFiles.forEach((file) => {
      const path = getLocalPath(file);
      const parts = path.split('/').filter(Boolean);
      if (parts.length > 1) {
        parts.pop();
        folders.add(`/${parts.join('/')}`);
      }
    });
    const list = Array.from(folders).sort();
    if (!localFolderFilter) return list;
    return list.filter((folder) => folder.toLowerCase().includes(localFolderFilter.toLowerCase()));
  }, [localFiles, localFolderFilter]);

  const localTracks = useMemo(() => {
    if (!selectedLocalFolder) return [];
    return localFiles.filter((file) => {
      const path = getLocalPath(file);
      return path.toLowerCase().startsWith(selectedLocalFolder.toLowerCase());
    });
  }, [localFiles, selectedLocalFolder]);

  const handleHvscUpdate = async () => {
    if (!isHvscExtractionSupported()) {
      const message = 'HVSC extraction requires the native app build.';
      toast({ title: 'Not supported', description: message, variant: 'destructive' });
      addErrorLog('HVSC update not supported', { reason: message });
      return;
    }
    let currentAction: string | null = null;
    try {
      setHvscLoading(true);
      setHvscProgress(0);
      currentAction = 'Checking for updates…';
      setHvscActionLabel(currentAction);
      const result = await checkHvscUpdate();
      if (result.throttled) {
        toast({ title: 'Check throttled', description: 'Try again later.' });
        return;
      }
      if (!result.archiveChanged && !result.updateChanged) {
        toast({ title: 'HVSC up to date', description: 'No new updates detected.' });
      } else {
        const useUpdate = result.updateChanged;
        currentAction = useUpdate ? 'Downloading update…' : 'Downloading archive…';
        setHvscActionLabel(currentAction);
        const archivePath = await downloadHvscArchive(useUpdate, setHvscProgress);
        currentAction = 'Extracting archive…';
        setHvscActionLabel(currentAction);
        setHvscProgress(0);
        await extractHvscArchive(archivePath, setHvscProgress);
        currentAction = 'Indexing tracks…';
        setHvscActionLabel(currentAction);
        const index = await buildHvscIndex();
        const meta = getHvscMeta();
        setHvscMeta({
          ...meta,
          lastDownloadedAt: new Date().toISOString(),
        });
        setHvscIndex(index);
        toast({
          title: 'HVSC updated',
          description: `${index.totalTracks.toLocaleString()} tracks indexed.`,
        });
      }
    } catch (error) {
      addErrorLog('HVSC update failed', {
        error: {
          name: (error as Error).name,
          message: (error as Error).message,
          stack: (error as Error).stack,
        },
        online: navigator.onLine,
        isNative: isHvscExtractionSupported(),
        action: currentAction ?? hvscActionLabel,
      });
      toast({
        title: 'Error',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setHvscLoading(false);
      setHvscProgress(null);
      setHvscActionLabel(null);
    }
  };


  const handlePlayHvscTrack = async (path: string) => {
    if (!hvscIndex) return;
    try {
      const track = await buildTrackFromPath(path, hvscIndex);
      await playTrack(track);
      toast({ title: 'Playing', description: track.title });
    } catch (error) {
      addErrorLog('HVSC track playback failed', { path, error: (error as Error).message });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handlePlayHvscFolder = async () => {
    if (!hvscIndex || !hvscTracks.length) return;
    try {
      const tracks = await Promise.all(
        hvscTracks.map((path) => buildTrackFromPath(path, hvscIndex)),
      );
      const queue = shuffle ? tracks.sort(() => Math.random() - 0.5) : tracks;
      await playQueue(queue);
      toast({
        title: 'Playing folder',
        description: `${queue.length.toLocaleString()} tracks queued`,
      });
    } catch (error) {
      addErrorLog('HVSC folder playback failed', { folder: selectedHvscFolder, error: (error as Error).message });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleLocalFolderBrowse = async () => {
    if (Capacitor.getPlatform() === 'android') {
      try {
        const result = await FolderPicker.pickDirectory();
        const files: LocalSidFile[] = result.files.map((entry) => ({
          name: entry.name,
          webkitRelativePath: entry.path,
          lastModified: Date.now(),
          arrayBuffer: async () => {
            const data = await FolderPicker.readFile({ uri: entry.uri });
            return base64ToArrayBuffer(data.data);
          },
        }));
        setLocalFiles(files);
      } catch (error) {
        addErrorLog('Local folder pick failed', {
          error: {
            name: (error as Error).name,
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
        });
        toast({
          title: 'Folder selection failed',
          description: (error as Error).message,
          variant: 'destructive',
        });
      }
      return;
    }
    const picker = (window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
    }).showDirectoryPicker;
    if (!picker) {
      localInputRef.current?.click();
      return;
    }
    try {
      const directoryHandle = await picker();
      const files: File[] = [];

      const walkDirectory = async (dirHandle: FileSystemDirectoryHandleLike, prefix: string) => {
        for await (const [name, handle] of dirHandle.entries()) {
          if (handle.kind === 'file') {
            const file = await (handle as FileSystemFileHandleLike).getFile();
            if (!file.name.toLowerCase().endsWith('.sid')) continue;
            Object.defineProperty(file, 'webkitRelativePath', {
              value: `${prefix}${name}`,
            });
            files.push(file);
          } else if (isDirectoryHandle(handle)) {
            await walkDirectory(handle, `${prefix}${name}/`);
          }
        }
      };

      await walkDirectory(directoryHandle, '');
      setLocalFiles(files);
    } catch (error) {
      addErrorLog('Local folder pick failed', {
        error: {
          name: (error as Error).name,
          message: (error as Error).message,
          stack: (error as Error).stack,
        },
      });
      localInputRef.current?.click();
    }
  };

  const handleLocalFolderPick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).filter((file) => file.name.toLowerCase().endsWith('.sid'));
    setLocalFiles(list);
  };

  useEffect(() => {
    if (!localInputRef.current) return;
    localInputRef.current.setAttribute('webkitdirectory', '');
    localInputRef.current.setAttribute('directory', '');
  }, []);

  const handlePlayLocalFolder = async () => {
    if (!localTracks.length) return;
    try {
      const tracks = await Promise.all(
        localTracks.map(async (file) => {
          const buffer = await file.arrayBuffer();
          const data = new Uint8Array(buffer);
          const duration = hvscIndex
            ? await resolveDurationMs(buffer, hvscIndex)
            : undefined;
          return {
            id: `${file.name}-${file.lastModified}`,
            title: file.name,
            source: 'local' as const,
            file: file instanceof File ? file : undefined,
            data,
            durationMs: duration,
          };
        }),
      );
      const queue = shuffle ? tracks.sort(() => Math.random() - 0.5) : tracks;
      await playQueue(queue);
      toast({ title: 'Playing folder', description: `${queue.length} tracks queued` });
    } catch (error) {
      addErrorLog('Local folder playback failed', { folder: selectedLocalFolder, error: (error as Error).message });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handlePlayRandomLocalFolder = async () => {
    if (!localFolders.length) return;
    const randomFolder = localFolders[Math.floor(Math.random() * localFolders.length)];
    setSelectedLocalFolder(randomFolder);
    const tracks = localFiles.filter((file) => {
      const path = getLocalPath(file);
      return path.toLowerCase().startsWith(randomFolder.toLowerCase());
    });

    if (!tracks.length) return;
    try {
      const queueTracks = await Promise.all(
        tracks.map(async (file) => {
          const buffer = await file.arrayBuffer();
          const data = new Uint8Array(buffer);
          const duration = hvscIndex ? await resolveDurationMs(buffer, hvscIndex) : undefined;
          return {
            id: `${file.name}-${file.lastModified}`,
            title: file.name,
            source: 'local' as const,
            file: file instanceof File ? file : undefined,
            data,
            durationMs: duration,
          };
        }),
      );
      const queue = shuffle ? queueTracks.sort(() => Math.random() - 0.5) : queueTracks;
      await playQueue(queue);
      toast({
        title: 'Playing random folder',
        description: randomFolder,
      });
    } catch (error) {
      addErrorLog('Random local folder playback failed', { folder: randomFolder, error: (error as Error).message });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handlePlayLocalTrack = async (file: LocalSidFile) => {
    try {
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);
      const duration = hvscIndex ? await resolveDurationMs(buffer, hvscIndex) : undefined;
      await playTrack({
        id: `${file.name}-${file.lastModified}`,
        title: file.name,
        source: 'local',
        file: file instanceof File ? file : undefined,
        data,
        durationMs: duration,
      });
      toast({ title: 'Playing', description: file.name });
    } catch (error) {
      addErrorLog('Local track playback failed', { file: file.name, error: (error as Error).message });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const progressPercent = durationMs ? Math.min(100, (elapsedMs / durationMs) * 100) : 0;

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Music className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="c64-header text-xl">SID Player</h1>
              <p className="text-xs text-muted-foreground">
                HVSC + local collections with live playback control
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-4 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Now Playing</p>
              <p className="font-medium">
                {currentTrack?.title ?? 'No track selected'}
              </p>
              <p className="text-xs text-muted-foreground">
                {currentTrack?.path ?? currentTrack?.source?.toUpperCase() ?? '—'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={shuffle}
                onCheckedChange={(checked) => setShuffle(Boolean(checked))}
              />
              <span className="text-xs text-muted-foreground">Shuffle</span>
            </div>
          </div>

          <div className="space-y-2">
            <Progress value={progressPercent} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatTime(elapsedMs)}</span>
              <span>{formatTime(durationMs)}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="icon" onClick={() => previous()} disabled={!queue.length}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="default"
              size="lg"
              onClick={() => currentTrack && playTrack(currentTrack)}
              disabled={!currentTrack}
            >
              <Play className="h-4 w-4 mr-2" />
              {isPlaying ? 'Restart' : 'Play'}
            </Button>
            <Button variant="outline" size="icon" onClick={() => next()} disabled={!queue.length}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>

        <Tabs defaultValue="hvsc" className="space-y-4">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="hvsc">HVSC Library</TabsTrigger>
            <TabsTrigger value="local">Local Library</TabsTrigger>
          </TabsList>

          <TabsContent value="hvsc" className="space-y-4">
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">HVSC Collection</p>
                  <p className="text-xs text-muted-foreground">
                    {hvscIndex
                      ? `${hvscIndex.totalTracks.toLocaleString()} tracks indexed`
                      : 'No collection downloaded'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleHvscUpdate}
                    disabled={
                      hvscLoading ||
                      !isHvscExtractionSupported()
                    }
                  >
                    {hvscLoading ? 'Updating…' : 'Update'}
                  </Button>
                </div>
              </div>
              {!isHvscExtractionSupported() && (
                <p className="text-xs text-muted-foreground">
                  HVSC updates require the native app build.
                </p>
              )}
              {hvscActionLabel && (
                <p className="text-xs text-muted-foreground">{hvscActionLabel}</p>
              )}
              {hvscProgress !== null && (
                <Progress value={hvscProgress} />
              )}
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Browse folders</p>
                  <p className="text-xs text-muted-foreground">Play a folder recursively</p>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handlePlayHvscFolder}
                  disabled={!hvscTracks.length}
                >
                  Play folder
                </Button>
              </div>

              <Input
                placeholder="Filter folders…"
                value={hvscFolderFilter}
                onChange={(e) => setHvscFolderFilter(e.target.value)}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {hvscFolderOptions.slice(0, 24).map((folder) => (
                  <Button
                    key={folder}
                    variant={folder === selectedHvscFolder ? 'secondary' : 'outline'}
                    className="justify-start"
                    onClick={() => setSelectedHvscFolder(folder)}
                  >
                    <Folder className="h-4 w-4 mr-2" />
                    {folder}
                  </Button>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Tracks</p>
                <p className="text-xs text-muted-foreground">
                  {hvscTracks.length ? `${hvscTracks.length} tracks` : 'Select a folder'}
                </p>
              </div>
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-2">
                {hvscTracks.slice(0, 80).map((path) => (
                  <div key={path} className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground truncate">
                      {path}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePlayHvscTrack(path)}
                    >
                      Play
                    </Button>
                  </div>
                ))}
                {hvscTracks.length > 80 && (
                  <p className="text-xs text-muted-foreground">
                    Showing first 80 tracks. Use folder filters to narrow the list.
                  </p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="local" className="space-y-4">
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Local SID folders</p>
                  <p className="text-xs text-muted-foreground">
                    {localFiles.length
                      ? `${localFiles.length} SID files selected`
                      : 'Pick a folder on your device'}
                  </p>
                </div>
                <div className="inline-flex">
                  <input
                    ref={localInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => handleLocalFolderPick(e.target.files)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLocalFolderBrowse}
                  >
                    <FolderOpen className="h-4 w-4 mr-1" />
                    Pick folder
                  </Button>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Browse folders</p>
                  <p className="text-xs text-muted-foreground">Play a folder recursively</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePlayRandomLocalFolder}
                    disabled={!localFolders.length}
                  >
                    Random folder
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handlePlayLocalFolder}
                    disabled={!localTracks.length}
                  >
                    Play folder
                  </Button>
                </div>
              </div>

              <Input
                placeholder="Filter folders…"
                value={localFolderFilter}
                onChange={(e) => setLocalFolderFilter(e.target.value)}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {localFolders.slice(0, 24).map((folder) => (
                  <Button
                    key={folder}
                    variant={folder === selectedLocalFolder ? 'secondary' : 'outline'}
                    className="justify-start"
                    onClick={() => setSelectedLocalFolder(folder)}
                  >
                    <Folder className="h-4 w-4 mr-2" />
                    {folder}
                  </Button>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Tracks</p>
                <p className="text-xs text-muted-foreground">
                  {localTracks.length ? `${localTracks.length} tracks` : 'Select a folder'}
                </p>
              </div>
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-2">
                {localTracks.slice(0, 80).map((file) => (
                  <div key={`${file.name}-${file.lastModified}`} className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground truncate">
                      {getLocalPath(file)}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePlayLocalTrack(file)}
                    >
                      Play
                    </Button>
                  </div>
                ))}
                {localTracks.length > 80 && (
                  <p className="text-xs text-muted-foreground">
                    Showing first 80 tracks. Use folder filters to narrow the list.
                  </p>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
