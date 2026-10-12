// server/utils/mailer.js
// Sends transactional email through Brevo's REST API (no extra npm package
// needed). Docs: https://developers.brevo.com/reference/sendtransacemail
//
// Required env:
//   BREVO_API_KEY       - Brevo > SMTP & API > API Keys (an "xkeysib-..." key)
//   MAIL_FROM_EMAIL     - a sender you've verified in Brevo (Senders & IP)
// Optional env:
//   MAIL_FROM_NAME       - the hospital's name in emails (default "Sterling Specialist Hospital")
//   APPOINTMENT_CC_EMAIL - e.g. reception@...; copied on every doctor alert
//   HOSPITAL_REPLY_TO    - where patient replies go (defaults to APPOINTMENT_CC_EMAIL)
//   HOSPITAL_PHONE / HOSPITAL_ADDRESS - shown in the patient's confirmation email

const https = require('https');

const hospitalName = () => process.env.MAIL_FROM_NAME || 'Sterling Specialist Hospital';

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
    if (!apiKey) return reject(new Error('BREVO_API_KEY is not set on the server.'));
    if (!process.env.MAIL_FROM_EMAIL) return reject(new Error('MAIL_FROM_EMAIL is not set on the server.'));

    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: 'api.brevo.com',
        port: 443,
        path: '/v3/smtp/email',
        method: 'POST',
        timeout: 10000,
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
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { return resolve(data ? JSON.parse(data) : {}); } catch (e) { return resolve({}); }
          }
          // Keep Brevo's own explanation so the admin can see what to fix.
          let reason = data.slice(0, 200);
          try { reason = JSON.parse(data).message || reason; } catch (e) { /* not JSON */ }
          reject(new Error(`Brevo ${res.statusCode}: ${reason}`));
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Brevo did not respond in time.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendMail({ to, toName, subject, html, text, replyTo, cc, tags }) {
  const payload = {
    sender: { name: hospitalName(), email: process.env.MAIL_FROM_EMAIL },
    to: [{ email: to, ...(toName ? { name: oneLine(toName) } : {}) }],
    subject: oneLine(subject).slice(0, 200),
    htmlContent: html,
    textContent: text,
    tags,
  };
  if (replyTo?.email) payload.replyTo = { email: replyTo.email, ...(replyTo.name ? { name: oneLine(replyTo.name) } : {}) };
  if (cc) payload.cc = [{ email: cc }];
  return brevoRequest(payload);
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

const row = (label, value) =>
  `<tr><td style="padding:8px 12px;color:#5b6b73;white-space:nowrap;vertical-align:top;">${esc(label)}</td>` +
  `<td style="padding:8px 12px;color:#12262f;">${value}</td></tr>`;

// ---------------------------------------------------------------------
// 1) Doctor is told a patient has booked them
// ---------------------------------------------------------------------
async function sendDoctorAppointmentAlert({ doctor, appointment }) {
  if (!doctor?.email) throw new Error('Doctor has no email address on file.');

  const when = `${formatDateLong(appointment.appointment_date)} at ${formatTime12(appointment.appointment_time)}`;
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
      Sent automatically by ${esc(hospitalName())}. This message contains patient information; please do not forward it.
    </p>
  </div>`;

  const text =
    `New appointment booked\n\nDoctor: ${doctor.full_name}\nWhen: ${when}\n` +
    `Patient: ${oneLine(appointment.patient_name)}\nEmail: ${oneLine(appointment.patient_email)}\n` +
    `Phone: ${oneLine(appointment.patient_phone || 'Not provided')}\nReason: ${oneLine(appointment.reason || 'Not provided')}\n` +
    `Status: Pending confirmation by the front desk\n`;

  const cc = (process.env.APPOINTMENT_CC_EMAIL || '').trim();
  return sendMail({
    to: doctor.email,
    toName: doctor.full_name,
    subject: `New appointment: ${appointment.patient_name} - ${when}`,
    html,
    text,
    // Replies go to the patient, so the doctor can respond directly if needed.
    replyTo: { email: appointment.patient_email, name: appointment.patient_name },
    cc: cc && cc.toLowerCase() !== doctor.email.toLowerCase() ? cc : undefined,
    tags: ['appointment-doctor-alert'],
  });
}

// ---------------------------------------------------------------------
// 2) Patient is told their appointment has been confirmed
// ---------------------------------------------------------------------
async function sendPatientConfirmation({ appointment, doctor }) {
  if (!appointment?.patient_email) throw new Error('Patient has no email address.');

  const name = hospitalName();
  const when = `${formatDateLong(appointment.appointment_date)} at ${formatTime12(appointment.appointment_time)}`;
  const phone = (process.env.HOSPITAL_PHONE || '').trim();
  const address = (process.env.HOSPITAL_ADDRESS || '').trim();
  const replyEmail = (process.env.HOSPITAL_REPLY_TO || process.env.APPOINTMENT_CC_EMAIL || '').trim();

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#12262f;">
    <h2 style="margin:0 0 6px;color:#163f52;">Your appointment is confirmed</h2>
    <p style="margin:0 0 18px;color:#5b6b73;">Hello ${esc(appointment.patient_name)}, ${esc(name)} has confirmed your appointment.</p>
    <table style="border-collapse:collapse;width:100%;background:#f4f8f7;border-radius:8px;">
      ${row('When', `<strong>${esc(when)}</strong>`)}
      ${doctor ? row('Doctor', esc(doctor.full_name) + (doctor.title ? `<br><span style="color:#5b6b73;font-size:13px;">${esc(doctor.title)}</span>` : '')) : ''}
      ${address ? row('Where', esc(address)) : ''}
      ${phone ? row('Questions', esc(phone)) : ''}
    </table>
    <p style="margin:18px 0 0;font-size:14px;color:#12262f;">
      Please arrive about 15 minutes early and bring a valid ID, your insurance or HMO card if you have one, and any earlier test results.
      If you can't make it, please contact us at least 24 hours ahead so someone else can use the slot.
    </p>
    <p style="margin:18px 0 0;font-size:12.5px;color:#8a979d;">Sent by ${esc(name)}.</p>
  </div>`;

  const text =
    `Your appointment is confirmed\n\nHello ${oneLine(appointment.patient_name)}, ${name} has confirmed your appointment.\n\n` +
    `When: ${when}\n${doctor ? `Doctor: ${doctor.full_name}\n` : ''}${address ? `Where: ${address}\n` : ''}${phone ? `Questions: ${phone}\n` : ''}\n` +
    `Please arrive about 15 minutes early with a valid ID and your insurance card if you have one.\n`;

  return sendMail({
    to: appointment.patient_email,
    toName: appointment.patient_name,
    subject: `Your appointment is confirmed - ${when}`,
    html,
    text,
    replyTo: replyEmail ? { email: replyEmail, name } : undefined,
    tags: ['appointment-patient-confirmed'],
  });
}

// ---------------------------------------------------------------------
// 3) Admin "Send test email" button (checks the Brevo setup end to end)
// ---------------------------------------------------------------------
async function sendTestEmail(to) {
  const name = hospitalName();
  return sendMail({
    to,
    subject: `Test email from ${name}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px"><h3 style="color:#163f52">Email is working</h3><p>This is a test message from the ${esc(name)} admin panel. If you can read it, booking alerts will reach this address.</p></div>`,
    text: `Email is working. This is a test message from the ${name} admin panel.`,
    tags: ['admin-test'],
  });
}

module.exports = { sendDoctorAppointmentAlert, sendPatientConfirmation, sendTestEmail, esc };
