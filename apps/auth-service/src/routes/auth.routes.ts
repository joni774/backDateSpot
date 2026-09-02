import rateLimit from "express-rate-limit";
import { createAuthRouter } from "@datespot/auth-logic";
import { env } from "../config/env";

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again later" },
});

const authRoutes = createAuthRouter({
  jwtSecret: env.JWT_SECRET,
  sendgridApiKey: env.SENDGRID_API_KEY,
  sendgridFromEmail: env.SENDGRID_FROM_EMAIL,
  loginLimiter,
});

export default authRoutes;
