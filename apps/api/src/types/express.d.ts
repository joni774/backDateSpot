// Extend Express Request with authenticated user payload from JWT.

import type { SubscriptionTier } from "@datespot/shared-types";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        isAdmin: boolean;
        subscriptionTier?: SubscriptionTier;
      };
    }
  }
}

export {};
