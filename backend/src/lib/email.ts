import { Resend } from "resend";
import { formatMoney } from "./http.ts";
import { config } from "./config.ts";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : "";


export const sendVerificationEmail = async (
  to: string,
  verificationUrl: string
) => {
  if (process.env.PROD === "false") {
    console.log(`[email] verification link for ${to}: ${verificationUrl}`);
    return ;
  }

  const { data, error } = await resend.emails.send({
    from: "do-not-reply@sampledomain.ae",
    to,
    subject: "Verify your email | sampledomain",
    text: `Welcome to sampledomain! Please verify your email address by opening this link: ${verificationUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 24px;">
        <h2 style="color: #1a1a1a;">Verify your email</h2>
        <p style="color: #333;">Welcome to sampledomain! Please confirm your email address to activate your account.</p>
        <a href="${verificationUrl}" style="display: inline-block; margin: 16px 0; padding: 12px 24px; background-color: #525252; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Verify email
        </a>
        <p style="color: #555; font-size: 14px;">
          Or copy and paste this link into your browser:<br />
          <a href="${verificationUrl}">${verificationUrl}</a>
        </p>
        <p style="color: #777; font-size: 12px;">This link expires in 24 hours.</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }
};

export const sendPasswordResetEmail = async (
  to: string,
  resetUrl: string
) => {
  if (process.env.PROD === "false") {
    console.log(`[email] password reset link for ${to}: ${resetUrl}`);
    return ;
  }

  const { data, error } = await resend.emails.send({
    from: "do-not-reply@sampledomain.ae",
    to,
    subject: "Reset your password | sampledomain",
    text: `You requested a password reset. Please open this link to set a new password: ${resetUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 24px;">
        <h2 style="color: #1a1a1a;">Reset your password</h2>
        <p style="color: #333;">We received a request to reset the password for your sampledomain account.</p>
        <a href="${resetUrl}" style="display: inline-block; margin: 16px 0; padding: 12px 24px; background-color: #525252; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Reset password
        </a>
        <p style="color: #555; font-size: 14px;">
          Or copy and paste this link into your browser:<br />
          <a href="${resetUrl}">${resetUrl}</a>
        </p>
        <p style="color: #777; font-size: 12px;">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }
};

/**
 * Order confirmation, sent once the payment has been recorded as paid.
 *
 * Uses the same `PROD === "false"` console-logging branch as the other senders, so a
 * self-hosted install with no Resend account still prints the whole confirmation to the backend
 * log rather than silently sending nothing.
 */
export const sendOrderConfirmation = async (
  to: string,
  order: {
    orderNumber: number;
    totalCents: number;
    currency: string;
    lines: {
      title: string;
      variantName: string | null;
      quantity: number;
      unitPriceCents: number;
    }[];
  },
) => {
  // The "Default" variant is an implementation detail of simple products, not something a
  // customer needs to read on a receipt.
  const lineName = (line: { title: string; variantName: string | null }) =>
    line.variantName && line.variantName !== "Default"
      ? `${line.title} \u2014 ${line.variantName}`
      : line.title;

  const total = formatMoney(order.totalCents, order.currency);
  const orderUrl = `${config.storeUrl}/profile/orders`;

  if (process.env.PROD === "false") {
    console.log(
      `[email] order #${order.orderNumber} confirmation for ${to}: ${total}\n` +
        order.lines
          .map(
            (line) =>
              `  ${lineName(line)} x${line.quantity} @ ${formatMoney(line.unitPriceCents, order.currency)}`,
          )
          .join("\n"),
    );
    return;
  }

  const rows = order.lines
    .map(
      (line) => `<tr>
        <td style="padding: 6px 0; color: #333;">${lineName(line)} &times; ${line.quantity}</td>
        <td style="padding: 6px 0; color: #333; text-align: right;">${formatMoney(line.unitPriceCents * line.quantity, order.currency)}</td>
      </tr>`,
    )
    .join("");

  const { error } = await resend.emails.send({
    from: "do-not-reply@sampledomain.ae",
    to,
    subject: `Order #${order.orderNumber} confirmed | sampledomain`,
    text:
      `Thanks for your order #${order.orderNumber}.\n\n` +
      order.lines.map((line) => `- ${lineName(line)} x${line.quantity}`).join("\n") +
      `\n\nTotal: ${total}\n\nTrack it at ${orderUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 24px;">
        <h2 style="color: #1a1a1a;">Thank you for your order</h2>
        <p style="color: #333;">Order <strong>#${order.orderNumber}</strong> is confirmed. We are getting it ready.</p>
        <table style="border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px;">
          ${rows}
          <tr>
            <td style="padding: 8px 0; border-top: 1px solid #e5e5e5; color: #1a1a1a; font-weight: bold;">Total</td>
            <td style="padding: 8px 0; border-top: 1px solid #e5e5e5; color: #1a1a1a; font-weight: bold; text-align: right;">${total}</td>
          </tr>
        </table>
        <a href="${orderUrl}" style="display: inline-block; margin: 8px 0; padding: 12px 24px; background-color: #525252; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold;">
          View your order
        </a>
        <p style="color: #777; font-size: 12px;">If anything is not right, reply to this email and we will sort it out.</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }
};
