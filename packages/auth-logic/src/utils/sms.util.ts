export interface SmsConfig {
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  /** E.164 sender number, e.g. "+15017122661", or an approved Messaging Service SID. */
  twilioFromNumber?: string;
}

export function createSmsSender(config: SmsConfig) {
  const isConfigured = Boolean(
    config.twilioAccountSid && config.twilioAuthToken && config.twilioFromNumber
  );

  async function sendOtpSms(phone: string, code: string): Promise<void> {
    if (!isConfigured) {
      console.log(`[DateSpot OTP] SMS provider not configured — phone=${phone} code=${code}`);
      return;
    }

    const body = `DateSpot: קוד האימות שלך הוא ${code}. תקף ל-10 דקות.`;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;
    const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: phone,
        From: config.twilioFromNumber!,
        Body: body,
      }).toString(),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Twilio SMS failed (${res.status}): ${detail}`);
    }
  }

  return { sendOtpSms, isSmsConfigured: isConfigured };
}
