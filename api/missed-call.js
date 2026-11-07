// Called by the ElevenLabs voice agent at the end of every missed call.
// - Texts Mario who called and their message.
// - Texts the caller the intake form, only if they're a potential client who agreed.
//
// URL to put in the ElevenLabs webhook tool:
//   https://onpoint-send.vercel.app/api/missed-call?key=YOUR_APP_PASSCODE
//
// Body (JSON) sent by the agent:
//   {
//     "first_name": "Sarah",
//     "phone": "+17325550148",
//     "message": "Calling about an inspection next week",
//     "send_form": true
//   }
//
// Uses the same environment variables as /api/send, plus optional:
//   MISSED_CALL_TEMPLATE - custom wording. Placeholders: {name}, {business}, {link}
//   NOTIFY_NUMBER        - Mario's cell. He gets a text with the caller's name, number and message.

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

function prettyPhone(e164) {
  return e164 ? e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : "unknown number";
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return /^(true|yes|y|1)$/i.test(String(value).trim());
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

  const twilio = { sid: TWILIO_ACCOUNT_SID, token: TWILIO_AUTH_TOKEN, from: TWILIO_FROM_NUMBER };

  const rawName = String(body.first_name || body.name || "").trim();
  const firstName = rawName.split(/\s+/)[0] || "";
  const callerPhone = toE164(body.phone || body.phone_number);
  const callerMessage = String(body.message || "").trim().slice(0, 300);
  const sendForm = toBool(body.send_form, true);

  // 1) Text the caller the form (only potential clients who said yes).
  let formSent = false;
  let formError = null;

  if (sendForm) {
    if (!callerPhone) {
      formError = "bad_number";
    } else {
      const formText = (MISSED_CALL_TEMPLATE || DEFAULT_TEMPLATE)
        .replace(/\{name\}/g, firstName || "there")
        .replace(/\{business\}/g, BUSINESS_NAME || "us")
        .replace(/\{link\}/g, FORM_LINK);
      try {
        const result = await sendSms({ ...twilio, to: callerPhone, body: formText });
        formSent = result.ok;
        if (!result.ok) formError = "send_failed";
      } catch {
        formError = "send_failed";
      }
    }
  }

  // 2) Text Mario who called and why.
  const notifyTo = toE164(NOTIFY_NUMBER);
  if (notifyTo) {
    const who = `${firstName || "Caller"} ${prettyPhone(callerPhone)}`;
    const lines = [`Missed call: ${who}`];
    if (callerMessage) lines.push(`Message: "${callerMessage}"`);
    if (formSent) lines.push("Form text sent.");
    const notifyText = lines.join("\n");
    await sendSms({ ...twilio, to: notifyTo, body: notifyText }).catch(() => {});
  }

  if (formError === "bad_number") {
    return res.status(200).json({
      ok: false,
      message: "That phone number didn't look right, so no form text was sent. Ask the caller to repeat their 10-digit number.",
    });
  }
  if (formError) {
    return res.status(200).json({
      ok: false,
      message: "The form text couldn't be sent, but Mario got their message. Let the caller know Mario will call them back.",
    });
  }

  return res.status(200).json({
    ok: true,
    message: formSent ? `Form text sent to ${firstName || "the caller"}, and Mario was notified.` : "Mario was notified.",
  });
};
