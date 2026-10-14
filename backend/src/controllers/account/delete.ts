import express from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prismaClient.ts";
import { ok } from "../../lib/http.ts";
import { clearAuthCookies } from "../../lib/cookies.ts";
import AppError from "../../lib/appError.ts";

const accountRouter = express.Router();

/**
 * DELETE /account/delete
 *
 * Deletes the account and everything attached to it.
 *
 * Password-gated. This is the one endpoint here that destroys data with no undo, so the session
 * cookie alone is not treated as consent: a left-open tab, a shared machine or an XSS that rides
 * the session can all reach an authenticated DELETE, and none of them is the owner clicking
 * "delete my account". The password is the only thing here that cannot be replayed from a cookie.
 */
accountRouter.delete("/delete", async (req, res) => {
  // req.user.id is the Profile id: that is what signAccessToken puts in the token, and every
  // other profile-scoped query in this codebase keys off it.
  const profileId = req.user?.id;
  if (!profileId) throw new AppError("Unauthorized", 401);

  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  if (!currentPassword) throw new AppError("Current password is required", 400);

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: { user: { select: { id: true, password: true } } },
  });
  if (!profile) throw new AppError("Profile not found", 404);

  const valid = await bcrypt.compare(currentPassword, profile.user.password);
  if (!valid) throw new AppError("Current password is incorrect", 401);

  // An admin deleting themselves would leave the back office with no way back in, and no
  // recovery form for a deleted account. Refused rather than allowed and regretted.
  if (profile.role === "ADMIN") {
    throw new AppError("Administrator accounts cannot be deleted from here", 403);
  }

  // Profile first, then User, in one transaction.
  //
  // The User -> Profile relation is RESTRICT, not Cascade, and that is the whole point of the
  // split: deleting credentials must not be able to cascade into commerce data. So deleting the
  // User first is refused by Postgres with 23001, and the old version of this handler did
  // exactly that and answered 500 for every correct password.
  //
  // Going through the Profile is what takes the addresses, reviews, cards and complaints with
  // it — those all cascade from Profile. Orders point at profileId with SetNull rather than
  // Cascade, so the rows survive with the link cleared: the order history a store needs for its
  // own records outlives the shopper, without naming them.
  await prisma.$transaction(async (tx) => {
    await tx.profile.delete({ where: { id: profileId } });
    await tx.user.delete({ where: { id: profile.user.id } });
  });

  // The cookies still name a user that no longer exists. Left in place, the next request would
  // spend a refresh-token lookup failing before it could answer 401.
  clearAuthCookies(res);

  ok(res, { deleted: true }, "Account deleted successfully");
});

export default accountRouter;
