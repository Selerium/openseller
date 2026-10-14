import AppError from "../lib/appError.ts";
import { Role } from "../lib/prismaClient.ts";

/**
 * Admin gate. Reads the role out of the access token set by `checkTokens`, so a demoted admin
 * keeps access for at most the 15 minute access token lifetime.
 */
const requireAdmin = async (req, res, next) => {
  if (!req.user) throw new AppError("Authentication required", 401);
  if (req.user.role !== Role.ADMIN) throw new AppError("Admin access required", 403);
  next();
};

export default requireAdmin;
