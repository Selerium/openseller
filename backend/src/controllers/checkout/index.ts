import express from "express";
import optionalAuth from "../../middleware/optionalAuth.ts";
import sessionRouter from "./session.ts";
import discountValidateRouter from "./validate.ts";
import mockPayRouter from "./mockPay.ts";
import confirmRouter from "./confirm.ts";
import cancelRouter from "./cancel.ts";

/**
 * Checkout.
 *
 * Three of these routes are open to guests, because guests are the main audience for a
 * storefront:
 *
 *   POST /session      creates the order and returns where to go pay
 *   POST /mock-pay/:id confirms a mock payment, and only exists when ALLOW_MOCK_PAYMENTS
 *   POST /confirm      re-reads a finished Stripe Checkout session and records the payment
 *   POST /cancel       cancels an order whose Checkout the shopper walked away from
 *
 * All three read an optional session. When there is one, req.user.id is the buyer's Profile id
 * and the order is attached to them; when there is not, the order is a guest order with a token.
 * The distinction is made per request rather than by mounting a separate router, so the two
 * cases cannot diverge in pricing or stock handling.
 *
 * optionalAuth is what makes "an optional session" actually true. app.ts mounts this router
 * above the protected mount, so checkTokens never runs here and req.user would otherwise be
 * undefined for everybody — see middleware/optionalAuth.ts.
 */
const checkoutRouter = express.Router();

checkoutRouter.use(optionalAuth);

// mock-pay comes first so its "/:orderId" cannot shadow anything; sessionRouter only answers
// POST /session, so the order between them does not actually matter. It is here to match the
// reading order of the routes above.
checkoutRouter.use("/mock-pay", mockPayRouter);
checkoutRouter.use("/discount", discountValidateRouter);
checkoutRouter.use("/confirm", confirmRouter);
checkoutRouter.use("/cancel", cancelRouter);
checkoutRouter.use("", sessionRouter);

export default checkoutRouter;
