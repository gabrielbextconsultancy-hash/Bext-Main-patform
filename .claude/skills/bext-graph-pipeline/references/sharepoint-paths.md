# SharePoint sites, drives and paths

## The two destinations

Every processed meeting is written twice.

| | Channel record | Archive |
|---|---|---|
| Site | `bextconsultancy.sharepoint.com:/sites/bext_transcriptsrecords` | `bextconsultancy.sharepoint.com:/sites/BEXTHQ` |
| Library | `Documents` | `Documents` |
| Base folder | `Bext Transcripts` | `API Automation Folder` |
| Purpose | What the client sees in Teams | The system of record |

The channel record exists so the whole history reads chronologically inside Teams: one folder per
meeting, named `{date} {subject}`, holding `Transcript.vtt`, `Minutes.docx` and `Summary.docx`.

## Resolution order — always three calls

```
GET /sites/{host}:/sites/{name}      → site.id
GET /sites/{site.id}/drives          → find name === 'Documents', take .id
PUT /drives/{driveId}/root:/{path}:/content
```

Falling back to `drives.value[0]` when `Documents` is absent is what the code does, and it is fine
— but log which drive was chosen.

## Compound paths return 400

This does not work and never has:

```
/sites/{host}:/sites/{name}:/drive/root:/{path}
```

Resolve the drive id first. This trap has cost time more than once because the error is a bare
`400` with no useful message.

## Encoding

Folder names contain spaces and the subject can contain almost anything.

- `encodeURIComponent` for a **single segment** (a UPN, a file name).
- `encodeURI` for a **path with separators** — it preserves `/`.

Using `encodeURIComponent` on a full path escapes the slashes and produces a 400 that looks
identical to the compound-path failure.

## The template

```
/drives/{archiveDrive}/root:/API Automation Folder/Templates/Minutes Template.docx:/content
```

Built by `templates/build-minutes-template.py` from the client's worked example. Five loops —
`attendees`, `safety`, `projects`, `finance`, `actions` — plus six header fields. Regenerating it
means re-running that script, not hand-editing the .docx.

## Write order

Within each folder: `Transcript.vtt`, `Summary.docx`, then **`Minutes.docx` last**.

The channel card announces a complete record. Minutes last means the announcement never points at
a half-filed folder. Both locations follow the same order so a reader arriving from either sees
the same guarantee.

## URLs for the card

Each `PUT` returns a driveItem carrying `webUrl`. Those are what the card's buttons open:

```js
urls: { folder: chFolder.webUrl, minutes: chMin.webUrl,
        summary: chSum.webUrl, transcript: chTr.webUrl }
```

Use the **channel** copies, not the archive copies. A client clicking a button should land in the
Teams-visible folder, not in BEXTHQ.
