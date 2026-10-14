-- Notifications: the durable inbox behind the realtime bell.
--
-- A socket event alone is not enough — a shopper who was offline when support replied must
-- still see it — so every push-worthy fact is also a row here. `type` is free-form rather
-- than an enum so new kinds never need a migration; `link` is where the app takes the
-- reader (an order page for a shopper, a complaint page for support). Rows cascade off
-- the profile, so deleting an account takes its inbox with it.

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "profileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_profileId_createdAt_idx" ON "Notification"("profileId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
