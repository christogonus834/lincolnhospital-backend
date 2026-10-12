# Sterling Specialist Hospital — API

Express + Supabase backend: public booking API, admin API, and Brevo email alerts to doctors.

## Setup
1. Supabase SQL editor: run `server/db/schema.sql` (new project) **or** `server/db/migrations/003_upgrade_to_hospital_only.sql` (existing Sterling Group database — back up first, it deletes Lakeview data).
2. Optional: run `server/db/migrations/002_seed_board_members.sql`. Existing database? Also run `server/db/migrations/004_add_hero_content.sql` so the home page headline and intro become editable, and `server/db/migrations/005_hero_slides.sql` for the hero photo slider (Admin > Hero Slides), and `server/db/migrations/006_patient_notified.sql` for patient confirmation emails.
3. Copy `.env.example` to `.env` and fill it in (see below).
4. `npm install`, then `npm run seed` once (creates the admin, departments, doctors), then `npm start`.

## Doctor email alerts (Brevo)
1. Brevo > Senders, Domains & Dedicated IPs: verify the sender address (ideally authenticate your domain with SPF/DKIM so mail doesn't land in spam).
2. Brevo > SMTP & API > API Keys: create a key -> `BREVO_API_KEY`. Put the verified sender in `MAIL_FROM_EMAIL`.
3. Admin > Doctors: add each doctor's email. Doctors without one are flagged, and the admin gets a notification when an alert can't be sent.

When a patient books, the slot is saved first, then the doctor is emailed. A mail failure never cancels the booking.

## Security built in
Session store in Supabase; production refuses to boot with a weak/missing `SESSION_SECRET` or `CLIENT_ORIGIN`; Origin check on all writes (CSRF); rate limits (login, bookings, whole API); security headers; server-side validation and field whitelists on every write; unique DB index prevents double-booking; doctor emails hidden from the public API and the anon key; image uploads verified by file signature; generic error messages (details only in server logs); no default admin password.

## Env vars
See `.env.example`. Never commit `.env`.

## Emails sent
- **Doctor:** every new booking (alert to the doctor's saved email, optional copy to `APPOINTMENT_CC_EMAIL`).
- **Patient:** when the front desk sets an appointment to **confirmed**, the patient is emailed the date, time and doctor. Optional env: `HOSPITAL_PHONE`, `HOSPITAL_ADDRESS`, `HOSPITAL_REPLY_TO`.
- Admin > Doctors has a **test email** button per doctor, and any failure shows Brevo's reason in Notifications.
