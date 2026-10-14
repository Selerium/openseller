-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "discountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salePriceCents" INTEGER NOT NULL DEFAULT 0;

-- Backfill salePriceCents before anything can read it. Every pre-existing row has
-- discountPercent = 0, so its effective price is exactly minPriceCents. Without this the column
-- stays 0 on all 27 seeded products and every card renders 0.00 until some unrelated variant
-- edit happens to trigger recomputeProductRollup.
UPDATE "Product" SET "salePriceCents" = "minPriceCents" WHERE "salePriceCents" = 0;

-- CreateIndex
CREATE INDEX "Product_discountPercent_idx" ON "Product"("discountPercent");

-- CreateIndex
CREATE INDEX "Product_salePriceCents_idx" ON "Product"("salePriceCents");
