// Called by the ElevenLabs voice agent after a missed call.
// Texts the caller the intake form, and (optionally) texts Mario who called.
//
// URL to put in the ElevenLabs webhook tool:
//   https://onpoint-send.vercel.app/api/missed-call?key=YOUR_APP_PASSCODE
//
// Body (JSON) sent by the agent:
//   { "first_name": "Sarah", "phone": "+17325550148" }
//
// Uses the same environment variables as /api/send, plus optional:
//   MISSED_CALL_TEMPLATE - custom wording. Placeholders: {name}, {business}, {link}
//   NOTIFY_NUMBER        - Mario's cell. If set, he gets a text with the caller's name and number.

const DEFAULT_TEMPLATE =
  "Hi {name}, thanks for calling {business}! Mario is on a job and will call you back shortly. " +
  "In the meantime, please fill out this quick form: {link} " +
  "Reply STOP to opt out.";

function toE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

async function sendSms({ sid, token, from, to, body }) {
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER,
    FORM_LINK,
    BUSINESS_NAME,
    APP_PASSCODE,
    MISSED_CALL_TEMPLATE,
    NOTIFY_NUMBER,
  } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !FORM_LINK || !APP_PASSCODE) {
    return res.status(500).json({ ok: false, message: "Server is missing settings." });
  }

  const key = (req.query && req.query.key) || req.headers["x-passcode"];
  if (key !== APP_PASSCODE) {
    return res.status(401).json({ ok: false, message: "Unauthorized." });
  }

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const rawName = body.first_name || body.name || "";
  const firstName = String(rawName).trim().split(/\s+/)[0] || "there";
  const to = toE164(body.phone || body.phone_number);

  if (!to) {
    return res.status(200).json({
      ok: false,
      message: "That phone number didn't look right, so no text was sent. Ask the caller to repeat their 10-digit number.",
    });
  }

  const message = (MISSED_CALL_TEMPLATE || DEFAULT_TEMPLATE)
    .replace(/\{name\}/g, firstName)
    .replace(/\{business\}/g, BUSINESS_NAME || "us")
    .replace(/\{link\}/g, FORM_LINK);

  try {
    const result = await sendSms({
      sid: TWILIO_ACCOUNT_SID,
      token: TWILIO_AUTH_TOKEN,
      from: TWILIO_FROM_NUMBER,
      to,
      body: message,
    });

    if (!result.ok) {
      return res.status(200).json({
        ok: false,
        message: "The text couldn't be sent. Let the caller know Mario will call them back.",
        error: result.data && result.data.message,
      });
    }

    const notifyTo = toE164(NOTIFY_NUMBER);
    if (notifyTo) {
      const pretty = to.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");
      await sendSms({
        sid: TWILIO_ACCOUNT_SID,
        token: TWILIO_AUTH_TOKEN,
        from: TWILIO_FROM_NUMBER,
        to: notifyTo,
        body: `Missed call: ${firstName === "there" ? "Caller" : firstName} ${pretty}. Form text sent. Call them back when you can.`,
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, message: `Form text sent to ${firstName}.` });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      message: "The text couldn't be sent. Let the caller know Mario will call them back.",
    });
  }
};
