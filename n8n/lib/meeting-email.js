/**
 * The follow-up email for a processed meeting, in the client's own format.
 *
 * Shared by graph/run-meeting-once.js and the Meeting Intake Code node, which is
 * why it is a pure function: it returns the message and sends nothing. The
 * transport differs between the two callers (fetch vs this.helpers.httpRequest)
 * and the attachment is fetched by them, not here.
 *
 * The shape is the client's worked example, not our invention:
 *
 *   [Morning/Afternoon/Evening] All,
 *   Please see attached minutes following recent meeting {subject} {date}.
 *   A quick summary below for reference.
 *   Highlights            one bullet per project, prose
 *   Closed in today's meeting
 *   Remaining open actions grouped by organisation, then by owner
 *
 * This file is inlined into a template literal by n8n/build-workflows.js. Single
 * quotes and concatenation only — not because interpolation would corrupt it
 * (it would not; see docs/REGRESSIONS.md R005b) but because the surrounding
 * files are written that way and mixing styles here invites the wrong fix later.
 */

// Outlook drops enormous bodies and the useful content is the summary, not the
// tail of a long action list. Bound the parts that can grow without limit.
const SUMMARY_MAX = 1500;
const BULLET_MAX = 400;
const ACTIONS_PER_OWNER = 6;

const esc = s => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const clip = (s, n) => {
  const t = String(s === null || s === undefined ? '' : s).trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+$/, '') + '…' : t;
};

const isClosed = x =>
  x.closed === true || /closed|complete|done/i.test(String(x.status || ''));

/**
 * Morning before noon, Afternoon to 17:00, Evening after. Computed in the
 * meeting's own timezone: a 9am Melbourne meeting is a morning meeting even when
 * the pipeline processes it from another timezone hours later.
 */
const greeting = (startIso, timeZone) => {
  const d = startIso ? new Date(startIso) : new Date();
  if (isNaN(d.getTime())) return 'Morning';
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat('en-AU', {
      timeZone: timeZone || 'Australia/Melbourne', hour: 'numeric', hour12: false,
    }).format(d));
  } catch (e) { hour = d.getHours(); }
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
};

const longDate = (startIso, timeZone) => {
  const d = startIso ? new Date(startIso) : new Date();
  if (isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: timeZone || 'Australia/Melbourne',
      day: 'numeric', month: 'long', year: 'numeric',
    }).format(d);
  } catch (e) { return d.toISOString().slice(0, 10); }
};

/**
 * Which organisation an action's owner belongs to.
 *
 * participants is [{ name, organisation, email }] from the participants table —
 * the authoritative mapping, because a person's employer is not derivable from a
 * transcript. The domain fallback covers someone who has not been seeded yet;
 * a personal address falls through to "Other", which is visibly wrong in the
 * email and therefore gets fixed, rather than being silently mis-filed.
 */
const orgFor = (owner, participants, domainMap) => {
  const name = String(owner || '').trim();
  if (!name || /^unassigned$/i.test(name)) return 'Unassigned';

  const lower = name.toLowerCase();
  for (const p of (participants || [])) {
    // participants.company is the column; organisation is accepted so a caller
    // can pass a plain object without renaming.
    const org = p.company || p.organisation;
    const names = [p.name].concat(p.aliases || []).map(n => String(n || '').toLowerCase()).filter(Boolean);
    const hit = names.some(pn => pn === lower || pn.split(' ')[0] === lower.split(' ')[0]);
    if (!hit) continue;
    if (org) return org;
    const dom = String(p.email || '').split('@')[1];
    if (dom && domainMap && domainMap[dom]) return domainMap[dom];
  }
  const dom = String(name).indexOf('@') > -1 ? name.split('@')[1] : '';
  if (dom && domainMap && domainMap[dom]) return domainMap[dom];
  return 'Other';
};

/**
 * m = {
 *   subject, date, startIso, timeZone,
 *   summary, decisions: [string],
 *   projects: [{ project, status, highlight, update, next_action }],
 *   safety:  [{ item, status }],
 *   finance: [{ item, status }],
 *   actions: [{ title, owner, due, status, closed }],
 *   participants: [{ name, organisation, email }],
 *   domainMap: { 'racv.com.au': 'RACV' },
 *   urls: { folder, minutes },
 * }
 *
 * Returns { subject, html, text, sections } — sections is exposed so a caller can
 * assert on the parts without re-parsing HTML.
 */
