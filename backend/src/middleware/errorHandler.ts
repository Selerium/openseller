import express from "express";

const errorHandler = (err, req, res, next) => {
  const status = err.statusCode || 500;
  const message =
    status >= 500
      ? "Internal server error"
      : err.message || "Internal sever error";
  if (status >= 500) console.error("Unhandled error:", err);
  // err.data, not a literal {}: handlers that throw a 4xx attach the facts the client needs to
  // recover (see AppError). Defaulting to {} here would discard them at the last possible moment.
  res.status(status).json({ error: true, message, data: err.data ?? {} });
};

export default errorHandler;
