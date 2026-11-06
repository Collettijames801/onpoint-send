// Serverless function: sends the follow-up text through Twilio.
// Runs on Vercel at /api/send. No npm packages needed (uses built-in fetch, Node 18+).
//
// Environment variables (set these in Vercel → Project → Settings → Environment Variables):
//   TWILIO_ACCOUNT_SID   - from the Twilio console
//   TWILIO_AUTH_TOKEN    - from the Twilio console
//   TWILIO_FROM_NUMBER   - the Twilio number, e.g. +15555551234
//   FORM_LINK            - the client's form URL
//   BUSINESS_NAME        - e.g. "Smith Home Inspections"
//   APP_PASSCODE         - a passcode only the inspector knows (stops strangers using the button)
//   MESSAGE_TEMPLATE     - optional. Use {name}, {business}, {link} as placeholders.

const DEFAULT_TEMPLATE =
  "Hi {name}, thanks for booking your home inspection with {business}! " +
  "Please fill out this quick form before your appointment: {link} " +
  "Reply STOP to opt out.";

function toE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER,
    FORM_LINK,
    BUSINESS_NAME,
    APP_PASSCODE,
    MESSAGE_TEMPLATE,
  } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !FORM_LINK || !APP_PASSCODE) {
    return res.status(500).json({ error: "Server is missing settings. Check the environment variables." });
  }

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const { name, phone, passcode } = body;

  if (passcode !== APP_PASSCODE) {
    return res.status(401).json({ error: "Wrong passcode." });
  }

  const to = toE164(phone);
  if (!to) {
    return res.status(400).json({ error: "Enter a 10-digit US phone number." });
  }

  const firstName = String(name || "").trim().split(/\s+/)[0] || "there";
  const message = (MESSAGE_TEMPLATE || DEFAULT_TEMPLATE)
    .replace(/\{name\}/g, firstName)
    .replace(/\{business\}/g, BUSINESS_NAME || "us")
    .replace(/\{link\}/g, FORM_LINK);

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

  try {
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: message }),
      }
    );

    const data = await twilioRes.json();

    if (!twilioRes.ok) {
      return res.status(502).json({ error: data.message || "Twilio rejected the message." });
    }

    return res.status(200).json({ ok: true, to, sid: data.sid });
  } catch (err) {
    return res.status(502).json({ error: "Could not reach Twilio. Try again." });
  }
};
