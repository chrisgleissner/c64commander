export type LocalSourceListingErrorCode =
  | 'saf-listing-unavailable'
  | 'saf-listing-invalid'
  | 'local-entries-missing';

type LocalSourceListingErrorDetails = Record<string, unknown>;

export class LocalSourceListingError extends Error {
  readonly code: LocalSourceListingErrorCode;
  readonly details?: LocalSourceListingErrorDetails;

  constructor(message: string, code: LocalSourceListingErrorCode, details?: LocalSourceListingErrorDetails) {
    super(message);
    this.name = 'LocalSourceListingError';
    this.code = code;
    this.details = details;
  }
}
