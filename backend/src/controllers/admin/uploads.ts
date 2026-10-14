import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { config } from "../../lib/config.ts";
import { created } from "../../lib/http.ts";
import AppError from "../../lib/appError.ts";

const uploadsRouter = express.Router();

/**
 * Extensions are derived from the validated MIME type, never from the submitted filename.
 * Nothing user-supplied reaches the filesystem path, so traversal is not expressible.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

fs.mkdirSync(config.uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(config.uploadsDir, { recursive: true });
      cb(null, config.uploadsDir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${crypto.randomBytes(16).toString("hex")}${EXTENSION_BY_MIME[file.mimetype]}`);
    },
  }),
  limits: { fileSize: config.maxUploadBytes, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!EXTENSION_BY_MIME[file.mimetype]) {
      cb(new AppError("Unsupported image type", 400));
      return;
    }
    cb(null, true);
  },
});

/** POST /admin/uploads — multipart field name "files". */
uploadsRouter.post("/uploads", upload.array("files", 10), (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  if (files.length === 0) throw new AppError("No files uploaded", 400);

  created(
    res,
    files.map((file) => ({
      filename: path.basename(file.filename),
      // stored under the same origin as the API; nginx exposes it at /api/uploads/...
      url: `/uploads/${path.basename(file.filename)}`,
      mimeType: file.mimetype,
      size: file.size,
    })),
  );
});

export default uploadsRouter;
