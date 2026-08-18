/**
 * The Teams channel announcement for a processed meeting.
 *
 * Shared by graph/run-meeting-once.js and the Meeting Intake Code node, which is
 * why it is a pure function: it returns the webhook envelope and posts nothing.
 * The transport differs between the two callers (fetch vs this.helpers.httpRequest)
 * and is deliberately left to them.
 *
 * IMPORTANT — this file is inlined into a template literal by n8n/build-workflows.js.
 * A backtick or a dollar-brace anywhere in here, comments included, would be
 * evaluated at build time and silently corrupt the copy that reaches n8n. Single
 * quotes and string concatenation only. No require, no fetch, no process.env.
 *
 * Adaptive Cards 1.4, not 1.5: the Table element is 1.5 and renders inconsistently
 * through the Power Automate post action, so tables are hand-built from ColumnSets.
 */

// Teams rejects payloads around 28 KB. Build to a lower ceiling and shed detail to
// reach it, because a card that fails to post tells the channel nothing at all.
const CARD_MAX_BYTES = 26000;
const SUMMARY_MAX = 1200;
const ACTION_TITLE_MAX = 90;
const ACTION_ROWS_MAX = 8;

const clip = (s, n) => {
  const t = String(s === null || s === undefined ? '' : s).trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+$/, '') + '…' : t;
};

const isClosed = a =>
  a.closed === true || /closed|complete|done/i.test(String(a.status || ''));

const text = (s, opts) => {
  const o = { type: 'TextBlock', text: s, wrap: true };
  for (const k in (opts || {})) o[k] = opts[k];
  return o;
};

const heading = s => text(s, { weight: 'Bolder', size: 'Medium', spacing: 'Medium' });

// A chip is a tinted Container, not a pill — Adaptive Cards has no border radius.
// A ColumnSet does not wrap either, so callers cap each row at four.
const chipRow = (chips, spacing) => ({
  type: 'ColumnSet',
  spacing: spacing || 'Small',
  columns: chips.slice(0, 4).map(c => ({
    type: 'Column',
    width: 'auto',
    items: [{
      type: 'Container',
      style: c.style || 'emphasis',
      items: [text(c.text, { size: 'Small', weight: 'Bolder', wrap: false, spacing: 'None' })],
    }],
  })),
});

const tableRow = (cells, opts) => {
  const o = opts || {};
  const widths = ['stretch', 'auto', 'auto', 'auto'];
  return {
    type: 'Container',
    separator: o.separator === true,
    spacing: 'Small',
    items: [{
      type: 'ColumnSet',
      columns: cells.map((c, i) => ({
        type: 'Column',
        width: widths[i] || 'auto',
        items: [text(c.text, {
          size: 'Small',
          weight: o.header ? 'Bolder' : 'Default',
          isSubtle: o.header === true,
          color: c.color || 'Default',
        })],
      })),
    }],
  };
};

/**
 * m = {
 *   subject, program, meetingNo, date, time, venue, organiser,
 *   attendees: [{ name }] or [string],
 *   summary, decisions: [string],
 *   actions:  [{ title, owner, due, status, closed }],
 *   projects: [{ status }], safety: [{ status }],
 *   urls: { folder, minutes, summary, transcript },
 * }
 */
