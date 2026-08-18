# Microsoft Graph pitfalls

Read this before writing a new Graph call. Every entry below cost someone real time.

## Pagination

Graph returns pages, not results. A collection response carries `@odata.nextLink` when more
remains, and the page size is the service's choice, not yours.

```js
async function all(token, pathname) {
  const out = [];
  let url = 'https://graph.microsoft.com/v1.0' + pathname;
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await r.json();
    if (!r.ok) throw new Error(`${r.status} ${body.error?.code}: ${body.error?.message}`);
    out.push(...(body.value ?? []));
    url = body['@odata.nextLink'] ?? null;
  }
  return out;
}
```

Never conclude "there are only N" from a single page. `$top` is a hint the service may ignore.

## Status codes mean something specific

| Code | What it usually is | What to do |
|---|---|---|
| `401` | Expired or rotated secret, or no token | Re-mint the token. For the delegated path, `auth_status`. |
| `403` | Consent, an access policy, or **membership** | Identify which of the three before changing code. Membership is the most common and the least suspected. |
| `404` | Often **"you are not permitted to see this"**, not "absent" | Do not report a resource as missing on a 404 alone. Confirm with an identity that should see it. |
| `429` | Throttled | Honour `Retry-After`. See below. |
| `400` on a SharePoint path | Compound path | Resolve the drive id first. See below. |

Reporting a 404 as "the team does not exist" when the account simply is not a member is the
single most misleading failure mode on this tenant.

## Throttling

Respect the `Retry-After` header, and add jitter so parallel callers do not resynchronise:

```js
if (r.status === 429) {
  const wait = (Number(r.headers.get('retry-after')) || 10) * 1000;
  await new Promise(res => setTimeout(res, wait + Math.random() * 1000));
  continue; // retry, with a bounded attempt count
}
```

Bound the retries. An unbounded retry loop against a throttled tenant is worse than failing.

## The meetings API rejects a UPN

Mail and calendar endpoints accept `Admin.bext-automation@bextconsultancy.com.au` directly. The
online meetings endpoint does not — it needs the user's **object GUID**:

```
GET /users/{upn}                      → read .id
GET /users/{objectId}/onlineMeetings  → works
GET /users/{upn}/onlineMeetings       → fails
```

This inconsistency is undocumented in the places you would look for it.

## SharePoint compound paths return 400

This does not work:

```
/sites/{host}:/sites/{name}:/drive/root:/{path}
```

Resolve the drive id first, then address the path against the drive:

```
GET  /sites/{host}:/sites/{name}                 → .id
GET  /sites/{siteId}/drives                      → pick the library, .id
PUT  /drives/{driveId}/root:/{path}:/content     → works
```

## Message size

Teams messages cap at roughly **28 KB** of content. Full minutes exceed this. Post a summary
plus a link to the filed document; do not paste the document body into the channel.

## HTML bodies

When posting `contentType: html`, escape `&`, `<`, `>` and `"` in any interpolated value.
Unescaped ampersands in a document title will silently truncate or mangle the message.

## Channel messages cannot be sent app-only

There is no application permission for it. `ChannelMessage.Send` is delegated-only, and the
migration API (`Teamwork.Migrate.All`) is for one-time imports into a team in migration mode, not
for ongoing posting. The supported routes are a delegated user token or a Power Automate flow.

## Transcripts can be legitimately empty

An empty `transcripts` array is not necessarily a bug. Check, in order: was the meeting actually
transcribed; is gate 3 (*Transcript API access → Microsoft Graph access*) still on; is gate 4
(transcription on the meeting policy) still on. Transcription produced output on only two of five
attempts before settling, so intermittency here has precedent.

## Near-duplicate transcript lines

Two Teams clients in one call produce near-duplicate lines with small transcription differences
("rate cards" versus "read cards"). **This is unsolved.** The prefix match committed in `b2077d6`
does not work. It needs real similarity matching. Do not assume the pipeline handles it.
