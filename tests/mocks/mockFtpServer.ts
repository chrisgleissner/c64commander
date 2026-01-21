import * as path from 'node:path';
import FtpSrv from 'ftp-srv';

export type MockFtpServer = {
  host: string;
  port: number;
  rootDir: string;
  close: () => Promise<void>;
};

type MockFtpServerOptions = {
  rootDir: string;
  password?: string;
  port?: number;
};

export async function createMockFtpServer(options: MockFtpServerOptions): Promise<MockFtpServer> {
  const host = '127.0.0.1';
  const rootDir = path.resolve(options.rootDir);
  const port = options.port ?? 0;
  const password = options.password ?? '';
  const silentLog = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => silentLog,
  };

  const server = new FtpSrv({
    url: `ftp://${host}:${port}`,
    pasv_url: host,
    pasv_min: 40100,
    pasv_max: 40200,
    anonymous: true,
    log: silentLog,
  });

  server.on('login', ({ password: suppliedPassword }, resolve, reject) => {
    const ok = !password || suppliedPassword === password;
    if (!ok) {
      reject(new Error('FTP login failed'));
      return;
    }
    resolve({ root: rootDir });
  });

  await server.listen();
  const address = server.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start FTP server');
  }

  return {
    host,
    port: address.port,
    rootDir,
    close: async () => {
      await server.close();
    },
  };
}
