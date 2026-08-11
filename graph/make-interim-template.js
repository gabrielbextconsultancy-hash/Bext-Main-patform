#!/usr/bin/env node
/**
 * Builds a placeholder minutes template and uploads it to SharePoint.
 *
 *   node graph/make-interim-template.js
 *
 * A stand-in until the company template arrives, so the meeting pipeline can be
 * tested end to end rather than waiting on a document. It defines the
 * placeholder contract the workflow fills:
 *
 *   {subject} {date} {organiser} {attendees} {summary}
 *   {#decisions}{.}{/decisions}
 *   {#actions}{owner} {due} {task}{/actions}
 *   {#followups}{.}{/followups}
 *
 * When the real template replaces this file in SharePoint, keep those names and
 * nothing in the workflow changes. Any placeholder the template omits is simply
 * not rendered; any it adds renders empty until the extractor supplies it.
 *
 * The .docx is assembled directly rather than through a document library — a
 * Word file is a zip of XML, and one flat document needs no more than that.
 */
const path = require('path');
const PizZip = require(path.join(__dirname, '..', 'node_modules', 'pizzip'));
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;
const DEST = 'API Automation Folder/Templates/Minutes Template.docx';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = (text, { bold = false, size = 22, space = 120 } = {}) =>
  `<w:p><w:pPr><w:spacing w:after="${space}"/></w:pPr><w:r><w:rPr>` +
  `${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr>` +
  `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${p('MEETING MINUTES', { bold: true, size: 32, space: 240 })}
${p('{subject}', { bold: true, size: 26 })}
${p('Date: {date}')}
${p('Organiser: {organiser}')}
${p('Attendees: {attendees}', { space: 240 })}
${p('Summary', { bold: true, size: 24 })}
${p('{summary}', { space: 240 })}
${p('Decisions', { bold: true, size: 24 })}
${p('{#decisions}')}
${p('  •  {.}')}
${p('{/decisions}', { space: 240 })}
${p('Action items', { bold: true, size: 24 })}
${p('{#actions}')}
${p('  •  {task} — {owner} — due {due}')}
${p('{/actions}', { space: 240 })}
${p('Follow-ups', { bold: true, size: 24 })}
${p('{#followups}')}
${p('  •  {.}')}
${p('{/followups}', { space: 240 })}
${p('Generated automatically from the Teams transcript. Review before circulating.', { size: 18 })}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function buildDocx() {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels').file('.rels', ROOT_RELS);
  zip.folder('word').file('document.xml', DOCUMENT);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description?.split('\n')[0] || j.error);
  return j.access_token;
}

(async () => {
  const buf = buildDocx();
  console.log(`built ${buf.length} bytes`);

  const t = await token();
  const site = await (await fetch(
    'https://graph.microsoft.com/v1.0/sites/bextconsultancy.sharepoint.com:/sites/BEXTHQ',
    { headers: { Authorization: `Bearer ${t}` } })).json();
  const drives = await (await fetch(
    `https://graph.microsoft.com/v1.0/sites/${site.id}/drives`,
    { headers: { Authorization: `Bearer ${t}` } })).json();
  const drive = drives.value.find(d => d.name === 'Documents') || drives.value[0];

  // Replaces an existing interim template deliberately — this file is ours. The
  // company template will arrive under its own name and is not touched.
  const up = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${drive.id}/root:/${encodeURI(DEST)}:/content`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      body: buf,
    });
  const j = await up.json();
  if (!up.ok) throw new Error(`${up.status} ${JSON.stringify(j).slice(0, 200)}`);
  console.log(`uploaded ${DEST}`);
  console.log(j.webUrl);
})().catch(e => {
  console.error('Failed:', e.message);
  process.exitCode = 1;
});
