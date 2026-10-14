import express from "express";
import AppError from "../../lib/appError.ts";
import { normalizeDiscountCode, redeemableCode } from "../../lib/discount.ts";

/**
 * Public discount check for the checkout page.
 *
 * GET /checkout/discount/validate?code=SAVE10 -> { code, percentOff }
 *
 * Lets the shopper see "10% off applied" before paying. Advisory only: the session
 * re-validates the code at purchase time, so a code switched off in between is refused
 * there rather than honoured from this earlier answer.
 */
const discountValidateRouter = express.Router();

discountValidateRouter.get("/validate", async (req, res) => {
  const code = normalizeDiscountCode(req.query.code);
  if (!code) throw new AppError("Enter a discount code", 400);

  const valid = await redeemableCode(code);
  res.status(200).json({
    data: { code: valid.code, percentOff: valid.percentOff },
    error: false,
    message: `${valid.percentOff}% off applied`,
  });
});

export default discountValidateRouter;
