import app from "./app.ts";
import { config } from "./lib/config.ts";

// Startup misconfiguration checks. These are the settings whose wrong value produces links
// that are silently wrong rather than an error: the process boots fine and the breakage only
// surfaces in a customer's inbox minutes later.
const misconfigured: string[] = [];

if (config.prod) {
  if (!process.env.STORE_URL) {
    misconfigured.push(
      "STORE_URL is unset. It falls back to http://localhost, so every verification, " +
        "password-reset and Stripe redirect link would point at the API itself. Set it to the " +
        "public https URL of the storefront.",
    );
  } else if (!config.storeUrl.startsWith("https://")) {
    misconfigured.push(
      `STORE_URL is "${config.storeUrl}" but not https. Password-reset and email-verification ` +
        "links are credentials; serving them over plaintext puts them on the wire.",
    );
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes("dev_only")) {
    misconfigured.push("JWT_SECRET is missing or still the development placeholder.");
  }
}

for (const warning of misconfigured) console.warn(`[config] ${warning}`);
if (misconfigured.length) {
  console.warn(
    `[config] ${misconfigured.length} configuration problem(s) in production. The server ` +
      "still starts, so nothing will fail fast for you.",
  );
}

// Not a misconfiguration, so not in the list above, but it is the single setting in this app
// that lets an order become "paid" without money changing hands, so it gets its own banner
// rather than one line among the warnings. lib/config.ts has already refused the combination
// with PROD=true, so reaching this line means it is genuinely a development process.
if (config.allowMockPayments) {
  console.warn(
    "\n" +
      "  ############################################################\n" +
      "  #  ALLOW_MOCK_PAYMENTS IS ON                                  #\n" +
      "  #  Orders can be marked paid without any money being taken.  #\n" +
      "  #  Development only. This process refuses to start when       #\n" +
      "  #  PROD=true is also set.                                     #\n" +
      "  ############################################################\n",
  );
}

app.listen(3000, "0.0.0.0", () => {
  console.log("Express backend running on port :3000");
});