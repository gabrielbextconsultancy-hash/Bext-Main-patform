#!/usr/bin/env python3
"""Turns the supplied minutes document into a fillable template.

    python templates/build-minutes-template.py

`Minutes-Template-source.docx` is a real RACV weekly check-in, not a blank form:
every table carries example rows. This replaces those rows with docxtemplater
loops and the header fields with placeholders, and changes nothing else — the
fonts, borders, shading and the status-colour key are the client's and are left
exactly as they are.

The approach is deliberately conservative. Rather than building tables from
scratch, it keeps the first data row of each table as the pattern, clears the
text out of its cells, writes a placeholder into each, and deletes the remaining
example rows. Word formatting lives on the row and cell, not the text, so the
result is formatted identically to the row it was cloned from.

Output: Minutes-Template.docx, which graph/upload-template.js puts in SharePoint.
"""
import copy
import shutil
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
ET.register_namespace('w', W[1:-1])

HERE = Path(__file__).parent
SRC = HERE / 'Minutes-Template-source.docx'
OUT = HERE / 'Minutes-Template.docx'

# Per table: the loop variable, and the placeholder for each column in order.
# Tables are addressed by the heading in their first row, not by index, so the
# script does not silently mis-target if a table is added to the source.
TABLES = {
    'Attendees': ('attendees', ['{name}', '{initials}', '{company}', '{email}']),
    'Safety': ('safety', ['{item}', '{detail}', '{owner}', '{due}', '{status}']),
    'Project Status': ('projects', ['{project}', '{phase}', '{status}', '{update}',
                                    '{next_action}', '{owner}', '{due}']),
    'Finance & Other Business': ('finance', ['{item}', '{detail}', '{owner}',
                                             '{due}', '{status}']),
    'Action Register': ('actions', ['{item}', '{detail}', '{owner}', '{due}', '{status}']),
}

# The header block is a two-column label/value table: the value cell of each
# labelled row becomes a placeholder.
HEADER_FIELDS = {
    'Program': '{program}',
    'Date': '{date}',
    'Time': '{time}',
    'Venue': '{venue}',
    'Meeting #': '{meeting_no}',
    'Minutes by': '{minutes_by}',
}


def cell_text(tc):
    return ' '.join(
        ''.join(t.text or '' for t in p.iter(W + 't'))
        for p in tc.iter(W + 'p')
    ).strip()


def set_cell_text(tc, text):
    """Writes text into a cell, keeping the first run's formatting.

    Word splits a sentence across runs whenever formatting or spell-check state
    changes, so a cell's text is rarely in one place. The first run is kept as
    the carrier of the intended formatting; the rest are emptied rather than
    removed, which avoids disturbing the paragraph structure Word expects.
    """
    runs = [t for p in tc.iter(W + 'p') for t in p.iter(W + 't')]
    if not runs:
        p = tc.find(W + 'p')
        if p is None:
            p = ET.SubElement(tc, W + 'p')
        r = ET.SubElement(p, W + 'r')
        runs = [ET.SubElement(r, W + 't')]
    runs[0].text = text
    runs[0].set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    for extra in runs[1:]:
        extra.text = ''


def is_header_row(row, headings):
    """A row of column labels — 'Project', 'Phase', 'Status' and so on."""
    cells = [cell_text(tc) for tc in row.findall(W + 'tc')]
    return cells and all(c in headings or not c for c in cells)


def convert_loop_table(tbl, loop, placeholders):
    rows = tbl.findall(W + 'tr')
    # The column-label row is the last one before the data starts. Everything
    # after it is example content.
    label_idx = None
    for i, row in enumerate(rows):
        cells = [cell_text(tc) for tc in row.findall(W + 'tc')]
        if len(cells) == len(placeholders) and any(cells):
            label_idx = i
            break
    if label_idx is None:
        return 0

    data_rows = rows[label_idx + 1:]
    if not data_rows:
        return 0

    pattern = data_rows[0]
    for tc, placeholder in zip(pattern.findall(W + 'tc'), placeholders):
        set_cell_text(tc, placeholder)

    # docxtemplater repeats the row between the loop tags. Opening the loop in
    # the first cell and closing it in the last makes the row itself the unit of
    # repetition.
    cells = pattern.findall(W + 'tc')
    first = cell_text(cells[0])
    set_cell_text(cells[0], '{#%s}%s' % (loop, first))
    last = cell_text(cells[-1])
    set_cell_text(cells[-1], '%s{/%s}' % (last, loop))

    for extra in data_rows[1:]:
        tbl.remove(extra)
    return len(data_rows) - 1


def main():
    if not SRC.exists():
        raise SystemExit('missing %s' % SRC)

    shutil.copy(SRC, OUT)

    with zipfile.ZipFile(SRC) as z:
        parts = {n: z.read(n) for n in z.namelist()}

    root = ET.fromstring(parts['word/document.xml'])
    body = root.find(W + 'body')

    converted, header_hits = [], 0

    for outer in body.iter(W + 'tbl'):
        rows = outer.findall(W + 'tr')
        if not rows:
            continue
        heading = cell_text(rows[0].find(W + 'tc')) if rows[0].find(W + 'tc') is not None else ''

        # Label/value header block.
        for row in rows:
            tcs = row.findall(W + 'tc')
            if len(tcs) == 2:
                label = cell_text(tcs[0])
                if label in HEADER_FIELDS:
                    set_cell_text(tcs[1], HEADER_FIELDS[label])
                    header_hits += 1

        for name, (loop, placeholders) in TABLES.items():
            if heading.startswith(name):
                # The data grid is nested inside the single-cell outer table.
                inner = [t for t in outer.iter(W + 'tbl') if t is not outer]
                target = inner[-1] if inner else outer
                removed = convert_loop_table(target, loop, placeholders)
                converted.append((name, loop, removed))
                break

    parts['word/document.xml'] = ET.tostring(root, encoding='UTF-8', xml_declaration=True)

    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)

    for name, loop, removed in converted:
        print('  %-26s -> {#%s}  (%d example row(s) removed)' % (name, loop, removed))
    print('  header fields               -> %d placeholder(s)' % header_hits)
    print('wrote %s' % OUT.name)


if __name__ == '__main__':
    main()