const buildMeetingEmail = m => {
  const tz = m.timeZone || 'Australia/Melbourne';
  const when = longDate(m.startIso, tz);
  const hello = greeting(m.startIso, tz);

  // ── Highlights — one line per project ──────────────────────────────────────
  // Prefer the model's prose. Fall back to assembling something honest from the
  // structured fields rather than dropping the project silently.
  const highlights = (m.projects || []).map(p => {
    const name = clip(p.project || 'Project', 80);
    let body = p.highlight || p.update || '';
    if (!body && p.next_action) body = 'Next: ' + p.next_action;
    if (!body) body = p.status || '';
    else if (p.status && !new RegExp(p.status, 'i').test(body)) body = body + ' (' + p.status + ')';
    return { project: name, text: clip(body, BULLET_MAX) };
  }).filter(h => h.text);

  // ── Closed in today's meeting ──────────────────────────────────────────────
  // Decisions are the explicit ones; anything that moved to Closed counts too.
  // A decision and the action it closed are usually the same thing said twice.
  // Dedupe on a loose key so the reader sees one line, not an echo.
  const closedSeen = {};
  const closed = []
    .concat(m.decisions || [])
    .concat((m.actions || []).filter(isClosed).map(a => a.title))
    .concat((m.safety || []).filter(isClosed).map(s => s.item))
    .concat((m.finance || []).filter(isClosed).map(f => f.item))
    .map(s => clip(s, BULLET_MAX))
    .filter(Boolean)
    .filter(s => {
      // Drop leading articles and trailing bookkeeping words so "the baseline
      // programme" and "Baseline programme sign-off" collapse to one line.
      const key = s.toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/^(the|a|an) /, '')
        .replace(/ (sign off|signoff|confirmed|complete|completed|done|closed)$/, '')
        .trim();
      if (!key || closedSeen[key]) return false;
      // also catch one being a prefix of the other ("baseline programme" vs
      // "baseline programme sign-off")
      for (const seen in closedSeen) {
        if (seen.indexOf(key) === 0 || key.indexOf(seen) === 0) return false;
      }
      closedSeen[key] = true;
      return true;
    });

  // ── Remaining open actions, by organisation then owner ────────────────────
  const open = (m.actions || []).filter(a => !isClosed(a));
  const byOrg = {};
  for (const a of open) {
    const org = orgFor(a.owner, m.participants, m.domainMap);
    const owner = String(a.owner || 'Unassigned').trim() || 'Unassigned';
    byOrg[org] = byOrg[org] || {};
    byOrg[org][owner] = byOrg[org][owner] || [];
    if (byOrg[org][owner].length < ACTIONS_PER_OWNER) {
      const due = a.due ? ' (due ' + a.due + ')' : '';
      byOrg[org][owner].push(clip(a.title, BULLET_MAX) + due);
    }
  }
  // Unassigned last: it is a prompt to the reader, not a section they own.
  const orgNames = Object.keys(byOrg).sort((x, y) => {
    const rank = n => (n === 'Unassigned' ? 2 : n === 'Other' ? 1 : 0);
    return rank(x) - rank(y) || x.localeCompare(y);
  });

  // ── render ────────────────────────────────────────────────────────────────
  const h = [];
  const t = [];
  const P = s => { h.push('<p>' + s + '</p>'); };
  const UL = items => {
    h.push('<ul>');
    for (const i of items) h.push('<li>' + i + '</li>');
    h.push('</ul>');
  };

  P(esc(hello) + ' All,');
  t.push(hello + ' All,', '');

  const ref = esc(clip(m.subject || 'the meeting', 140)) + (when ? ', ' + esc(when) : '');
  P('Please see attached minutes following recent meeting ' + ref + '.');
  P('A quick summary below for reference.');
  t.push('Please see attached minutes following recent meeting ' +
    clip(m.subject || 'the meeting', 140) + (when ? ', ' + when : '') + '.',
    'A quick summary below for reference.', '');

  if (m.summary) {
    P(esc(clip(m.summary, SUMMARY_MAX)));
    t.push(clip(m.summary, SUMMARY_MAX), '');
  }

  if (highlights.length) {
    h.push('<p><b>Highlights</b></p>');
    UL(highlights.map(x => '<b>' + esc(x.project) + '</b> — ' + esc(x.text)));
    t.push('Highlights');
    highlights.forEach(x => t.push('* ' + x.project + ' — ' + x.text));
    t.push('');
  }

  if (closed.length) {
    h.push('<p><b>Closed in today\'s meeting</b></p>');
    UL(closed.map(esc));
    t.push("Closed in today's meeting");
    closed.forEach(c => t.push('* ' + c));
    t.push('');
  }

  if (orgNames.length) {
    h.push('<p><b>Remaining open actions</b></p>');
    t.push('Remaining open actions');
    for (const org of orgNames) {
      h.push('<p><b>' + esc(org) + '</b></p>');
      t.push(org);
      const owners = Object.keys(byOrg[org]).sort();
      // Under the Unassigned heading the owner name adds nothing — the heading
      // already says it. Print the action alone.
      const line = o => (org === 'Unassigned' && /^unassigned$/i.test(o))
        ? byOrg[org][o].join('; ')
        : o + ' — ' + byOrg[org][o].join('; ');
      UL(owners.map(o => esc(line(o))));
      owners.forEach(o => t.push('* ' + line(o)));
      t.push('');
    }
  }

  if (m.urls && m.urls.folder) {
    P('<a href="' + esc(m.urls.folder) + '">Open the full record</a>');
    t.push('Full record: ' + m.urls.folder);
  }

  return {
    subject: (m.subject || 'Meeting') + ' — minutes' + (when ? ', ' + when : ''),
    html: h.join('\n'),
    text: t.join('\n'),
    sections: {
      greeting: hello, date: when,
      highlights: highlights.length,
      closed: closed.length,
      openActions: open.length,
      organisations: orgNames,
    },
  };
};

module.exports = { buildMeetingEmail, greeting, orgFor, SUMMARY_MAX };
