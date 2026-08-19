import type { SubscriptionTier } from "@datespot/database";

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
