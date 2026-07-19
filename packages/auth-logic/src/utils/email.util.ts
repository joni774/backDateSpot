export interface EmailConfig {
  sendgridApiKey?: string;
  sendgridFromEmail?: string;
}

export function createEmailSender(config: EmailConfig) {
  async function sendPasswordEmail(email: string, password: string): Promise<void> {
    await sendEmail(
      email,
      "ברוכים הבאים ל-DateSpot — הסיסמה שלך",
      `שלום!\n\nנרשמת בהצלחה ל-DateSpot.\nהסיסמה הזמנית שלך: ${password}\n\nהתחבר/י עם האימייל והסיסמה, ומומלץ לשנות את הסיסמה אחרי הכניסה הראשונה.`,
      `<p>שלום!</p><p>נרשמת בהצלחה ל-DateSpot.</p><p>הסיסמה הזמנית שלך: <strong>${password}</strong></p><p>התחבר/י עם האימייל והסיסמה, ומומלץ לשנות את הסיסמה אחרי הכניסה הראשונה.</p>`
    );
  }

  async function sendPasswordResetEmail(email: string, resetLink: string): Promise<void> {
    await sendEmail(
      email,
      "Reset your DateSpot password",
      `Reset your password using this link:\n${resetLink}\n\nLink expires in 1 hour.`,
      `<p>Reset your password using this link:</p><p><a href="${resetLink}">${resetLink}</a></p><p>Link expires in 1 hour.</p>`
    );
  }

  async function sendEmail(
    to: string,
    subject: string,
    text: string,
    html: string
  ): Promise<void> {
    if (config.sendgridApiKey) {
      const sgMail = await import("@sendgrid/mail");
      sgMail.default.setApiKey(config.sendgridApiKey);
      await sgMail.default.send({
        to,
        from: config.sendgridFromEmail ?? "noreply@datespot.app",
        subject,
        text,
        html,
      });
      return;
    }

    console.log(`[DateSpot] Email (dev stub): ${subject}`);
    console.log(`  To: ${to}`);
    console.log(`  Body: ${text}`);
  }

  return { sendPasswordEmail, sendPasswordResetEmail };
}
