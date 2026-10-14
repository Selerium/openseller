-- Support email-change reverification.
--
-- Two changes, both prompted by the email-change flow rather than by anything in the schema
-- being wrong:
--
--   1. User.emailChangedAt, so cleanupUnverifiedUsers can tell an abandoned signup apart from
--      a real account waiting on a verification mail. It previously keyed off createdAt alone,
--      which cannot distinguish the two: a user who registers, verifies, then changes address
--      within 24h of registering produced exactly the state the sweep was written to delete.
--
--   2. Addresses lowercased, because the four code paths that read them are about to agree on
--      a single normalized form. register stored whatever was typed, login matched it exactly,
--      and resend-verification already lowercased -- so an account registered as "Bob@X.com"
--      could neither log in nor ask for a new link. Normalizing the stored rows is what makes
--      the existing data reachable under the new lookup.

-- 1. The new column. Nullable and unindexed on purpose: it is written once per email change and
--    read only by a rare sweep, so an index would cost write throughput on the credential row
--    for a query that runs on a table small enough to scan.
ALTER TABLE "User" ADD COLUMN "emailChangedAt" TIMESTAMP(3);

-- 2. Normalize existing addresses, but refuse to guess if two accounts would collide.
--
-- Checked first and separately from the UPDATE, because a unique violation here would abort the
-- whole migration mid-transaction and leave the column unadded. Picking a winner instead would
-- silently lock one of the two people out of an account they can prove they own, so this fails
-- loudly and asks for a human to merge them.
DO $$
DECLARE
  collision_count INTEGER;
BEGIN
  SELECT count(*) INTO collision_count FROM (
    SELECT lower(btrim("email")) AS normalized
    FROM "User"
    GROUP BY normalized
    HAVING count(*) > 1
  ) collisions;

  IF collision_count > 0 THEN
    RAISE EXCEPTION
      'refusing to apply: % email addresses collide once normalized. Merge those accounts by hand, then re-run.',
      collision_count;
  END IF;
END $$;

UPDATE "User"
SET "email" = lower(btrim("email"))
WHERE "email" <> lower(btrim("email"));
