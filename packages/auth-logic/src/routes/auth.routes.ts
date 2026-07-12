import { Router, type RequestHandler } from "express";
import { z } from "zod";
import crypto from "crypto";
import { prisma, SubscriptionTier } from "@datespot/database";
import { hashPassword, comparePassword } from "../utils/password.util";
import { createJwtUtils } from "../utils/jwt.util";
import {
  issueTokenPair,
  revokeAllUserRefreshTokens,
  revokeRefreshToken,
  serializeAuthUser,
} from "../utils/auth.helpers";
import { createEmailSender } from "../utils/email.util";
import { createVerifyTokenMiddleware } from "../middleware/auth.middleware";

const registerSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    fullName: z.string().min(2).optional(),
    age: z.number().int().min(18).max(120).default(18),
    phone: z.string().min(9),
    email: z.string().email(),
    password: z.string().min(8),
  })
  .superRefine((data, ctx) => {
    const hasSplit = Boolean(data.firstName?.trim() && data.lastName?.trim());
    const hasFull = Boolean(data.fullName?.trim() && data.fullName.trim().length >= 2);
    if (!hasSplit && !hasFull) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "firstName and lastName (or fullName) required",
        path: ["firstName"],
      });
    }
  });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const profileUpdateSchema = z.object({
  fullName: z.string().min(2).optional(),
  age: z.number().int().min(18).max(120).optional(),
  phone: z.string().min(9).optional(),
  onboardingDone: z.boolean().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const otpSendSchema = z.object({
  phone: z.string().min(9),
});

const otpVerifySchema = z.object({
  phone: z.string().min(9),
  code: z.string().length(6),
});

const socialGoogleSchema = z.object({
  idToken: z.string().min(1),
});

const socialAppleSchema = z.object({
  idToken: z.string().min(1),
  email: z.string().email().optional(),
  fullName: z.string().min(2).optional(),
});

const pushTokenSchema = z.object({
  expoPushToken: z.string().min(1),
});

const purchaseSchema = z.object({
  tier: z.enum(["VIP", "DATING"]),
  receipt: z.string().optional(),
  cardNumber: z.string().min(12).max(19).optional(),
  cardExpiry: z.string().regex(/^\d{2}\/\d{2}$/).optional(),
  cardCvv: z.string().regex(/^\d{3,4}$/).optional(),
  cardHolder: z.string().min(2).optional(),
});

const TIER_PRICES_AGOROT: Record<"VIP" | "DATING", number> = {
  VIP: 2990,
  DATING: 3990,
};

export interface AuthRouterConfig {
  jwtSecret: string;
  sendgridApiKey?: string;
  sendgridFromEmail?: string;
  loginLimiter?: RequestHandler;
  appPublicUrl?: string;
}

async function verifyGoogleIdToken(idToken: string): Promise<{ sub: string; email: string; name?: string }> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) throw new Error("Invalid Google token");
  const data = (await res.json()) as { sub: string; email: string; name?: string };
  return data;
}

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function createAuthRouter(config: AuthRouterConfig): Router {
  const router = Router();
  const jwtUtils = createJwtUtils(config.jwtSecret);
  const { sendPasswordResetEmail } = createEmailSender({
    sendgridApiKey: config.sendgridApiKey,
    sendgridFromEmail: config.sendgridFromEmail,
  });
  const verifyTokenMiddleware = createVerifyTokenMiddleware(jwtUtils.verifyAccessToken);

  async function loginSuccess(user: Awaited<ReturnType<typeof prisma.user.findUnique>> & object, res: import("express").Response) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const { accessToken, refreshToken } = await issueTokenPair(jwtUtils, user.id, user.isAdmin);
    res.json({
      token: accessToken,
      refreshToken,
      user: serializeAuthUser(user),
    });
  }

  router.post("/register", async (req, res) => {
    try {
      const body = registerSchema.parse(req.body);
      const fullName =
        body.firstName?.trim() && body.lastName?.trim()
          ? `${body.firstName.trim()} ${body.lastName.trim()}`
          : body.fullName!.trim();

      const existingEmail = await prisma.user.findUnique({ where: { email: body.email } });
      if (existingEmail) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
      const existingPhone = await prisma.user.findUnique({ where: { phone: body.phone } });
      if (existingPhone) {
        res.status(409).json({ error: "Phone already registered" });
        return;
      }

      const passwordHash = await hashPassword(body.password);
      await prisma.user.create({
        data: {
          fullName,
          age: body.age,
          phone: body.phone,
          email: body.email,
          passwordHash,
        },
      });
      res.status(201).json({ message: "Registration successful" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  const loginHandlers: RequestHandler[] = [];
  if (config.loginLimiter) loginHandlers.push(config.loginLimiter);
  loginHandlers.push(async (req, res) => {
    try {
      const body = loginSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user || !user.passwordHash) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }
      const valid = await comparePassword(body.password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }
      await loginSuccess(user, res);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Login failed" });
    }
  });
  router.post("/login", ...loginHandlers);

  router.post("/refresh", async (req, res) => {
    try {
      const body = refreshSchema.parse(req.body);
      const stored = await prisma.refreshToken.findUnique({
        where: { token: body.refreshToken },
        include: { user: true },
      });
      if (!stored || stored.expiresAt < new Date()) {
        res.status(401).json({ error: "Invalid or expired refresh token" });
        return;
      }
      await revokeRefreshToken(body.refreshToken);
      const { accessToken, refreshToken } = await issueTokenPair(
        jwtUtils,
        stored.user.id,
        stored.user.isAdmin
      );
      res.json({
        token: accessToken,
        refreshToken,
        user: serializeAuthUser(stored.user),
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Token refresh failed" });
    }
  });

  router.post("/logout", verifyTokenMiddleware, async (req, res) => {
    try {
      const refreshToken = req.body?.refreshToken as string | undefined;
      if (refreshToken) await revokeRefreshToken(refreshToken);
      else await revokeAllUserRefreshTokens(req.user!.userId);
      res.json({ message: "Logged out" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Logout failed" });
    }
  });

  router.get("/me", verifyTokenMiddleware, async (req, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ user: serializeAuthUser(user) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  router.put("/profile", verifyTokenMiddleware, async (req, res) => {
    try {
      const body = profileUpdateSchema.parse(req.body);
      if (body.phone) {
        const taken = await prisma.user.findFirst({
          where: { phone: body.phone, NOT: { id: req.user!.userId } },
        });
        if (taken) {
          res.status(409).json({ error: "Phone already in use" });
          return;
        }
      }
      const user = await prisma.user.update({
        where: { id: req.user!.userId },
        data: body,
      });
      res.json({ user: serializeAuthUser(user) });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Profile update failed" });
    }
  });

  router.post("/change-password", verifyTokenMiddleware, async (req, res) => {
    try {
      const body = changePasswordSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (!user.passwordHash) {
        res.status(400).json({ error: "Social login account — set password via reset flow" });
        return;
      }
      const valid = await comparePassword(body.currentPassword, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }
      const passwordHash = await hashPassword(body.newPassword);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
      await revokeAllUserRefreshTokens(user.id);
      res.json({ message: "Password updated successfully" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Password change failed" });
    }
  });

  router.post("/forgot-password", async (req, res) => {
    try {
      const body = forgotPasswordSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user) {
        res.json({ message: "If the email exists, a reset link was sent" });
        return;
      }
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      });
      const baseUrl = config.appPublicUrl ?? "datespot://reset-password";
      const resetLink = `${baseUrl}?token=${token}`;
      await sendPasswordResetEmail(user.email, resetLink);
      res.json({ message: "If the email exists, a reset link was sent" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Forgot password failed" });
    }
  });

  router.post("/reset-password", async (req, res) => {
    try {
      const body = resetPasswordSchema.parse(req.body);
      const reset = await prisma.passwordResetToken.findUnique({
        where: { token: body.token },
        include: { user: true },
      });
      if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
        res.status(400).json({ error: "Invalid or expired reset token" });
        return;
      }
      const passwordHash = await hashPassword(body.newPassword);
      await prisma.$transaction([
        prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
        prisma.passwordResetToken.update({
          where: { id: reset.id },
          data: { usedAt: new Date() },
        }),
        prisma.refreshToken.deleteMany({ where: { userId: reset.userId } }),
      ]);
      res.json({ message: "Password reset successfully" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Reset password failed" });
    }
  });

  router.post("/otp/send", verifyTokenMiddleware, async (req, res) => {
    try {
      const body = otpSendSchema.parse(req.body);
      const code = generateOtpCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await prisma.otpCode.create({
        data: {
          userId: req.user!.userId,
          phone: body.phone,
          code,
          expiresAt,
        },
      });
      console.log(`[DateSpot OTP] phone=${body.phone} code=${code}`);
      res.json({ message: "OTP sent", devCode: process.env.NODE_ENV !== "production" ? code : undefined });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "OTP send failed" });
    }
  });

  router.post("/otp/verify", verifyTokenMiddleware, async (req, res) => {
    try {
      const body = otpVerifySchema.parse(req.body);
      const otp = await prisma.otpCode.findFirst({
        where: {
          userId: req.user!.userId,
          phone: body.phone,
          code: body.code,
          verified: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!otp) {
        res.status(400).json({ error: "Invalid or expired OTP" });
        return;
      }
      await prisma.$transaction([
        prisma.otpCode.update({ where: { id: otp.id }, data: { verified: true } }),
        prisma.user.update({
          where: { id: req.user!.userId },
          data: { phone: body.phone, phoneVerified: true },
        }),
      ]);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });
      res.json({ message: "Phone verified", user: serializeAuthUser(user) });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "OTP verify failed" });
    }
  });

  router.post("/social/google", async (req, res) => {
    try {
      const body = socialGoogleSchema.parse(req.body);
      const googleUser = await verifyGoogleIdToken(body.idToken);
      let user = await prisma.user.findUnique({ where: { googleId: googleUser.sub } });
      if (!user) {
        user = await prisma.user.findUnique({ where: { email: googleUser.email } });
        if (user) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { googleId: googleUser.sub },
          });
        } else {
          user = await prisma.user.create({
            data: {
              fullName: googleUser.name ?? googleUser.email.split("@")[0],
              age: 18,
              phone: `g-${googleUser.sub.slice(0, 20)}`,
              email: googleUser.email,
              googleId: googleUser.sub,
              onboardingDone: false,
            },
          });
        }
      }
      await loginSuccess(user, res);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(401).json({ error: "Google login failed" });
    }
  });

  router.post("/social/apple", async (req, res) => {
    try {
      const body = socialAppleSchema.parse(req.body);
      const appleSub = crypto.createHash("sha256").update(body.idToken).digest("hex").slice(0, 32);
      let user = await prisma.user.findUnique({ where: { appleId: appleSub } });
      if (!user && body.email) {
        user = await prisma.user.findUnique({ where: { email: body.email } });
        if (user) {
          user = await prisma.user.update({ where: { id: user.id }, data: { appleId: appleSub } });
        }
      }
      if (!user) {
        if (!body.email) {
          res.status(400).json({ error: "Email required for first Apple sign-in" });
          return;
        }
        user = await prisma.user.create({
          data: {
            fullName: body.fullName ?? body.email.split("@")[0],
            age: 18,
            phone: `a-${appleSub.slice(0, 20)}`,
            email: body.email,
            appleId: appleSub,
            onboardingDone: false,
          },
        });
      }
      await loginSuccess(user, res);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(401).json({ error: "Apple login failed" });
    }
  });

  router.put("/push-token", verifyTokenMiddleware, async (req, res) => {
    try {
      const body = pushTokenSchema.parse(req.body);
      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { expoPushToken: body.expoPushToken },
      });
      res.json({ message: "Push token registered" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Push token registration failed" });
    }
  });

  router.post("/subscriptions/purchase", verifyTokenMiddleware, async (req, res) => {
    try {
      const body = purchaseSchema.parse(req.body);
      if (process.env.NODE_ENV === "production" && !body.receipt && !body.cardNumber) {
        res.status(400).json({ error: "Payment details required" });
        return;
      }

      if (body.cardNumber) {
        const digits = body.cardNumber.replace(/\s+/g, "");
        if (!/^\d{12,19}$/.test(digits)) {
          res.status(400).json({ error: "Invalid card number" });
          return;
        }
        if (!body.cardExpiry || !body.cardCvv || !body.cardHolder) {
          res.status(400).json({ error: "Incomplete card details" });
          return;
        }
      }

      const last4 = body.cardNumber
        ? body.cardNumber.replace(/\s+/g, "").slice(-4)
        : null;

      const user = await prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            userId: req.user!.userId,
            tier: body.tier as SubscriptionTier,
            amountAgorot: TIER_PRICES_AGOROT[body.tier],
            currency: "ILS",
            provider: body.cardNumber ? "card" : "dev-receipt",
            status: "succeeded",
            last4,
          },
        });
        return tx.user.update({
          where: { id: req.user!.userId },
          data: { subscriptionTier: body.tier as SubscriptionTier },
        });
      });

      res.json({ message: "Subscription updated", user: serializeAuthUser(user) });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Purchase failed" });
    }
  });

  return router;
}
