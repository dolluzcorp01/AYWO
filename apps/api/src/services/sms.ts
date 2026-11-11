import { config, isProduction } from '../config.ts';

/** SMS for OTP and alerts. Choose the provider with SMS_PROVIDER. 'console' only prints, and never in production. */
export async function sendSms(phone: string, text: string, otp?: string): Promise<void> {
  if (config.SMS_PROVIDER === 'console') {
    if (isProduction) throw new Error('SMS_PROVIDER=console is not allowed in production');
    console.info(`[sms to ${phone}] ${text}`);
    return;
  }

  if (config.SMS_PROVIDER === 'msg91') {
    const response = otp
      ? await fetch('https://control.msg91.com/api/v5/otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', authkey: config.MSG91_AUTH_KEY },
          body: JSON.stringify({ template_id: config.MSG91_TEMPLATE_ID, mobile: phone.replace('+', ''), otp }),
          signal: AbortSignal.timeout(15_000),
        })
      : await fetch('https://control.msg91.com/api/v5/flow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', authkey: config.MSG91_AUTH_KEY },
          body: JSON.stringify({ template_id: config.MSG91_TEMPLATE_ID, recipients: [{ mobiles: phone.replace('+', ''), text }] }),
          signal: AbortSignal.timeout(15_000),
        });
    if (!response.ok) throw new Error(`msg91 failed: ${response.status}`);
    return;
  }

  const auth = Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, From: config.TWILIO_FROM, Body: text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`twilio failed: ${response.status}`);
}
