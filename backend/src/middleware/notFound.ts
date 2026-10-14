import AppError from "../lib/appError.ts";

/**
 * 404 for paths the API does not serve.
 *
 * Without this, any unmatched request fell through to checkTokens and came back as
 * 401 "No access token provided" — indistinguishable from a genuinely expired session.
 *
 * That mattered in practice: a verification email built with the API origin instead of the
 * storefront origin lands on `GET /verify-email`, which the API does not serve. It reported
 * "no access token", sending the reader to debug cookies instead of the URL.
 */
const notFoundHandler = (req, _res) => {
  throw new AppError(`No API route matches ${req.method} ${req.path}`, 404);
};

export default notFoundHandler;
