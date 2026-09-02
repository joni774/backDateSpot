import { createAdminRouter } from "@datespot/admin-logic";
import { verifyTokenMiddleware, requireAdmin } from "../middleware/auth.middleware";

export default createAdminRouter({ verifyTokenMiddleware, requireAdmin });
