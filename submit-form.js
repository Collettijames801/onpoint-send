// Receives the online Inspection Request Form and texts the answers to Mario.
// Runs on Vercel at /api/submit-form. Uses the same Twilio settings as /api/send.
//
// Environment variables used:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
//   NOTIFY_NUMBER - Mario's cell; the form answers are texted here.

function clean(v, max) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || 120);
}

function toE164(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return null;
}

function prettyPhone(raw) {
  const e = toE164(raw);
  return e ? e.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3") : clean(raw, 30);
}

function joinParts(parts, sep) {
  return parts.filter(Boolean).join(sep || ", ");
}

const ALLOWED_REPORT_TO = ["Client", "Realtor", "Both"];
const ALLOWED_SERVICES = ["Home Inspection", "Radon Testing", "Termite / WDI", "Mold Testing", "Oil Tank Sweep"];

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, NOTIFY_NUMBER } = process.env;
  const notifyTo = toE164(NOTIFY_NUMBER);
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !notifyTo) {
    return res.status(500).json({ ok: false, error: "The form isn't set up yet. Please call 732-606-3761." });
  }

  let b = req.body || {};
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch { b = {}; }
  }

  // Spam trap: real people never fill this hidden field.
  if (clean(b.website)) {
    return res.status(200).json({ ok: true });
  }

  const reportTo = ALLOWED_REPORT_TO.includes(b.report_to) ? b.report_to : "";
  const name = clean(b.client_name, 80);
  const phone = toE164(b.client_phone);

  if (!reportTo || !name || !phone) {
    return res.status(400).json({ ok: false, error: "Please fill in who gets the report, your name, and your phone number." });
  }

  const services = (Array.isArray(b.services) ? b.services : [])
    .filter((s) => ALLOWED_SERVICES.includes(s));

  const clientAddr = joinParts([
    clean(b.client_street),
    clean(b.client_city, 60),
    joinParts([clean(b.client_state, 20), clean(b.client_zip, 10)], " "),
  ]);
  const propAddr = joinParts([
    clean(b.prop_street),
    clean(b.prop_city, 60),
    joinParts([clean(b.prop_state, 20), clean(b.prop_zip, 10)], " "),
  ]);
  const realtor = joinParts([
    clean(b.realtor_name, 80),
    b.realtor_phone ? prettyPhone(b.realtor_phone) : "",
    clean(b.realtor_email, 100),
  ], " | ");

  const lines = [
    "NEW INSPECTION REQUEST",
    `Send report to: ${reportTo}`,
    "",
    `CLIENT: ${joinParts([name, prettyPhone(b.client_phone), clean(b.client_email, 100)], " | ")}`,
    `Client address: ${clientAddr || "-"}`,
    "",
    `PROPERTY: ${propAddr || "-"}`,
    "",
    `REALTOR: ${realtor || "-"}`,
    "",
    `SERVICES: ${services.length ? services.join(", ") : "-"}`,
  ];
  const notes = clean(b.notes, 600);
  if (notes) lines.push("", `NOTES: ${notes}`);

  const body = lines.join("\n").slice(0, 1550);

  try {
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: notifyTo, From: TWILIO_FROM_NUMBER, Body: body }),
    });
    if (!r.ok) {
      return res.status(502).json({ ok: false, error: "Your form couldn't be sent. Please try again, or call 732-606-3761." });
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(502).json({ ok: false, error: "Your form couldn't be sent. Please try again, or call 732-606-3761." });
  }
};
