import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FolderOpen, RefreshCw, ArrowLeft, ArrowUp, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useC64Connection } from '@/hooks/useC64Connection';
import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';
import { getC64API, C64_DEFAULTS } from '@/lib/c64api';
import { listFtpDirectory } from '@/lib/ftp/ftpClient';
import { getStoredFtpPort } from '@/lib/ftp/ftpConfig';
import { browseLocalPlayFiles, filterPlayInputFiles, prepareDirectoryInput } from '@/lib/playback/localFilePicker';
import { getParentPath, listLocalFiles, listLocalFolders } from '@/lib/playback/localFileBrowser';
import { buildPlayPlan, executePlayPlan, type PlaySource, type PlayRequest, type LocalPlayFile } from '@/lib/playback/playbackRouter';
import { formatPlayCategory, isSupportedPlayFile } from '@/lib/playback/fileTypes';

const useInitialSource = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const sourceParam = params.get('source');
  if (sourceParam === 'ultimate' || sourceParam === 'local') return sourceParam;
  return 'local' as PlaySource;
};

export default function PlayFilesPage() {
  const navigate = useNavigate();
  const { status } = useC64Connection();
  const initialSource = useInitialSource();

  const [source, setSource] = useState<PlaySource>(initialSource);
  const [localFiles, setLocalFiles] = useState<LocalPlayFile[]>([]);
  const [localPath, setLocalPath] = useState('/');
  const [remotePath, setRemotePath] = useState('/');
  const [remoteEntries, setRemoteEntries] = useState<Array<{ name: string; path: string; type: 'file' | 'dir' }>>([]);
  const [isRemoteLoading, setIsRemoteLoading] = useState(false);
  const [isLocalLoading, setIsLocalLoading] = useState(false);

  const localFolderInputRef = useRef<HTMLInputElement | null>(null);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    prepareDirectoryInput(localFolderInputRef.current);
  }, []);

  const localFolders = useMemo(() => listLocalFolders(localFiles, localPath), [localFiles, localPath]);
  const localVisibleFiles = useMemo(() => listLocalFiles(localFiles, localPath), [localFiles, localPath]);

  const handleLocalBrowse = async () => {
    setIsLocalLoading(true);
    try {
      const files = await browseLocalPlayFiles(localFolderInputRef.current);
      if (files && files.length > 0) {
        setLocalFiles(files);
        setLocalPath('/');
        return;
      }
      if (files) {
        toast({
          title: 'No supported files',
          description: 'Found no supported files.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      addErrorLog('Local file browsing failed', { error: (error as Error).message });
      toast({
        title: 'Local browse failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsLocalLoading(false);
    }
  };

  const handleLocalInput = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const filtered = filterPlayInputFiles(files);
    if (!filtered.length) {
      toast({
        title: 'No supported files',
        description: 'Found no supported files.',
        variant: 'destructive',
      });
      return;
    }
    setLocalFiles(filtered);
    setLocalPath('/');
  };

  const loadRemoteEntries = async (path: string) => {
    setIsRemoteLoading(true);
    try {
      const deviceHost = localStorage.getItem('c64u_device_host') || C64_DEFAULTS.DEFAULT_DEVICE_HOST;
      const password = localStorage.getItem('c64u_password') || '';
      const result = await listFtpDirectory({ host: deviceHost, port: getStoredFtpPort(), password, path });
      setRemoteEntries(result.entries);
      setRemotePath(result.path);
    } catch (error) {
      toast({
        title: 'FTP browse failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsRemoteLoading(false);
    }
  };

  useEffect(() => {
    if (source === 'ultimate') {
      void loadRemoteEntries(remotePath);
    }
  }, [source]);

  const handlePlay = async (request: PlayRequest) => {
    try {
      const api = getC64API();
      const plan = buildPlayPlan(request);
      await executePlayPlan(api, plan);
      toast({
        title: 'Playback started',
        description: `${formatPlayCategory(plan.category)} queued`,
      });
    } catch (error) {
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const remoteVisibleEntries = useMemo(
    () =>
      remoteEntries
        .filter((entry) => entry.type === 'dir' || isSupportedPlayFile(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [remoteEntries],
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/95">
      <main className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}
              aria-label="Back to home">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-xl font-semibold">Play Files</h2>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full ${status.isConnected ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
            {status.isConnected ? 'Connected' : 'Offline'}
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-border p-1 bg-muted/30">
          <Button
            variant={source === 'local' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setSource('local')}
          >
            Browse local device
          </Button>
          <Button
            variant={source === 'ultimate' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setSource('ultimate')}
          >
            Browse Ultimate 64
          </Button>
        </div>

        {source === 'local' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Local files</p>
                <p className="text-xs text-muted-foreground">
                  {localFiles.length ? `${localFiles.length} supported files selected` : 'Pick a folder to begin'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={localFolderInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  data-testid="play-folder-input"
                  onChange={(e) => void handleLocalInput(e.target.files)}
                />
                <input
                  ref={localFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  data-testid="play-file-input"
                  onChange={(e) => void handleLocalInput(e.target.files)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => localFileInputRef.current?.click()}
                  disabled={isLocalLoading}
                >
                  <FolderOpen className="h-4 w-4 mr-1" />
                  Pick files
                </Button>
                <Button variant="outline" size="sm" onClick={handleLocalBrowse} disabled={isLocalLoading}>
                  <FolderOpen className="h-4 w-4 mr-1" />
                  {isLocalLoading ? 'Browsing…' : 'Pick folder'}
                </Button>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Path: {localPath}</div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocalPath(getParentPath(localPath))}
                  disabled={localPath === '/'}
                >
                  <ArrowUp className="h-4 w-4 mr-1" />
                  Up
                </Button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {localFolders.map((folder) => (
                  <Button
                    key={folder}
                    variant="outline"
                    size="sm"
                    onClick={() => setLocalPath(folder)}
                  >
                    <FolderOpen className="h-4 w-4 mr-1" />
                    {folder.replace(localPath, '')}
                  </Button>
                ))}
              </div>

              <div className="space-y-2">
                {localVisibleFiles.length === 0 && (
                  <p className="text-xs text-muted-foreground">No supported files in this folder.</p>
                )}
                {localVisibleFiles.map((entry) => (
                  <div key={entry.path} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words whitespace-normal">{entry.name}</p>
                      <p className="text-xs text-muted-foreground break-words whitespace-normal">{entry.path}</p>
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() =>
                        void handlePlay({
                          source: 'local',
                          path: entry.path,
                          file: entry.file,
                        })
                      }
                      disabled={!status.isConnected}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Play
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Ultimate 64 FTP</p>
                <p className="text-xs text-muted-foreground">Browse files available on the device.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadRemoteEntries(remotePath)} disabled={isRemoteLoading}>
                <RefreshCw className="h-4 w-4 mr-1" />
                {isRemoteLoading ? 'Loading…' : 'Refresh'}
              </Button>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Path: {remotePath}</div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadRemoteEntries(getParentPath(remotePath))}
                  disabled={remotePath === '/'}
                >
                  <ArrowUp className="h-4 w-4 mr-1" />
                  Up
                </Button>
              </div>

              <div className="space-y-2">
                {remoteVisibleEntries.length === 0 && (
                  <p className="text-xs text-muted-foreground">No supported files in this folder.</p>
                )}
                {remoteVisibleEntries.map((entry) => (
                  <div key={entry.path} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words whitespace-normal">{entry.name}</p>
                      <p className="text-xs text-muted-foreground break-words whitespace-normal">{entry.path}</p>
                    </div>
                    {entry.type === 'dir' ? (
                      <Button variant="outline" size="sm" onClick={() => void loadRemoteEntries(entry.path)}>
                        <FolderOpen className="h-4 w-4 mr-1" />
                        Open
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() =>
                          void handlePlay({
                            source: 'ultimate',
                            path: entry.path,
                          })
                        }
                        disabled={!status.isConnected}
                      >
                        <Play className="h-4 w-4 mr-1" />
                        Play
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
