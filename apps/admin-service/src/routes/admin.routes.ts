import { createAdminRouter } from "@datespot/admin-logic";
import { verifyTokenMiddleware, requireAdmin } from "../middleware/auth.middleware";
import { invalidatePlacesCache } from "../lib/redis";

export default createAdminRouter({
  verifyTokenMiddleware,
  requireAdmin,
  cache: { onPlacesMutated: invalidatePlacesCache },
});
