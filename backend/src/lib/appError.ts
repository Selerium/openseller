class AppError extends Error {
  public readonly statusCode: number;

  /**
   * Body for the `data` field of the error response.
   *
   * Exists so a handler can attach something the client has to act on, rather than only prose
   * to display. The case that motivated it is the expired verification token: the message says
   * "request a new link", but the message alone leaves the client parsing English to discover
   * whether that offer applies, and it cannot tell "your link expired, here's the address to
   * prefill" apart from "that link was never valid, ask the user for their address".
   *
   * Only put values in here that the caller has already earned. Throwing one of these is a 4xx,
   * so it describes what the requester knows -- never what it lets them learn.
   */
  public readonly data?: unknown;

  constructor(message: string, statusCode: number = 500, data?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export default AppError;
