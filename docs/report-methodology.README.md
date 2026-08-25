# Daily Report methodology doc

Two files, kept together:

- **`report-methodology.html`** — the source. Editable, self-contained (inline CSS,
  A4 print layout). This is what you change.
- **`BEXT-Daily-Report-Methodology.pdf`** — the rendered PDF handed to the client.

It explains scoring, filtering, the fetch → relevant → noise separation, and a
worked example from 24 August 2026 (all 104 fetched, the 44 that reached the email,
and why the other 60 were held out).

## Regenerate the PDF after editing the HTML

The fetcher container renders it (Chromium → PDF), same engine the daily report
and the Teams fetch-list use. From a machine with the SSH key:

```bash
ssh -i ~/.ssh/pf-nfac-hostinger -L 8080:127.0.0.1:8080 -N root@187.127.213.243 &
node -e '
  const fs=require("fs");
  const html=fs.readFileSync("docs/report-methodology.html","utf8");
  fetch("http://127.0.0.1:8080/pdf",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({html,width:"794px",height:"1123px"})})
    .then(r=>r.arrayBuffer())
    .then(b=>fs.writeFileSync("docs/BEXT-Daily-Report-Methodology.pdf",Buffer.from(b)));
'
```

## The Aug 24 figures are a snapshot

The worked example is hardcoded to 24 August 2026 as an illustration. To document a
different day, pull that day's numbers with the queries the doc was built from
(per-section counts, per-source breakdown, and the excluded-items list) and update
the tables. The methodology sections — scoring bands, floors, the two traps — do not
change with the day.
