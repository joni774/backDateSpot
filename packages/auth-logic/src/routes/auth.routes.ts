import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@datespot/database";
import { generateRandomPassword } from "@datespot/utils";
import { hashPassword, comparePassword } from "../utils/password.util";
import { createJwtUtils } from "../utils/jwt.util";
import { createEmailSender } from "../utils/email.util";
import { createVerifyTokenMiddleware } from "../middleware/auth.middleware";

const registerSchema = z.object({
  fullName: z.string().min(2),
  age: z.number().int().min(18).max(120),
  phone: z.string().min(9),
  email: z.string().email(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export interface AuthRouterConfig {
  jwtSecret: string;
  sendgridApiKey?: string;
  sendgridFromEmail?: string;
  loginLimiter?: RequestHandler;
}

export function createAuthRouter(config: AuthRouterConfig): Router {
  const router = Router();
  const { generateToken, verifyToken } = createJwtUtils(config.jwtSecret);
  const { sendPasswordEmail } = createEmailSender({
    sendgridApiKey: config.sendgridApiKey,
    sendgridFromEmail: config.sendgridFromEmail,
  });
  const verifyTokenMiddleware = createVerifyTokenMiddleware(verifyToken);

  router.post("/register", async (req, res) => {
    try {
      const body = registerSchema.parse(req.body);
      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
      const plainPassword = generateRandomPassword(8);
      const passwordHash = await hashPassword(plainPassword);
      await prisma.user.create({
        data: {
          fullName: body.fullName,
          age: body.age,
          phone: body.phone,
          email: body.email,
          passwordHash,
        },
      });
      await sendPasswordEmail(body.email, plainPassword);
      res.json({ message: "Password sent to your email" });
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
  if (config.loginLimiter) {
    loginHandlers.push(config.loginLimiter);
  }
  loginHandlers.push(async (req, res) => {
    try {
      const body = loginSchema.parse(req.body);
      console.log("[auth/login] request", { email: body.email });

      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user) {
        console.log("[auth/login] response 401 user not found", { email: body.email });
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }
      const valid = await comparePassword(body.password, user.passwordHash);
      if (!valid) {
        console.log("[auth/login] response 401 invalid password", {
          email: body.email,
          userId: user.id,
        });
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }
      const token = generateToken(user.id, user.isAdmin);
      console.log("[auth/login] response 200 success", {
        email: user.email,
        userId: user.id,
      });
      res.json({
        token,
        user: {
          id: user.id,
          fullName: user.fullName,
          age: user.age,
          phone: user.phone,
          email: user.email,
          subscriptionTier: user.subscriptionTier,
          isAdmin: user.isAdmin,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        console.log("[auth/login] response 400 validation error", err.flatten());
        res.status(400).json({ error: err.flatten() });
        return;
      }
      console.error("[auth/login] response 500", err);
      res.status(500).json({ error: "Login failed" });
    }
  });
  router.post("/login", ...loginHandlers);

  router.post("/change-password", verifyTokenMiddleware, async (req, res) => {
    try {
      const body = changePasswordSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const valid = await comparePassword(body.currentPassword, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }
      const passwordHash = await hashPassword(body.newPassword);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
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

  return router;
}
