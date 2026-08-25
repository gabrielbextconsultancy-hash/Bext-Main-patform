-- Store the day's full fetch list so the dashboard can serve it.
--
-- The Teams card's "view all" button pointed at a SharePoint PDF, and it did not
-- open for the client: anonymous sharing is disabled on the site by policy, and
-- an organization-scoped link still needs a live Microsoft session that the Teams
-- in-app browser does not carry. SharePoint cannot serve this without an admin
-- change nobody wants to make.
--
-- So the list is served from the dashboard instead, which is what the client
-- asked for at the outset ("view all the fetch in the dashboard"). The workflow
-- already builds the HTML for the PDF; storing it here lets a token-gated route
-- return it with no auth friction. The token in the card URL is the credential,
-- exactly as the Teams webhook URL is — and the card lives only in the private
-- channel.

BEGIN;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS fetch_list_html text;

COMMENT ON COLUMN reports.fetch_list_html IS
  'The full "everything fetched" list for the day, rendered HTML. Served by the '
  'dashboard /api/fetched route that the Teams card links to.';

COMMIT;
