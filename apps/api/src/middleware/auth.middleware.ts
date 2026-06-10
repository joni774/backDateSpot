// JWT authentication middleware: required, optional, and admin-only.

import type { NextFunction, Request, Response } from "express";
import { prisma } from "@datespot/database";
import { verifyToken } from "../utils/jwt.util";

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

/** Require valid JWT; attaches user to req or returns 401. */
export async function verifyTokenMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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
}

/** Attach user when token present; continue without user when absent. */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      next();
      return;
    }
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, isAdmin: true, subscriptionTier: true },
    });
    if (user) {
      req.user = {
        userId: user.id,
        isAdmin: user.isAdmin,
        subscriptionTier: user.subscriptionTier,
      };
    }
    next();
  } catch {
    next();
  }
}

/** Require authenticated admin user. */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
