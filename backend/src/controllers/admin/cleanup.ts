import express from "express";
import { cleanupRefreshTokens, cleanupUnverifiedUsers } from "../../lib/tokenCleanup.ts";
import { ok } from "../../lib/http.ts";

const cleanupRouter = express.Router();

/** POST /admin/cleanup/tokens - cleanup expired/revoked tokens */
cleanupRouter.post("/tokens", async (_req, res) => {
  const result = await cleanupRefreshTokens();
  ok(res, result);
});

/** POST /admin/cleanup/unverified - cleanup old unverified accounts */
cleanupRouter.post("/unverified", async (_req, res) => {
  const result = await cleanupUnverifiedUsers();
  ok(res, result);
});

export default cleanupRouter;
