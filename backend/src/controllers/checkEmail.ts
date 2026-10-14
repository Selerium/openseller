import express from "express";
import validator from "validator";
import { prisma } from "../lib/prismaClient.ts";
import { normalizeEmail } from "../lib/emailAddress.ts";

const checkEmailHandler = express.Router();

/**
 * Public email check for the guest checkout flow.
 *
 * POST /check-email { email } -> { data: { exists: boolean } }
 *
 * A guest who types an address that already has an account is asked to log in
 * instead of checking out as a guest: the order would otherwise be written as a
 * guest order under an email the shop already knows, and the shopper would then
 * have two identities with no link between them.
 *
 * Yes, this is an enumeration oracle for registered addresses, and that is
 * accepted here deliberately: registration already answers 409 for a taken
 * address, and login answers 404 for an unknown one, so the set of registered
 * addresses is not secret on this app. What this endpoint does NOT reveal is
 * anything else — no name, no verification state, no hint about the password.
 */
checkEmailHandler.post("", async (req, res) => {
  const raw = typeof req.body?.email === "string" ? req.body.email : "";
  const email = normalizeEmail(raw);

  if (!email || !validator.isEmail(email)) {
    res.status(200).json({ data: { exists: false }, error: false, message: "" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  res.status(200).json({ data: { exists: user !== null }, error: false, message: "" });
});

export default checkEmailHandler;
