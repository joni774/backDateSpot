import { createAdminRouter } from "@datespot/admin-logic";
import { env } from "../config/env";
import { verifyTokenMiddleware, requireAdmin } from "../middleware/auth.middleware";

export default createAdminRouter({
  verifyTokenMiddleware,
  requireAdmin,
  stripeSecretKey: env.STRIPE_SECRET_KEY,
});
