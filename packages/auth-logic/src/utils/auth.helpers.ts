import type { User } from "@datespot/database";
import { prisma } from "@datespot/database";
import type { createJwtUtils } from "./jwt.util";

type JwtUtils = ReturnType<typeof createJwtUtils>;

export function serializeAuthUser(user: User) {
  return {
    id: user.id,
    fullName: user.fullName,
    age: user.age,
    phone: user.phone,
    email: user.email,
    subscriptionTier: user.subscriptionTier,
    isAdmin: user.isAdmin,
    phoneVerified: user.phoneVerified,
    onboardingDone: user.onboardingDone,
  };
}

export async function issueTokenPair(
  jwtUtils: JwtUtils,
  userId: string,
  isAdmin: boolean
) {
  const accessToken = jwtUtils.generateAccessToken(userId, isAdmin);
  const refreshToken = jwtUtils.generateRefreshTokenValue();
  await prisma.refreshToken.create({
    data: {
      userId,
      token: refreshToken,
      expiresAt: jwtUtils.getRefreshTokenExpiry(),
    },
  });
  return { accessToken, refreshToken };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { token } });
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}
