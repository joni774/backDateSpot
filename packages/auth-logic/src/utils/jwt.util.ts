import jwt from "jsonwebtoken";
import crypto from "crypto";

const ACCESS_EXPIRES_IN = "15m";
const REFRESH_EXPIRES_DAYS = 30;

export interface JwtPayload {
  userId: string;
  isAdmin: boolean;
  type?: "access" | "refresh";
}

export function createJwtUtils(jwtSecret: string) {
  function generateAccessToken(userId: string, isAdmin: boolean): string {
    return jwt.sign({ userId, isAdmin, type: "access" }, jwtSecret, {
      expiresIn: ACCESS_EXPIRES_IN,
    });
  }

  function generateRefreshTokenValue(): string {
    return crypto.randomBytes(48).toString("hex");
  }

  function getRefreshTokenExpiry(): Date {
    const expires = new Date();
    expires.setDate(expires.getDate() + REFRESH_EXPIRES_DAYS);
    return expires;
  }

  /** Legacy single token (30d) — kept for backward compatibility during migration. */
  function generateToken(userId: string, isAdmin: boolean): string {
    return jwt.sign({ userId, isAdmin }, jwtSecret, { expiresIn: "30d" });
  }

  function verifyToken(token: string): JwtPayload {
    const payload = jwt.verify(token, jwtSecret) as JwtPayload;
    if (payload.type === "refresh") {
      throw new Error("Invalid token type");
    }
    return payload;
  }

  function verifyAccessToken(token: string): JwtPayload {
    const payload = verifyToken(token);
    return payload;
  }

  return {
    generateAccessToken,
    generateRefreshTokenValue,
    getRefreshTokenExpiry,
    generateToken,
    verifyToken,
    verifyAccessToken,
    ACCESS_EXPIRES_IN,
    REFRESH_EXPIRES_DAYS,
  };
}
