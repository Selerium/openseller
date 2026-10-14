/**
 * The one definition of what an email address looks like in storage.
 *
 * Its own module rather than a function in lib/email.ts, because lib/email.ts constructs a
 * Resend client at import time. Anything that only needs to normalize a string -- the login
 * lookup, most obviously -- should not have to pull the mailer in to do it.
 *
 * Every path that reads or writes User.email goes through here: register, login, email change,
 * resend-verification. That agreement is the whole point. The four used to disagree, and the
 * cost was an account you could not get back into: registration stored the address exactly as
 * typed while the resend lookup lowercased it, so a user who registered as "Bob@Example.com"
 * could log in by typing that string but could not request a new verification mail by typing it,
 * because the two queries were looking for different rows.
 *
 * trim() as well as lower(), because a pasted address routinely carries a trailing space or
 * newline, and it is invisible in most email clients -- so it fails at the login prompt with no
 * visible cause. Every route in and out of the database agrees, so the leading/trailing space
 * cannot be reintroduced by a path that forgot to call this.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
