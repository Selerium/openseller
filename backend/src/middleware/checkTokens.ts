import jwt from "jsonwebtoken";
import AppError from "../lib/appError.ts";
import { prisma } from "../lib/prismaClient.ts";
import { setAuthCookies } from "../lib/cookies.ts";
import { signAccessToken, signRefreshToken, hashRefreshToken } from "../lib/tokens.ts";

const checkTokens = async (req, res, next) => {
    const accessToken = req.cookies.access_token;
    const refreshToken = req.cookies.refresh_token;
    const jwtsecret = process.env.JWT_SECRET || "";

    if (accessToken) {
        try {
            const decoded = jwt.verify(accessToken, jwtsecret);
            req.user = decoded;
            return next();
        } catch (err) {
            if (err.name !== "TokenExpiredError") {
                throw new AppError("Invalid access token", 401);
            }
        }
    }

    if (!refreshToken) {
        throw new AppError("No access token provided", 401);
    }

    let decodedRefresh;
    try {
        decodedRefresh = jwt.verify(refreshToken, jwtsecret);
    } catch {
        throw new AppError("Invalid refresh token", 401);
    }

    // Direct indexed lookup on the digest rather than bcrypt-scanning every live token.
    // See lib/tokens.ts hashRefreshToken for why bcrypt was the wrong tool here.
    const storedToken = await prisma.refreshTokens.findUnique({
        where: { tokenHash: hashRefreshToken(refreshToken) },
    });

    if (!storedToken || storedToken.revokedAt || storedToken.userId !== decodedRefresh.id) {
        throw new AppError("Refresh token has been revoked", 401);
    }

    const user = await prisma.user.findUnique({
        where: { id: decodedRefresh.id },
        include: { profile: true },
    });

    if (!user || !user.profile) {
      throw new AppError("User not found", 401);
    }

    if (!user.emailVerified) {
      throw new AppError("Please verify your email address first", 403);
    }

    const newAccessToken = signAccessToken({
        id: user.profile.id,
        name: user.profile.name,
        role: user.profile.role,
        firstTime: user.profile.firstTime,
    });

    const newRefreshToken = signRefreshToken(user.id);

    // revoke the presented token and store its replacement in one transaction, so a crash
    // between the two cannot leave the user with both revoked and issued
    await prisma.$transaction([
        prisma.refreshTokens.update({
            where: { id: storedToken.id },
            data: { revokedAt: new Date() },
        }),
        prisma.refreshTokens.create({
            data: {
                tokenHash: hashRefreshToken(newRefreshToken),
                userId: user.id,
            },
        }),
    ]);

    // rotation: the presented refresh token is revoked above, so both cookies must be replaced
    setAuthCookies(res, newAccessToken, newRefreshToken);

    req.user = jwt.verify(newAccessToken, jwtsecret);
    next();
};

export default checkTokens;
