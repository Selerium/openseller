import express from "express";
import { prisma } from "../../lib/prismaClient.ts";
import type { HomePage } from "../../generated/prisma/client.ts";
import AppError from "../../lib/appError.ts";
import { ok } from "../../lib/http.ts";
import {
  EMPTY_LAYOUT,
  HOMEPAGE_ID,
  parseLayout,
  type HomeLayout,
} from "../../lib/homepage.ts";

/**
 * /admin/homepage — the editor's API.
 *
 * Four routes, not one, because the editor's workflow has a real distinction in it: a change
 * the admin makes is not yet a change the storefront shows. Autosave writes `draft`, Publish
 * copies `draft` over `published`, and discard copies `published` back. A visitor can never
 * read a draft through here — this router sits behind requireAdmin — and the public route
 * reads only `published`.
 *
 * Reads return both documents plus `updatedAt` so the editor's badge ("unpublished changes")
 * is computed from one response rather than a round trip per keystroke.
 */
const adminHomepageRouter = express.Router();

interface HomepageState {
  draft: HomeLayout;
  published: HomeLayout | null;
  /** True when the draft differs from what the storefront is showing right now. */
  dirty: boolean;
  updatedAt: Date;
}

/**
 * Read the singleton row, creating it on first use.
 *
 * `draft` starts as an empty layout rather than null: PUT is a whole-document write, but the
 * editor must be able to render something before it has ever saved, and "no draft" would have
 * to be a second state everywhere downstream.
 */
async function load(): Promise<HomePage> {
  const existing = await prisma.homePage.findUnique({ where: { id: HOMEPAGE_ID } });
  if (existing) return existing;

  try {
    return await prisma.homePage.create({
      data: { id: HOMEPAGE_ID, draft: EMPTY_LAYOUT },
    });
  } catch (error) {
    // Two first requests, one insert: the winner's row is the one both should use. Anything
    // other than the primary-key violation this is meant for is rethrown untouched.
    const concurrent = await prisma.homePage.findUnique({ where: { id: HOMEPAGE_ID } });
    if (concurrent) return concurrent;
    throw error;
  }
}

function state(row: HomePage): HomepageState {
  const draft = readLayout(row.draft, EMPTY_LAYOUT);
  const published = row.published === null ? null : readLayout(row.published, null);

  return {
    // Both are re-parsed rather than returned as raw JsonValue: they were validated on the
    // way in, but this is the response the editor renders, and an unreadable document should
    // surface as an empty editor rather than as a TypeError in a component far away.
    draft,
    published,
    // Compared here rather than in the browser, where two trees built by different edits
    // could serialize differently while being identical. Both sides come out of the same
    // jsonb column, which canonicalises key order, so the two strings are comparable even
    // though nothing about an element's `fields` is ordered by construction.
    //
    // Never published counts as dirty: a store whose editor holds work the visitors cannot
    // see has unpublished changes whatever the two documents contain.
    dirty: published === null || JSON.stringify(draft) !== JSON.stringify(published),
    updatedAt: row.updatedAt,
  };
}

function readLayout(value: unknown, fallback: null): null;
function readLayout(value: unknown, fallback: HomeLayout): HomeLayout;
function readLayout(value: unknown, fallback: HomeLayout | null): HomeLayout | null {
  try {
    return parseLayout(value);
  } catch {
    return fallback;
  }
}

/** GET /admin/homepage */
adminHomepageRouter.get("", async (_req, res) => {
  ok(res, state(await load()));
});

/** PUT /admin/homepage — body `{ layout }`, the whole tree, replacing the draft. */
adminHomepageRouter.put("", async (req, res) => {
  const layout = parseLayout(req.body?.layout);

  const row = await prisma.homePage.upsert({
    where: { id: HOMEPAGE_ID },
    create: { id: HOMEPAGE_ID, draft: layout },
    update: { draft: layout },
  });

  ok(res, state(row), "Draft saved");
});

/**
 * POST /admin/homepage/publish — draft becomes live.
 *
 * The stored draft is re-validated here rather than trusted, because publishing is the one
 * operation that hands a document to visitors: a tree written by an older editor that no
 * longer parses should fail the publish, not reach the storefront.
 */
adminHomepageRouter.post("/publish", async (_req, res) => {
  const row = await load();
  const draft = parseLayout(row.draft);

  const updated = await prisma.homePage.update({
    where: { id: row.id },
    data: { published: draft },
  });

  ok(res, state(updated), "Homepage published");
});

/**
 * POST /admin/homepage/discard-draft — throw the draft away and start again from published.
 *
 * Refuses when nothing has been published. Falling back to an empty layout there would read
 * as "discard" while actually deleting every element the admin has built, and the one thing
 * the button should never do is the destructive interpretation of itself.
 */
adminHomepageRouter.post("/discard-draft", async (_req, res) => {
  const row = await load();
  if (row.published === null) {
    throw new AppError("Nothing is published yet, so there is no draft to discard", 400);
  }

  const updated = await prisma.homePage.update({
    where: { id: row.id },
    data: { draft: row.published },
  });

  ok(res, state(updated), "Draft reset to the published homepage");
});

export default adminHomepageRouter;
