export {};

declare global {
  interface Window {
    __hvscMock__?: Record<string, any>;
  }
}
