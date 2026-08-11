# SharePoint information architecture

Brief B, review area 5. Draft for the 25 August schematic architecture plan.

## What already exists

The tenant is not a blank slate. Read through Microsoft Graph on 11 August 2026, the
`bextconsultancy.sharepoint.com` tenant already carries a deliberate structure across four
sites. The proposal deck assumed a folder structure would need designing from nothing; it
does not, and the recommendation below is to extend what is there rather than replace it.

| Site | Top-level | Purpose as built |
|---|---|---|
| **BEXTHQ** | `API Automation Folder/` → `Knowledge Hub - Industry/`, `Meeting Recordings/`, `Shared Documents/` | Automation working area and the industry knowledge base |
| **CRM** | `Clients/` → `Clients/`, `Opportunities/` (Arup, Caterpillar, Deakin University, RACV, Sustainnovate) | Pre-contract: pipeline and opportunity documents |
| **ProgramManagement** | `Client 001- RACV/`, `Client 002 - XXX/` → `Project XXX/` → `00. Admin/` plus `Gate 01…Gate 11` | Post-contract delivery, on an eleven-gate project lifecycle |
| **CommercialManagement** | `Finance Mgt/` → `Cash Inflows/Client Invoices/`, `Cash Outflows/Business Expenses/` | Finance, and the natural Xero boundary |

The separation is already the right one: pipeline (CRM) is distinct from delivery
(ProgramManagement) is distinct from money (CommercialManagement), with BEXTHQ as the
internal and automation space. The eleven gates mirror how the consulting work is actually
sequenced, which makes them a usable filing target for automation — a document can be filed
to a gate because the gate means something.

## What was added (11 August 2026)

Three folders under **BEXTHQ › API Automation Folder**, created by
`graph/provision-sharepoint.js`, beside the `Meeting Recordings` folder already present:

| Folder | Holds |
|---|---|
| `Templates/` | The company minutes template the meeting workflow fills, and later document templates |
| `Meeting Transcripts/` | Raw Teams VTT, kept as the source record behind every set of minutes |
| `Meeting Minutes/` | Generated minutes documents, for review before circulation |

Nothing was moved, renamed or removed. The script is idempotent and refuses to overwrite an
existing folder.

## Source of truth, by data type

For the integration diagram. Each fact has exactly one owner; everything else reads it.

| Data | Owner | Read by |
|---|---|---|
| Contacts, opportunities, pipeline | HubSpot | CRM site documents, proposals |
| Projects, tasks, milestones | ProjectManager | ProgramManagement filing, status reports |
| Documents and their versions | SharePoint | Everything |
| Meetings, calendar, transcripts | Microsoft 365 (Teams / Exchange) | Minutes workflow |
| Invoices, expenses | Xero | CommercialManagement site |
| Automation state and run history | Postgres (`bext`) | Dashboard |

## Open decisions before 25 August

1. **Where minutes are finally filed.** They are generated into
   `BEXTHQ/API Automation Folder/Meeting Minutes/`. Client-specific minutes arguably belong
   under the matching `ProgramManagement/Client NNN/…/00. Admin/`. Recommendation: generate
   centrally, then file a copy to the client gate folder once the meeting can be matched to a
   project — which requires the ProjectManager project list, already reachable through its API.
2. **Naming convention.** Proposed: `YYYY-MM-DD Client — Meeting subject — Minutes v1.docx`,
   date first so folders sort chronologically without a view.
3. **`Client 002 - XXX` and `Project XXX`** are placeholders. Real client and project names
   are needed before automated filing can resolve a destination.
4. **Retention of raw transcripts** — kept indefinitely, or purged once minutes are approved.
