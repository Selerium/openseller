-- Discount codes, order discount snapshot columns, and the complaint message thread.
--
-- DiscountCode stands alone rather than hanging off Order: codes are created before any order
-- uses them, and an order snapshots the code string plus the cents taken off (see the
-- discountCode/discountCents columns below) so the receipt survives the code being edited or
-- deleted afterwards.
--
-- ComplaintMessage rows are append-only. A message is never edited or deleted; the thread is
-- the audit trail, which is why status changes stay on Complaint and the words live here.

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_code_key" ON "DiscountCode"("code");

-- CreateIndex
CREATE INDEX "DiscountCode_active_idx" ON "DiscountCode"("active");

-- CreateTable
CREATE TABLE "ComplaintMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "complaintId" TEXT NOT NULL,
    "author" "MessageAuthor" NOT NULL,
    "authorProfileId" TEXT,
    "body" TEXT NOT NULL,

    CONSTRAINT "ComplaintMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplaintMessage_complaintId_createdAt_idx" ON "ComplaintMessage"("complaintId", "createdAt");

-- AddForeignKey
ALTER TABLE "ComplaintMessage" ADD CONSTRAINT "ComplaintMessage_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "discountCode" TEXT,
ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0;
