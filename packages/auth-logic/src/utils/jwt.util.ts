import jwt from "jsonwebtoken";

const EXPIRES_IN = "30d";

export interface JwtPayload {
  userId: string;
  isAdmin: boolean;
}

export function createJwtUtils(jwtSecret: string) {
  function generateToken(userId: string, isAdmin: boolean): string {
    return jwt.sign({ userId, isAdmin }, jwtSecret, {
      expiresIn: EXPIRES_IN,
    });
  }

  function verifyToken(token: string): JwtPayload {
    return jwt.verify(token, jwtSecret) as JwtPayload;
  }

  return { generateToken, verifyToken };
}
