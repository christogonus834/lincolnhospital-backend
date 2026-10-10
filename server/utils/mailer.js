// server/utils/mailer.js
// Sends transactional email through Brevo's REST API (no extra npm package
// needed). Docs: https://developers.brevo.com/reference/sendtransacemail
//
// Required env:
//   BREVO_API_KEY       - Brevo > SMTP & API > API Keys (an "xkeysib-..." key)
//   MAIL_FROM_EMAIL     - a sender you've verified in Brevo (Senders & IP)
// Optional env:
//   MAIL_FROM_NAME      - defaults to "Sterling Specialist Hospital"
//   APPOINTMENT_CC_EMAIL- e.g. reception@...; copied on every doctor alert

const https = require('https');

const FROM_NAME = () => process.env.MAIL_FROM_NAME || 'Sterling Specialist Hospital';

// Escape anything that came from a patient before putting it in HTML.
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Strip CR/LF so a patient-supplied value can never inject mail headers.
const oneLine = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

function brevoRequest(payload) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return reject(new Error('BREVO_API_KEY is not configured.'));

    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: 'api.brevo.com',
        port: 443,
        path: '/v3/smtp/email',
        method: 'POST',
        timeout: 8000,
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data ? JSON.parse(data) : {});
          // Log Brevo's reason server-side; never forward it to the browser.
          reject(new Error(`Brevo responded ${res.statusCode}: ${data.slice(0, 300)}`));
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Brevo request timed out.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function formatDateLong(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function formatTime12(t) {
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

// Email the doctor that a patient has booked them.
async function sendDoctorAppointmentAlert({ doctor, appointment }) {
  if (!doctor?.email) throw new Error('Doctor has no email address on file.');

  const when = `${formatDateLong(appointment.appointment_date)} at ${formatTime12(appointment.appointment_time)}`;
  const row = (label, value) =>
    `<tr><td style="padding:8px 12px;color:#5b6b73;white-space:nowrap;vertical-align:top;">${esc(label)}</td>` +
    `<td style="padding:8px 12px;color:#12262f;">${value}</td></tr>`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#12262f;">
    <h2 style="margin:0 0 6px;color:#163f52;">New appointment booked</h2>
    <p style="margin:0 0 18px;color:#5b6b73;">Hello ${esc(doctor.full_name)}, a patient has booked a slot with you.</p>
    <table style="border-collapse:collapse;width:100%;background:#f4f8f7;border-radius:8px;">
      ${row('When', `<strong>${esc(when)}</strong>`)}
      ${row('Patient', esc(appointment.patient_name))}
      ${row('Email', esc(appointment.patient_email))}
      ${row('Phone', esc(appointment.patient_phone || 'Not provided'))}
      ${row('Reason', esc(appointment.reason || 'Not provided'))}
      ${row('Status', 'Pending confirmation by the front desk')}
    </table>
    <p style="margin:18px 0 0;font-size:12.5px;color:#8a979d;">
      Sent automatically by Sterling Specialist Hospital. This message contains patient information; please do not forward it.
    </p>
  </div>`;

  const text =
    `New appointment booked\n\nDoctor: ${doctor.full_name}\nWhen: ${when}\n` +
    `Patient: ${oneLine(appointment.patient_name)}\nEmail: ${oneLine(appointment.patient_email)}\n` +
    `Phone: ${oneLine(appointment.patient_phone || 'Not provided')}\nReason: ${oneLine(appointment.reason || 'Not provided')}\n` +
    `Status: Pending confirmation by the front desk\n`;

  const payload = {
    sender: { name: FROM_NAME(), email: process.env.MAIL_FROM_EMAIL },
    to: [{ email: doctor.email, name: oneLine(doctor.full_name) }],
    subject: oneLine(`New appointment: ${appointment.patient_name} - ${when}`).slice(0, 200),
    htmlContent: html,
    textContent: text,
    // Replies go to the patient, so the doctor can respond directly if needed.
    replyTo: { email: appointment.patient_email, name: oneLine(appointment.patient_name) },
    tags: ['appointment-doctor-alert'],
  };

  if (!process.env.MAIL_FROM_EMAIL) throw new Error('MAIL_FROM_EMAIL is not configured.');

  const cc = (process.env.APPOINTMENT_CC_EMAIL || '').trim();
  if (cc && cc.toLowerCase() !== doctor.email.toLowerCase()) payload.cc = [{ email: cc }];

  return brevoRequest(payload);
}

module.exports = { sendDoctorAppointmentAlert, esc };
