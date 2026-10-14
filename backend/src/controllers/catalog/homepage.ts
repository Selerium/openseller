import express from "express";
import { prisma } from "../../lib/prismaClient.ts";
import { ok } from "../../lib/http.ts";
import { HOMEPAGE_ID, isRenderable, type HomeLayout } from "../../lib/homepage.ts";

/**
 * GET /homepage — the published homepage, for visitors.
 *
 * The only homepage route a shopper or a guest can reach. It returns `layout: null` rather
 * than a substitute when nothing has been published (or what has been published no longer
 * parses), which is the signal the storefront uses to render its built-in placeholder — so a
 * store that has never opened the editor looks exactly as it did before this feature existed.
 *
 * Deliberately read-only and row-free: it never creates the singleton, so an unauthenticated
 * request cannot write.
 */
const homepageRouter = express.Router();

interface PublishedHomepage {
  layout: HomeLayout | null;
  updatedAt: Date | null;
}

homepageRouter.get("", async (_req, res) => {
  const row = await prisma.homePage.findUnique({ where: { id: HOMEPAGE_ID } });
  const published = row?.published;

  const payload: PublishedHomepage = {
    layout: published != null && isRenderable(published) ? published : null,
    updatedAt: row?.updatedAt ?? null,
  };

  ok(res, payload);
});

export default homepageRouter;