const buildCard = (m, limits) => {
  const lim = limits || {};
  const rowsMax = lim.rows === undefined ? ACTION_ROWS_MAX : lim.rows;
  const actions = (m.actions || []).slice();
  const decisions = lim.dropDecisions ? [] : (m.decisions || []);
  // Attendees carry an Entra id only when the name resolved to a real account.
  // Those become Teams @mentions so the people in the room are notified; the rest
  // stay plain text. A transcript gives names, not addresses, so partial
  // resolution is the normal case rather than a failure.
  const people = (m.attendees || [])
    .map(a => (typeof a === 'string' ? { name: a } : (a || {})))
    .filter(a => a.name);
  const attendees = people.map(a => a.name);
  const entities = [];
  const mentionText = people.map(a => {
    if (!a.id) return clip(a.name, 60);
    const tag = '<at>' + clip(a.name, 60) + '</at>';
    entities.push({ type: 'mention', text: tag, mentioned: { id: a.id, name: clip(a.name, 60) } });
    return tag;
  }).join(', ');

  const open = actions.filter(a => !isClosed(a)).length;
  const closed = actions.length - open;
  const atRisk = (m.projects || []).filter(p => /at risk/i.test(String(p.status || ''))).length;
  const safetyOpen = (m.safety || []).filter(s => !/closed/i.test(String(s.status || ''))).length;

  const body = [];

  body.push(text(clip(m.subject || 'Meeting record', 140), { size: 'Large', weight: 'Bolder' }));
  if (m.program) body.push(text(clip(m.program, 140), { isSubtle: true, spacing: 'None' }));

  const row1 = [];
  if (m.program) row1.push({ text: clip(m.program, 40) });
  if (m.meetingNo) row1.push({ text: 'Meeting #' + m.meetingNo });
  if (m.date) row1.push({ text: String(m.date) });
  if (row1.length) body.push(chipRow(row1, 'Medium'));

  const row2 = [];
  if (open) row2.push({ text: open + (open === 1 ? ' action open' : ' actions open'), style: 'attention' });
  if (closed) row2.push({ text: closed + ' closed', style: 'good' });
  if (atRisk) row2.push({ text: atRisk + (atRisk === 1 ? ' project at risk' : ' projects at risk'), style: 'warning' });
  if (safetyOpen) row2.push({ text: 'Safety: ' + safetyOpen + ' open', style: 'warning' });
  if (row2.length) body.push(chipRow(row2));

  const facts = [];
  if (m.date) facts.push({ title: 'Date', value: String(m.date) });
  if (m.time) facts.push({ title: 'Time', value: String(m.time) });
  if (m.venue) facts.push({ title: 'Venue', value: String(m.venue) });
  if (m.organiser) facts.push({ title: 'Organiser', value: String(m.organiser) });
  if (facts.length) body.push({ type: 'FactSet', spacing: 'Medium', facts: facts });

  if (attendees.length) {
    // Not clipped: truncating mid-tag would leave a broken <at> that Teams renders
    // as literal markup. The mention list is short by nature.
    body.push(text('Attendees: ' + mentionText, { isSubtle: true, size: 'Small' }));
  }

  if (m.summary) {
    body.push(heading('Summary'));
    body.push(text(clip(m.summary, SUMMARY_MAX), { spacing: 'Small' }));
  }

  if (decisions.length) {
    body.push(heading('Decisions'));
    decisions.forEach(d => body.push(text('•  ' + clip(d, 200), { spacing: 'Small', size: 'Small' })));
  }

  if (actions.length && rowsMax > 0) {
    body.push(heading('Actions'));
    body.push(tableRow(
      [{ text: 'Action' }, { text: 'Owner' }, { text: 'Due' }, { text: 'Status' }],
      { header: true },
    ));
    actions.slice(0, rowsMax).forEach(a => body.push(tableRow([
      { text: clip(a.title, ACTION_TITLE_MAX) },
      { text: clip(a.owner || 'Unassigned', 24) },
      { text: a.due ? String(a.due) : '—' },
      { text: isClosed(a) ? 'Done' : 'Open', color: isClosed(a) ? 'Good' : 'Attention' },
    ], { separator: true })));
    if (actions.length > rowsMax) {
      body.push(text('+ ' + (actions.length - rowsMax) + ' more — see Minutes.docx',
        { size: 'Small', isSubtle: true, spacing: 'Small' }));
    }
  }

  // An Action.OpenUrl with an empty url fails validation and 400s the whole post,
  // so every button is conditional on its link having survived the upload.
  const u = m.urls || {};
  const buttons = [];
  const link = (title, url) => { if (url) buttons.push({ type: 'Action.OpenUrl', title: title, url: url }); };
  link('Open meeting folder', u.folder);
  link('Minutes.docx', u.minutes);
  link('Summary.docx', u.summary);
  link('Transcript.vtt', u.transcript);

  const content = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: body,
    actions: buttons,
  };
  // Teams reads mentions from this card-level block, not from the TextBlock. An
  // <at> tag without a matching entity renders as literal markup, so the two are
  // emitted together or not at all.
  if (entities.length) content.msteams = { entities: entities };

  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: content,
    }],
  };
};

/**
 * Builds the card, shedding detail until it fits under the Teams size cap.
 * Order of sacrifice: action rows first, then decisions — the summary and the
 * links are the point of the card and are never dropped.
 */
const buildMeetingCard = m => {
  let card = buildCard(m, {});
  if (JSON.stringify(card).length <= CARD_MAX_BYTES) return card;

  const steps = [
    { rows: 4 }, { rows: 2 }, { rows: 0 },
    { rows: 0, dropDecisions: true },
  ];
  for (let i = 0; i < steps.length; i++) {
    card = buildCard(m, steps[i]);
    if (JSON.stringify(card).length <= CARD_MAX_BYTES) return card;
  }
  return card;
};

module.exports = { buildMeetingCard, CARD_MAX_BYTES };
