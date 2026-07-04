import type { NextFunction, Request, RequestHandler, Response } from "express";
import { prisma } from "@datespot/database";
import type { JwtPayload } from "../utils/jwt.util";

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

export function createVerifyTokenMiddleware(
  verifyToken: (token: string) => JwtPayload
): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = extractBearerToken(req);
      if (!token) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const payload = verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, isAdmin: true, subscriptionTier: true },
      });
      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }
      req.user = {
        userId: user.id,
        isAdmin: user.isAdmin,
        subscriptionTier: user.subscriptionTier,
      };
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
