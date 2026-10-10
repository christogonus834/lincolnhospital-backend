-- =========================================================
-- MIGRATION: make the home page top section (photo, headline, intro)
-- editable from Admin > Page content. Safe to re-run.
-- Leave image_url empty to keep the built-in photo until you upload one.
-- =========================================================
insert into site_content (id, division, placement, title, body, image_url, sort_order)
values (
  'hospital_hero', 'hospital', 'fixed',
  'Healthcare excellence, delivered with heart.',
  'A multispecialty hospital in Borikiri, Port Harcourt, with 19 consultants across obstetrics, surgery, paediatrics, nephrology and more, plus a 24-hour intensive care unit.',
  null, 0
)
on conflict (id) do nothing;
