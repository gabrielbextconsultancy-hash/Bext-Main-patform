#!/usr/bin/env node
/**
 * Creates the folders the meeting workflow files into, inside the SharePoint
 * structure BEXT already has.
 *
 *   node graph/provision-sharepoint.js          create anything missing
 *   node graph/provision-sharepoint.js --dry    report what would be created
 *
 * Deliberately additive. The tenant already carries a considered information
 * architecture — four sites (BEXTHQ, CommercialManagement, CRM,
 * ProgramManagement) and an eleven-gate project structure under each client —
 * so this does not create a site or move anything. It adds three folders under
 * the existing BEXTHQ › API Automation Folder, beside the Meeting Recordings
 * folder that is already there:
 *
 *   Templates/            the company minutes template the workflow fills
 *   Meeting Transcripts/  raw Teams VTT, kept as the source record
 *   Meeting Minutes/      the generated documents, for review
 *
 * Site and drive ids are printed at the end for .env (SP_SITE_ID, SP_DRIVE_ID);
 * the meeting workflow addresses folders by path, so those ids are the only
 * configuration it needs.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;
const DRY = process.argv.includes('--dry');

const HOST = 'bextconsultancy.sharepoint.com';
const SITE = 'BEXTHQ';
const PARENT = 'API Automation Folder';
const FOLDERS = ['Templates', 'Meeting Transcripts', 'Meeting Minutes'];

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description?.split('\n')[0] || j.error);
  return j.access_token;
}

async function graph(t, pathname, init = {}) {
  const r = await fetch(GRAPH + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const body = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`${r.status} ${body.error?.code || ''} ${body.error?.message || ''}`.trim());
    e.status = r.status;
    throw e;
  }
  return body;
}

(async () => {
  const t = await token();

  const site = await graph(t, `/sites/${HOST}:/sites/${SITE}`);
  const drives = await graph(t, `/sites/${site.id}/drives`);
  const drive = drives.value.find(d => d.name === 'Documents') || drives.value[0];
  console.log(`site  ${SITE} — ${site.webUrl}`);
  console.log(`drive ${drive.name}\n`);

  for (const name of FOLDERS) {
    const full = `${PARENT}/${name}`;
    try {
      await graph(t, `/drives/${drive.id}/root:/${encodeURI(full)}`);
      console.log(`  exists   ${full}`);
      continue;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (DRY) {
      console.log(`  would create ${full}`);
      continue;
    }
    await graph(t, `/drives/${drive.id}/root:/${encodeURI(PARENT)}:/children`, {
      method: 'POST',
      // Never overwrite: if a folder of this name appears between the check and
      // the create, keep theirs rather than replacing it.
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    });
    console.log(`  created  ${full}`);
  }

  console.log('\nAdd to .env:');
  console.log(`SP_SITE_ID=${site.id}`);
  console.log(`SP_DRIVE_ID=${drive.id}`);
})().catch(e => {
  console.error('Failed:', e.message);
  process.exitCode = 1;
});
