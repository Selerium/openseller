-- Split commerce data off User and onto Profile.
--
-- User is authentication only; addresses, orders, reviews, saved cards and complaints all
-- belong to the customer's Profile, as does the Stripe customer id (a billing identity, not a
-- credential). That keeps a credential deletion from cascading into order history.
--
-- Hand-written rather than generated, because the generated version drops userId and adds a
-- NOT NULL profileId in one step, which fails against a non-empty table. These tables are
-- populated: Address 8, Review 19, Order 9, Complaint 2, PaymentMethod 0.

-- 1. Add the new nullable columns alongside the old ones.
ALTER TABLE "Address"       ADD COLUMN "profileId" TEXT;
ALTER TABLE "Complaint"     ADD COLUMN "profileId" TEXT;
ALTER TABLE "Order"         ADD COLUMN "profileId" TEXT;
ALTER TABLE "PaymentMethod" ADD COLUMN "profileId" TEXT;
ALTER TABLE "Review"        ADD COLUMN "profileId" TEXT;
ALTER TABLE "Profile"       ADD COLUMN "stripeCustomerId" TEXT;

-- 2. Backfill. Profile.userId is unique, so this join yields at most one row per owner and
--    cannot duplicate a Review's new (productId, profileId) key.
UPDATE "Address"       a SET "profileId" = p."id" FROM "Profile" p WHERE p."userId" = a."userId";
UPDATE "Complaint"     c SET "profileId" = p."id" FROM "Profile" p WHERE p."userId" = c."userId";
UPDATE "Order"         o SET "profileId" = p."id" FROM "Profile" p WHERE p."userId" = o."userId";
UPDATE "PaymentMethod" m SET "profileId" = p."id" FROM "Profile" p WHERE p."userId" = m."userId";
UPDATE "Review"        r SET "profileId" = p."id" FROM "Profile" p WHERE p."userId" = r."userId";

-- Stripe customer ids move with the rest; there is one per user and one per profile.
UPDATE "Profile" p SET "stripeCustomerId" = u."stripeCustomerId" FROM "User" u WHERE u."id" = p."userId";

-- 3. Now the NOT NULL constraints are safe. PaymentMethod is empty, but assert the others
--    are fully backfilled so a partial failure here is loud rather than silent.
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT
    (SELECT count(*) FROM "Address"       WHERE "profileId" IS NULL) +
    (SELECT count(*) FROM "Review"        WHERE "profileId" IS NULL) +
    (SELECT count(*) FROM "PaymentMethod" WHERE "profileId" IS NULL)
  INTO orphan_count;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'refusing to apply: % commerce rows have no owning Profile', orphan_count;
  END IF;
END $$;

ALTER TABLE "Address"       ALTER COLUMN "profileId" SET NOT NULL;
ALTER TABLE "Review"        ALTER COLUMN "profileId" SET NOT NULL;
ALTER TABLE "PaymentMethod" ALTER COLUMN "profileId" SET NOT NULL;

-- 4. Drop the old foreign keys and indexes before the columns go.
-- Constraints go through ALTER TABLE; indexes need their own statement, since Postgres has
-- no ALTER TABLE ... DROP INDEX.
ALTER TABLE "Address"       DROP CONSTRAINT "Address_userId_fkey";
ALTER TABLE "Complaint"     DROP CONSTRAINT "Complaint_userId_fkey";
ALTER TABLE "Order"         DROP CONSTRAINT "Order_userId_fkey";
ALTER TABLE "PaymentMethod" DROP CONSTRAINT "PaymentMethod_userId_fkey";
ALTER TABLE "Review"        DROP CONSTRAINT "Review_userId_fkey";

DROP INDEX "Address_userId_idx";
DROP INDEX "Complaint_userId_idx";
DROP INDEX "Order_userId_createdAt_idx";
DROP INDEX "PaymentMethod_userId_idx";
DROP INDEX "Review_productId_userId_key";
DROP INDEX "User_stripeCustomerId_key";

-- 5. Drop the old columns and add the new constraints.
ALTER TABLE "Address"       DROP COLUMN "userId";
ALTER TABLE "Complaint"     DROP COLUMN "userId";
ALTER TABLE "Order"         DROP COLUMN "userId";
ALTER TABLE "PaymentMethod" DROP COLUMN "userId";
ALTER TABLE "Review"        DROP COLUMN "userId";
ALTER TABLE "User"          DROP COLUMN "stripeCustomerId";

CREATE INDEX "Address_profileId_idx" ON "Address"("profileId");
CREATE INDEX "Complaint_profileId_idx" ON "Complaint"("profileId");
CREATE INDEX "Order_profileId_createdAt_idx" ON "Order"("profileId", "createdAt");
CREATE INDEX "PaymentMethod_profileId_idx" ON "PaymentMethod"("profileId");
CREATE UNIQUE INDEX "Profile_stripeCustomerId_key" ON "Profile"("stripeCustomerId");
CREATE UNIQUE INDEX "Review_productId_profileId_key" ON "Review"("productId", "profileId");

ALTER TABLE "Review"        ADD CONSTRAINT "Review_profileId_fkey"        FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Address"       ADD CONSTRAINT "Address_profileId_fkey"       FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order"         ADD CONSTRAINT "Order_profileId_fkey"         FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Complaint"     ADD CONSTRAINT "Complaint_profileId_fkey"     FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;