-- =========================================================
-- MIGRATION: remember when the patient was emailed their confirmation.
-- Safe to re-run.
-- =========================================================
alter table appointments add column if not exists patient_notified_at timestamptz;
