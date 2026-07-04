import { createAuthRouter } from "@datespot/auth-logic";
import { env } from "../config/env";

const authRoutes = createAuthRouter({
  jwtSecret: env.JWT_SECRET,
  sendgridApiKey: env.SENDGRID_API_KEY,
});

export default authRoutes;
