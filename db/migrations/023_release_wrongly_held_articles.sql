-- Undo most of migration 022. It blocked far more than it should have.
--
-- 022 set report_eligible = false for every undated article from four sources in
-- the window where a parser fix unlocked the Clean Energy Council archive. The
-- intent was to keep 2022 and 2023 material out of the client's sheet. The effect
-- was to block those sources entirely for that day: of thirty articles that
-- scored 40 or above, twenty-five were held back, and the 24 Aug report went out
-- with three items instead of roughly twenty-eight.
--
-- What it blocked was not archive:
--
--   90  New inverter standard to improve grid stability
--   88  New solar installer and designer accreditation provider
--   88  Approved PV modules changeover is coming to meet new standards
--   85  Victoria's gas connection ban in new homes
--   82  Network tariff reform
--   80  The Embedded Networks Review
--
-- That is the centre of what this client pays to know about, and the guard was
-- indiscriminate: it keyed on "undated and from one of these sources", which
-- describes almost everything those sources publish, rather than on age.
--
-- Of the 56, none carried a recoverable publication date, so age has to be read
-- from the only place it survives — a past year written into the headline. Four
-- match. Those stay blocked; the other 52 are released.
--
-- The general lesson: a guard against bad data must be narrower than the data it
-- is guarding against, or it becomes the larger fault. This one cost a client
-- report.

BEGIN;

UPDATE articles a
   SET report_eligible = true
 WHERE NOT a.report_eligible
   -- Keep blocked only where the headline names a year that has passed.
   AND a.title !~* '\m(20(1[0-9]|2[0-4]))\M';

COMMIT;
