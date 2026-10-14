import { prisma } from "./prismaClient.ts";
import { publish } from "./realtime.ts";

/**
 * Notifications: the durable inbox behind the realtime bell.
 *
 * Every push-worthy fact is a row (so an offline reader still sees it) plus a socket
 * event on the recipient's `user:<profileId>` channel (so an online reader sees it now).
 * The two are written in that order: if the publish throws, the row is already the truth.
 *
 * Admins are notified like everyone else — one row per admin profile — because "the
 * admins" is just a query over profiles, and a shared channel would leave nothing for
 * the notifications page to list.
 */

export interface NotifyInput {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

export async function notify(profileId: string, input: NotifyInput) {
  const row = await prisma.notification.create({
    data: {
      profileId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    },
  });
  publish(`user:${profileId}`, "notification.created", {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    createdAt: row.createdAt,
  });
  return row;
}

/**
 * One inbox row per admin. Done as one createMany plus a publish loop: the rows are the
 * record, the publishes are best-effort, and neither may fail the caller — notification
 * delivery must never break the write it announces, so callers `await ... .catch(()=>{})`.
 */
export async function notifyAdmins(input: NotifyInput): Promise<void> {
  const admins = await prisma.profile.findMany({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  if (admins.length === 0) return;

  await prisma.notification.createMany({
    data: admins.map((admin) => ({
      profileId: admin.id,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })),
  });

  const createdAt = new Date().toISOString();
  for (const admin of admins) {
    publish(`user:${admin.id}`, "notification.created", {
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      createdAt,
    });
  }
}
