import jwt from "jsonwebtoken";
import { env } from "../config/env";

const EXPIRES_IN = "30d";

export interface JwtPayload {
  userId: string;
  isAdmin: boolean;
}

export function generateToken(userId: string, isAdmin: boolean): string {
  return jwt.sign({ userId, isAdmin }, env.JWT_SECRET, {
    expiresIn: EXPIRES_IN,
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
