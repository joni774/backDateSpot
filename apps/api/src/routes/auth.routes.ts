// Authentication routes: register, login, change-password.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "@datespot/database";
import { generateRandomPassword } from "@datespot/utils";
import { hashPassword, comparePassword } from "../utils/password.util";
import { generateToken } from "../utils/jwt.util";
import { sendPasswordEmail } from "../utils/email.util";
import { verifyTokenMiddleware } from "../middleware/auth.middleware";

const router = Router();

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

/** Register new user; random password emailed (logged in dev). */
router.post("/register", async (req, res) => {
  try {
    const body = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({
      where: { email: body.email },
    });
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

/** Login with email/password; returns JWT and user (no password hash). */
router.post("/login", async (req, res) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const valid = await comparePassword(body.password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = generateToken(user.id, user.isAdmin);
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
      res.status(400).json({ error: err.flatten() });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

/** Change password for authenticated user. */
router.post("/change-password", verifyTokenMiddleware, async (req, res) => {
  try {
    const body = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });
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
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
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

export default router;
