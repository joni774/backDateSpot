import { env } from "../config/env";

/** Send generated password to user email. Uses SendGrid when configured, else logs in dev. */
export async function sendPasswordEmail(
  email: string,
  password: string
): Promise<void> {
  if (env.SENDGRID_API_KEY) {
    // SendGrid integration placeholder for production (prompt 4.1+)
    console.log("[DateSpot] SendGrid configured — email delivery pending full integration");
    console.log(`  To: ${email}`);
    return;
  }

  console.log("[DateSpot] Password email (dev stub)");
  console.log(`  To: ${email}`);
  console.log(`  Password: ${password}`);
}
