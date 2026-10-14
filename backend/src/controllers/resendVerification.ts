import express from "express";
import isEmail from "validator/lib/isEmail.js";
import { prisma } from "../lib/prismaClient.ts";
import { sendVerificationEmail } from "../lib/email.ts";
import { claimCooldown } from "../lib/redis.ts";
import { config } from "../lib/config.ts";
import { normalizeEmail } from "../lib/emailAddress.ts";
import { issueVerificationToken } from "../lib/verificationToken.ts";

const resendVerificationHandler = express.Router();

/**
 * One mail per address per window.
 *
 * Only a nuisance limit, not an account-protection one: it exists so a bored visitor cannot turn
 * the login page's resend link into a mail cannon pointed at somebody else's inbox. The claim is
 * taken on the normalized address whether or not an account matches, so the endpoint costs the
 * same work to enumerate as it does to answer a real request.
 */
const RESEND_COOLDOWN_SECONDS = 60;

resendVerificationHandler.post("", async (req, res) => {
  const rawEmail: string = req.body.email;

  // Normalized before validation, so a pasted address with a trailing space works instead of
  // being silently treated as a malformed no-op -- see register.ts for why this order.
  const email = rawEmail ? normalizeEmail(rawEmail) : "";

  // Malformed input gets the same empty 200 as everything else. This endpoint's response is
  // deliberately uninformative -- whether an account exists, and whether it is verified, are
  // both things it must not reveal -- and a validation error here would be the one reply that
  // distinguishes "we could not parse this" from "we found nothing", which is a start.
  if (!email || !isEmail(email)) {
    res.status(200).json({ data: null, error: false, message: "" });
    return;
  }

  if (!(await claimCooldown(`verify-email:${email}`, RESEND_COOLDOWN_SECONDS))) {
    // Inside the window. Answered exactly as a successful send is, because a different reply
    // would turn the cooldown into the enumeration oracle the response shape is built to avoid.
    res.status(200).json({ data: null, error: false, message: "" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (user && !user.emailVerified) {
    // Minted before the send, so a transport failure cannot leave the account holding a token
    // that was never delivered. It replaces any previous one: two live tokens for one address
    // would mean an older mail stays usable after the user asked for a newer link, and it is
    // meant to stop working the moment a new one is issued.
    const { token, tokenHash, expiresAt } = issueVerificationToken();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: tokenHash,
        emailVerificationTokenExpiresAt: expiresAt,
      },
    });

    // config.storeUrl, not FRONTEND_URL: the latter is a comma-separated CORS allow-list, so
    // interpolating it would build "http://a.example,http://b.example/verify-email?...".
    const verificationUrl = `${config.storeUrl}/verify-email?token=${token}`;

    try {
      await sendVerificationEmail(email, verificationUrl);
    } catch (err) {
      // Left in place deliberately, and the response stays a success. The token is still the one
      // the user is waiting on, a later attempt overwrites it anyway, and reporting failure here
      // would tell them to check an inbox that is never going to receive anything.
      console.error("Failed to resend verification email:", err);
    }
  }

  res.status(200).json({ data: null, error: false, message: "" });
});

export default resendVerificationHandler;
