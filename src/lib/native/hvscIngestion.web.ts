import { WebPlugin } from '@capacitor/core';
import type { HvscFolderListing, HvscIngestionPlugin, HvscProgressEvent, HvscSong, HvscStatus, HvscUpdateStatus } from './hvscIngestion';

export class HvscIngestionWeb extends WebPlugin implements HvscIngestionPlugin {
  async getHvscStatus(): Promise<HvscStatus> {
    return this.withMock('getHvscStatus');
  }

  async checkForHvscUpdates(): Promise<HvscUpdateStatus> {
    return this.withMock('checkForHvscUpdates');
  }

  async installOrUpdateHvsc(options: { cancelToken: string }): Promise<HvscStatus> {
    return this.withMock('installOrUpdateHvsc', options);
  }

  async cancelHvscInstall(options: { cancelToken: string }): Promise<void> {
    await this.withMock('cancelHvscInstall', options);
  }

  async getHvscFolderListing(options: { path: string }): Promise<HvscFolderListing> {
    return this.withMock('getHvscFolderListing', options);
  }

  async getHvscSong(options: { id?: number; virtualPath?: string }): Promise<HvscSong> {
    return this.withMock('getHvscSong', options);
  }

  async getHvscDurationByMd5(options: { md5: string }): Promise<{ durationSeconds?: number | null }> {
    return this.withMock('getHvscDurationByMd5', options);
  }

  async addListener(eventName: 'progress', listenerFunc: (event: HvscProgressEvent) => void) {
    const mock = (window as Window & { __hvscMock__?: Record<string, any> }).__hvscMock__;
    if (mock && typeof mock.addListener === 'function') {
      mock.addListener(eventName, listenerFunc);
    }
    return super.addListener(eventName, listenerFunc);
  }

  private async withMock(method: string, payload?: any) {
    const mock = (window as Window & { __hvscMock__?: Record<string, any> }).__hvscMock__;
    if (mock && typeof mock[method] === 'function') {
      return mock[method](payload);
    }
    throw new Error('HVSC ingestion is only available on native builds.');
  }
}
