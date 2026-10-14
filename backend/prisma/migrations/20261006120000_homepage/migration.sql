-- Admin-configured homepage layout.
--
-- One table, two JSON documents, because the page is loaded and saved as a whole:
--
--   draft     -- what the editor is working on, written by every change the admin makes
--   published -- what the storefront serves, written by the Publish button
--
-- A null `published` means "never published" and is not the same as "published an empty
-- page": the storefront falls back to its placeholder only in that first case.
--
-- Normalizing sections/columns/elements into three tables would buy nothing here -- no
-- query ever looks inside a tree, and the whole point of the editor is atomic writes --
-- at the cost of position bookkeeping, cascade rules, and an N-1 read per page view.

-- CreateTable
CREATE TABLE "HomePage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,

    CONSTRAINT "HomePage_pkey" PRIMARY KEY ("id")
);
