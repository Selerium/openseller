import express from "express";
import meHandler from "./postAuth/me.ts";
import profileHandler from "./postAuth/profile.ts";
import firstTimeHandler from "./postAuth/firstTime.ts";
import profilesHandler from "./postAuth/profiles.ts";
import checkTokens from "../middleware/checkTokens.ts";
import notFoundHandler from "../middleware/notFound.ts";
import adminRouter from "./admin/index.ts";
import addressesRouter from "./account/addresses.ts";
import ordersRouter from "./account/orders.ts";
import complaintsRouter from "./account/complaints.ts";
import notificationsRouter from "./account/notifications.ts";
import paymentMethodsRouter from "./account/paymentMethods.ts";
import accountDeleteRouter from "./account/delete.ts";

const protectedRouter = express.Router();

// Mounted with an explicit path list rather than `use(checkTokens)` on the whole router.
//
// Mounting the guard bare made it run for *every* request reaching this router, including
// paths no route below matches. Those then fell through to checkTokens and were answered with
// 401 "No access token provided" — so a frontend link pointed at the wrong origin looked
// exactly like a broken session, and there was no way to tell the two apart. Scoping the
// guard to the paths that actually exist means anything else 404s as a 404 should.
//
// "/orders" and "/complaints" are deliberately absent: both are reachable without a session
// through their guest-token routes, so each applies checkTokens to its own authenticated paths
// instead. Adding them here would 401 the guest routes too.
//
// "/account" is here for payment methods and account deletion, which were previously reachable
// but unreachable in practice: without checkTokens nothing populated req.user, so DELETE
// /account/delete answered 401 for every caller (correct by accident) and the setup-intent route
// dereferenced req.user!.profileId and threw a 500. Both are written against req.user.id.
// "/notifications" has no guest routes (an inbox belongs to a session), so it is guarded
// at the mount like /addresses rather than inside the router like /orders.
const GUARDED = ["/me", "/profile", "/profiles", "/admin", "/addresses", "/account", "/notifications"];

for (const path of GUARDED) {
  protectedRouter.use(path, checkTokens);
}

protectedRouter.use('/me', meHandler)
protectedRouter.use('/profile', profileHandler)
protectedRouter.use('/profile/first-time', firstTimeHandler)
protectedRouter.use('/profiles', profilesHandler)
protectedRouter.use('/addresses', addressesRouter)
protectedRouter.use('/orders', ordersRouter)
protectedRouter.use('/complaints', complaintsRouter)
protectedRouter.use('/notifications', notificationsRouter)
protectedRouter.use('/account/payment-methods', paymentMethodsRouter)
protectedRouter.use('/account', accountDeleteRouter)
// mounted from inside the protected chain so these routes run checkTokens first;
// requireAdmin reads req.user, which only exists once checkTokens has populated it
protectedRouter.use('/admin', adminRouter)

// last, so it only sees requests no route above claimed
protectedRouter.use(notFoundHandler)

export default protectedRouter;
