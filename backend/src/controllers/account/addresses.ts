import express from "express";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";
import { parseAddressInput, parseAddressLabel } from "../../lib/address.ts";

/**
 * The shopper's address book. Mounted under /addresses with checkTokens, so req.user.id is the
 * Profile id and every query is scoped by it — there is no path where one shopper can read or
 * write another's addresses.
 */
const addressesRouter = express.Router();

const toResponse = (address: {
  id: string;
  label: string;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  phone: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: address.id,
  label: address.label,
  recipientName: address.recipientName,
  line1: address.line1,
  line2: address.line2,
  city: address.city,
  region: address.region,
  postalCode: address.postalCode,
  countryCode: address.countryCode,
  phone: address.phone,
  isDefault: address.isDefault,
  createdAt: address.createdAt,
  updatedAt: address.updatedAt,
});

addressesRouter.get("", async (req, res) => {
  const addresses = await prisma.address.findMany({
    where: { profileId: req.user.id },
    // Default first, then newest. The rest is alphabetical by label so the book has a stable
    // order that does not shuffle every time an unrelated row is edited.
    orderBy: [{ isDefault: "desc" }, { label: "asc" }, { createdAt: "asc" }],
  });

  res.status(200).json({ data: addresses.map(toResponse), error: false, message: "" });
});

addressesRouter.post("", async (req, res) => {
  const profileId = req.user.id;
  const input = parseAddressInput(req.body);
  const label = parseAddressLabel(req.body?.label);

  // A first address is made the default automatically. Otherwise the shopper saves their only
  // address, goes to checkout, and is told no default exists.
  const existingCount = await prisma.address.count({ where: { profileId } });
  const wantsDefault = req.body?.isDefault === true || existingCount === 0;

  const address = await prisma.$transaction(async (tx) => {
    if (wantsDefault) {
      await tx.address.updateMany({
        where: { profileId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.address.create({
      data: { ...input, label, profileId, isDefault: wantsDefault },
    });
  });

  res.status(201).json({ data: toResponse(address), error: false, message: "Address saved" });
});

addressesRouter.patch("/:id", async (req, res) => {
  const id = req.params.id;
  const profileId = req.user.id;

  // Scope the lookup by profileId rather than finding by id and then checking. Same result,
  // but a wrong-owner id is indistinguishable from a missing id, which is what prevents this
  // endpoint from confirming that some other shopper's address exists.
  const existing = await prisma.address.findFirst({ where: { id, profileId } });
  if (!existing) throw new AppError("Address not found", 404);

  // Layer the patch over the stored row and validate the merged result exactly once.
  // parseAddressInput demands the mandatory fields, so a partial body cannot be validated on its
  // own; and validating each supplied field separately would re-run the same checks once per
  // field and let a patch that combines fields into an invalid whole slip through.
  const body = req.body ?? {};
  const merged = parseAddressInput({
    recipientName: body.recipientName ?? existing.recipientName,
    line1: body.line1 ?? existing.line1,
    line2: body.line2 === undefined ? existing.line2 : body.line2,
    city: body.city ?? existing.city,
    region: body.region === undefined ? existing.region : body.region,
    postalCode: body.postalCode === undefined ? existing.postalCode : body.postalCode,
    countryCode: body.countryCode ?? existing.countryCode,
    phone: body.phone === undefined ? existing.phone : body.phone,
  });

  // Writing back the full merged address is a no-op for fields the client did not send, and
  // avoids a per-field "was it present?" dance.
  const data: Record<string, unknown> = { ...merged };
  if (body.label !== undefined) data.label = parseAddressLabel(body.label);

  const wantsDefault = body.isDefault === true;

  const address = await prisma.$transaction(async (tx) => {
    if (wantsDefault && !existing.isDefault) {
      await tx.address.updateMany({
        where: { profileId, isDefault: true },
        data: { isDefault: false },
      });
      data.isDefault = true;
    }
    // Setting isDefault: false on the current default is deliberately a no-op. There must always
    // be a default, and the alternative — allowing a book with no default — puts that invariant
    // in the frontend's hands, where it is not enforced. Promoting another address is the way to
    // change which one is default.
    return tx.address.update({ where: { id }, data });
  });

  res.status(200).json({ data: toResponse(address), error: false, message: "Address updated" });
});

addressesRouter.delete("/:id", async (req, res) => {
  const id = req.params.id;
  const profileId = req.user.id;

  const existing = await prisma.address.findFirst({ where: { id, profileId } });
  if (!existing) throw new AppError("Address not found", 404);

  await prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id } });

    // Deleting the default would otherwise leave the book with no default, so the next one by
    // insertion order inherits it.
    if (existing.isDefault) {
      const replacement = await tx.address.findFirst({
        where: { profileId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (replacement) {
        await tx.address.update({ where: { id: replacement.id }, data: { isDefault: true } });
      }
    }
  });

  res.status(200).json({ data: {}, error: false, message: "Address deleted" });
});

export default addressesRouter;