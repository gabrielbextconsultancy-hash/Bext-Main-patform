-- 008 — Microsoft Graph app registration completed and verified (11 Aug 2026).
-- App "BEXT Automation (Dev)" on tenant bextconsultancy.com.au
-- (9eb458d1-317d-4aae-a9a3-bb68e430d701), client b72d1df4-06ec-4390-937a-1293f34d31be,
-- admin account Admin.bext-automation@bextconsultancy.com.au.
-- graph/verify.js: all 4 checks pass (token, User.Read.All, Mail.Send, Sites.ReadWrite.All).

UPDATE deliverables SET status = 'done', completed_at = now(),
  evidence_url = 'graph/app-registration.md',
  description = 'App "BEXT Automation (Dev)" registered 7 Aug on the bextconsultancy.com.au '
                'tenant; secret current; admin consent granted.'
WHERE title = 'Azure App Registration';

UPDATE deliverables SET status = 'done', completed_at = now(),
  evidence_url = 'graph/verify.js',
  description = 'All four verify.js checks pass: token, User.Read.All, Mail.Send, '
                'Sites.ReadWrite.All (8 SharePoint sites visible). Credentials in .env.'
WHERE title = 'Microsoft Graph credential';
