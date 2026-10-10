-- =========================================================
-- SEED: Board of Directors (run once, after schema.sql)
-- Safe to re-run: only inserts when the table is empty.
-- =========================================================

-- Seed with the 9 members already published on /board, so switching this
-- page over to admin-managed content doesn't blank it out. Photos point at
-- the existing static files already shipped in the frontend's /images/board
-- folder — any new/edited member's photo will instead get a real Supabase
-- Storage URL once uploaded through the admin panel.
--
-- Guarded by "only if the table is still empty" so this migration is safe
-- to run more than once without creating duplicate rows.
insert into board_members (full_name, role, bio, photo_url, sort_order)
select * from (values
  ('Nyengidiki Tamunomie Kennedy',
   'Chairman, Board of Directors',
   'Fellow of the West African and International College of Surgeons, and holds a Professor of Gynaecology and Obstetrics Chair from the University of Port Harcourt. Sub-speciality interest in Gynaecological Oncology and Minimal Access Surgery. Foundation Medical Director of Sterling Group of Hospitals for the past 14 years, and originator of the personalised quality health care delivery concept that forms part of Sterling Hospital''s mission statement.',
   '/images/board/nyengidiki-kennedy.jpeg', 0),
  ('Ibiye Laurel Nyengidiki',
   'Vice Chairman & Administrative Director',
   'Holds a Bachelor''s degree in Banking and Finance and a Master''s degree in Human Resource Management from Rivers State University. Member of the Board of Iwoma Community Bank, and currently the Administrative Director of Sterling Hospitals.',
   '/images/board/ibiye-nyengidiki.png', 1),
  ('Tobin Derefaka',
   'Financial Secretary',
   'Holds a Master''s degree in Forensic Accounting from the University of South Wales, London, and is a UNESCO-IHE certified Waste Management Expert. Former CEO / Acting General Manager of Wetland Health Maintenance Organization, and current Managing Director of DATT Technical Service Limited.',
   '/images/board/tobin-derefaka.jpeg', 2),
  ('Barrister Tamuno-opubo, Tamsy Minainyo',
   'Secretary & Legal Representative',
   'Holds a law degree from the University of Jos. Chief Counsel and Senior Partner at Watergate Solicitors, Port Harcourt, and a member of the Chartered Institute of Arbitrators of London and the International Bar Association.',
   '/images/board/tamuno-opubo.jpeg', 3),
  ('Ugochukwu C. Ihedioha',
   'Lead Laparoscopic Surgeon, Sterling Group',
   'Consultant Laparoscopic Colorectal Surgeon based at Northampton General Hospital, United Kingdom. Fellow of the Royal College of Surgeons with JAG accreditation in Colonoscopy, and holds an MD from the University of Leicester, plus a Post-CCT Fellowship in Colorectal Surgery from Guy''s and St Thomas'' Hospital.',
   '/images/board/ugochukwu-ihedioha.jpeg', 4),
  ('Uchenna Ajoku',
   'Lead Neurosurgeon, Sterling Group',
   'Consultant Brain and Spine Surgeon and Fellow of the West African College of Surgery / World Federation of Neurosurgical Societies (Paediatric Neurosurgery), Universitatsklinikum Tubingen, Germany. Former WFNS Skull Base / Cerebrovascular Fellow at P. D. Hinduja National Hospital, Mumbai, India, and currently a Clinical Spine Fellow at the Max Rady College of Medicine, University of Manitoba, Canada.',
   '/images/board/uchenna-ajoku.png', 5),
  ('Allagoa Dennis Oju',
   'Board Member',
   'Consultant Obstetrician and Gynaecologist, Laparoscopic Surgeon, and Assisted Reproductive Technologist Specialist. Fellow of the West African / International College of Surgeons and Chief Medical Director / Governing Board member of Federal Medical Centre, Yenagoa. Holds a Diploma in Health System Management from Galilee International Management Institute, an affiliate of the University of Haifa, Israel.',
   '/images/board/allagoa-dennis-oju.png', 6),
  ('Abere Sunday Derefeka',
   'Board Member',
   'Structural Civil Engineer holding a Master''s degree from the University of Lagos. Member of the Nigerian Society of Engineers and registered with the Council for the Regulation of Engineering in Nigeria (COREN). Presently Managing Director of Maas Central Hotels Limited and a Board member of Iwoama Micro Finance Bank Limited.',
   '/images/board/abere-derefeka.png', 7),
  ('Igbiks Ibisiki',
   'Board Member',
   'Geologist with a Master''s degree in Oil and Gas Engineering from Robert Gordon University, Aberdeen, United Kingdom. Worked as a Reservoir Engineer with Shell (SPDC) until 2010. Currently MD/CEO of Solidago Construction Limited, a civil and real estate development company operating across the country.',
   '/images/board/igbiks-ibisiki.png', 8)
) as seed_data
where not exists (select 1 from board_members);
