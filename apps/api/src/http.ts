/**
 * Shared error type.
 *
 * Defined once so every route file throws the same class — a per-file copy
 * would not be recognised by the app's `onError` handler and would surface as
 * a 500 with the message swallowed.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
