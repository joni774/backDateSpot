import { createAuthRouter } from "@datespot/auth-logic";
import { env } from "../config/env";

const authRoutes = createAuthRouter({
  jwtSecret: env.JWT_SECRET,
  sendgridApiKey: env.SENDGRID_API_KEY,
  sendgridFromEmail: env.SENDGRID_FROM_EMAIL,
  twilioAccountSid: env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: env.TWILIO_AUTH_TOKEN,
  twilioFromNumber: env.TWILIO_FROM_NUMBER,
  stripeSecretKey: env.STRIPE_SECRET_KEY,
});

export default authRoutes;
