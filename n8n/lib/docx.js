/**
 * Plain Word documents and readable transcripts, with no dependencies.
 *
 * Shared by graph/run-meeting-once.js and the Meeting Intake Code node. The Code
 * node is the reason this carries its own ZIP writer: n8n's sandbox exposes only
 * the modules named in NODE_FUNCTION_ALLOW_BUILTIN, pizzip is not in the image,
 * and anything installed into the container by hand is lost on the next rebuild.
 *
 * A .docx is a ZIP of XML. Entries are written with method 0 (stored) — Word
 * accepts uncompressed members, and a few tens of kilobytes of XML is not worth a
 * DEFLATE implementation.
 *
 * IMPORTANT — this file is inlined into a template literal by n8n/build-workflows.js.
 * A backtick or a dollar-brace anywhere here, comments included, would be evaluated
 * at build time and silently corrupt the copy that reaches n8n. Single quotes and
 * string concatenation only.
 */

const CRC_TABLE = (function () {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = buf => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

/** A ZIP archive of {name, data} entries, all stored rather than deflated. */
const zip = files => {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // method 0 — stored
    local.writeUInt16LE(0, 10);          // mod time, fixed so output is reproducible
    local.writeUInt16LE(0x21, 12);       // mod date — 1 Jan 1980
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);            // version made by
    dir.writeUInt16LE(20, 6);            // version needed
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);            // extra
    dir.writeUInt16LE(0, 32);            // comment
    dir.writeUInt16LE(0, 34);            // disk
    dir.writeUInt16LE(0, 36);            // internal attrs
    dir.writeUInt32LE(0, 38);            // external attrs
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + data.length;
  }

  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([Buffer.concat(parts), dirBuf, end]);
};

const esc = s => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A flat Word document. blocks are { heading } or { text }, and a text block may
 * set tight to suppress the space before it — used for bulleted runs.
 */
const simpleDocx = (title, blocks) => {
  const para = (runs, opts) => '<w:p>'
    + (opts && opts.tight ? '<w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr>' : '')
    + runs + '</w:p>';
  const run = (t, rpr) => '<w:r>' + (rpr || '') + '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';

  const body = [para(run(title, '<w:rPr><w:b/><w:sz w:val="36"/></w:rPr>'))];
  for (const b of blocks || []) {
    if (b.heading) body.push(para(run(b.heading, '<w:rPr><w:b/><w:sz w:val="28"/></w:rPr>')));
    else body.push(para(run(b.text || ''), { tight: b.tight }));
  }

  return zip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '</Types>',
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        + '</Relationships>',
    },
    {
      name: 'word/document.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        + body.join('')
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
        + '</w:body></w:document>',
    },
  ]);
};

/**
 * VTT cues as readable paragraphs, one per speaker turn. Timestamps and cue
 * numbers are dropped — nobody reads a transcript for those — and consecutive
 * lines from one speaker are merged so the result reads as speech rather than
 * as subtitles.
 */
const vttToBlocks = vtt => {
  const out = [];
  let last = null;
  const lines = String(vtt === null || vtt === undefined ? '' : vtt).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(line)) continue;
    if (line.indexOf('-->') > -1 || /^\d+$/.test(line)) continue;
    const v = line.match(/^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?$/);
    const who = v ? v[1].trim() : null;
    const said = (v ? v[2] : line).replace(/<[^>]+>/g, '').trim();
    if (!said) continue;
    if (who && who === last) out[out.length - 1].text += ' ' + said;
    else if (who) { out.push({ text: who + ':  ' + said }); last = who; }
    else if (last === null && out.length) out[out.length - 1].text += ' ' + said;
    else { out.push({ text: said }); last = null; }
  }
  return out.length ? out : [{ text: '(the transcript was empty)' }];
};

// ─── transcript dedup ────────────────────────────────────────────────────────

const norm = s => String(s || '').toLowerCase()
  .replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** Dice coefficient over word bigrams: 1.0 identical, 0.0 nothing shared.
 *  Bigrams rather than characters because the failure mode is a single wrong
 *  word inside an otherwise identical sentence, which character n-grams score
 *  far too high and single words score too low. */
const similarity = (a, b) => {
  const grams = s => {
    const w = s.split(' ').filter(Boolean);
    if (w.length < 2) return w.slice();
    const g = [];
    for (let i = 0; i < w.length - 1; i++) g.push(w[i] + ' ' + w[i + 1]);
    return g;
  };
  const A = grams(a), B = grams(b);
  if (!A.length || !B.length) return a === b ? 1 : 0;
  const pool = B.slice();
  let hits = 0;
  for (const g of A) {
    const at = pool.indexOf(g);
    if (at > -1) { hits++; pool.splice(at, 1); }
  }
  return (2 * hits) / (A.length + B.length);
};

const toSeconds = ts => {
  const m = String(ts).match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
};

/**
 * Drops the second copy of an utterance when two Teams clients in one call each
 * produce their own stream. The two streams transcribe the same audio slightly
 * differently — "rate cards" and "read cards" — so an exact-match key never
 * catches them, and comparing every line against every other would merge two
 * people who genuinely said the same short thing an hour apart.
 *
 * What identifies a real duplicate is that it says nearly the same words at
 * nearly the same moment. Both conditions are required.
 */
const dedupeVtt = (vtt, opts) => {
  const o = opts || {};
  const threshold = o.threshold === undefined ? 0.75 : o.threshold;
  const window = o.window === undefined ? 10 : o.window;   // seconds

  const lines = String(vtt === null || vtt === undefined ? '' : vtt).split(/\r?\n/);
  const out = [];
  const kept = [];        // { at, text } for comparison
  let dropped = 0;
  let at = null;          // start time of the cue being read
  let skipping = false;

  for (const line of lines) {
    const t = line.match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->/);
    if (t) { at = toSeconds(t[1]); skipping = false; out.push(line); continue; }

    if (line.indexOf('<v ') === -1) {
      // A continuation line of a cue that was dropped goes with it.
      if (skipping && line.trim()) { dropped++; continue; }
      out.push(line);
      continue;
    }

    const text = norm(line);
    if (!text) { out.push(line); continue; }

    // The same person appears under different labels across the two streams —
    // "Brent Craig" and "Brent (Teams)" — so match on the first name token.
    const who = (line.match(/<v\s+([^>]+)>/) || [, ''])[1];
    const tag = norm(who).split(' ')[0] || '';
    const words = text.split(' ').length;

    const near = kept.filter(k => at === null || k.at === null
      || Math.abs(k.at - at) <= window);
    const dupe = near.some(k => {
      const sim = similarity(k.text, text);
      // Same speaker: a near match is a duplicate stream.
      if (tag && k.tag && tag === k.tag) return sim >= threshold;
      // Different speakers: only collapse a long, almost-identical utterance.
      // Two people both saying "Agreed." in the same second are two
      // contributions, and dropping one would delete someone from the record.
      return words >= 6 && sim >= 0.9;
    });

    if (dupe) { dropped++; skipping = true; continue; }
    skipping = false;
    kept.push({ at: at, text: text, tag: tag });
    out.push(line);
  }

  return { vtt: out.join('\n'), dropped: dropped };
};

module.exports = { simpleDocx, vttToBlocks, dedupeVtt, similarity };
