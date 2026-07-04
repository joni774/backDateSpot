export interface EmailConfig {
  sendgridApiKey?: string;
  sendgridFromEmail?: string;
}

export function createEmailSender(config: EmailConfig) {
  async function sendPasswordEmail(email: string, password: string): Promise<void> {
    if (config.sendgridApiKey) {
      const sgMail = await import("@sendgrid/mail");
      sgMail.default.setApiKey(config.sendgridApiKey);
      await sgMail.default.send({
        to: email,
        from: config.sendgridFromEmail ?? "noreply@datespot.app",
        subject: "Your DateSpot password",
        text: `Welcome to DateSpot!\n\nYour temporary password is: ${password}\n\nPlease change it after your first login.`,
        html: `<p>Welcome to DateSpot!</p><p>Your temporary password is: <strong>${password}</strong></p><p>Please change it after your first login.</p>`,
      });
      return;
    }

    console.log("[DateSpot] Password email (dev stub)");
    console.log(`  To: ${email}`);
    console.log(`  Password: ${password}`);
  }

  return { sendPasswordEmail };
}
