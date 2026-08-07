# Current State Assessment

**Business Structure Efficiency — Deliverable 1**
Draft, 7 August 2026. Responds to *Project Brief — Business Structure Efficiency*, 28 July 2026.

Everything below is measured directly from the live platforms through their APIs on
7 August 2026, not gathered by interview. Where a number contradicts an assumption in
the draft plan, that is called out rather than smoothed over.

---

## 1. Headline finding

**The operating model in the draft plan assumes HubSpot is the source of truth for
clients and contacts. It is not being used.**

| Evidence | Value |
|---|---|
| Deals in HubSpot | **1** — and it is `HubSpot - New Deal (Sample Deal)`, the demo record HubSpot creates at signup |
| Companies | **0** |
| Contacts | 4, **none** with a company set |
| Most recent contact created | 11 June 2026 — roughly two months before this assessment |
| Pipeline configured | Yes: Prospecting → Initial Meeting → Proposal Development → Negotiation → Closed Won / Closed Lost |

The pipeline has been set up thoughtfully and then not used. There is no real
commercial data in the CRM.

Meanwhile:

| Evidence | Value |
|---|---|
| Projects in ProjectManager | **18** |
| Tasks | **649** |
| Milestones | 142 |
| Customer concentration | **17 of 18 projects are RACV** |

The business runs out of ProjectManager. Any design that treats HubSpot as the client
system of record is describing an intention, not the business.

**This needs a decision before the 25 August architecture** — see §6.

---

## 2. Platform-by-platform state

### ProjectManager — the real system of record

| Measure | Value | Reading |
|---|---|---|
| Projects by status | 11 Planning · 3 Open · 4 Deleted | Weighted heavily to planning |
| Tasks complete | **43 of 649 (6.6%)** | |
| Tasks in progress | 33 | |
| Tasks not started | 573 | |
| Tasks **unassigned** | **602 of 649 (93%)** | |
| `budget` populated | 17 / 18 projects | Commercial intent is captured |
| `description` populated | 15 / 18 | |
| `targetDate` populated | 16 / 18 | Dates are taken seriously |
| `actualStartDate` populated | 9 / 18 | Half the projects never record actual start |
| `hourlyRate` populated | **0 / 18** | |

**Interpretation.** ProjectManager is being used as a *planning and work-breakdown*
tool, not an execution tracker. The structure is real — 142 milestones and budgets on
nearly every project is genuine planning effort — but 93% of tasks carry no assignee
and only 6.6% are marked complete. For a single-person consultancy the assignee field
is arguably redundant, but the completion rate means **task status cannot currently be
trusted as a progress signal**, which matters because the draft plan proposes deriving
status emails and dashboards from exactly that field.

`hourlyRate` empty on every project means **project profitability cannot be computed
today**, which constrains the Xero integration described in the draft plan.

### HubSpot — configured, not adopted

Pipeline stages are defined and sensible. There is no data behind them. Four contacts,
no companies, one sample deal. Nothing created for two months.

This is not a criticism of the tool choice — it is a sequencing fact. Automation that
writes into HubSpot will work; automation that *reads client context from* HubSpot has
nothing to read.

### Microsoft 365 — newly available, largest untapped surface

A **Business Premium with Copilot** tenant now exists (`Admin.bext-automation@…`), which
is what the meeting workflow, email automation and document management all depend on.
Read-only SharePoint access has been granted.

The Azure app registration that gives programmatic Graph access is **not yet created**,
so none of it is machine-readable at the time of writing. Until it exists, areas 3, 4
and 5 of the brief cannot be assessed against real data.

### Xero, Canva, WordPress, LinkedIn

Not yet connected; assessed at the final on 8 September. Note that the Xero milestone →
invoice automation in the draft plan depends on `hourlyRate` or fixed-fee data that
ProjectManager does not currently hold.

---

## 3. Where the effort actually goes

The brief asks what consumes administrative time. The data points to three places:

1. **Nothing carries information between systems.** Eighteen projects exist in
   ProjectManager with no corresponding CRM records. A project starting means data is
   entered once, in one place, and never propagates.
2. **Task status is maintained manually and therefore isn't.** 573 tasks sit at "not
   started" including tasks on projects that are Open. The tracker drifts from reality
   because updating it is manual work with no immediate payoff.
3. **Client concentration hides the cost.** With 17 of 18 projects for one customer,
   context lives in the consultant's head rather than in the systems. That works at one
   client and breaks at three — which is precisely the scalability outcome the brief asks
   for.

---

## 4. What is already automated (as of this assessment)

Delivered under Engagement A and reusable by Engagement B:

| Capability | State |
|---|---|
| Industry source monitoring | 68 sources — 26 RSS, 29 scraped, 15 via headless browser |
| Article ingest | Hourly, deduplicating |
| AI relevance scoring and summarisation | Running on self-hosted Nous Hermes 3 |
| Daily report render + send | Verified end to end at 05:00 Australia/Melbourne |
| Automation platform | n8n, self-hosted |
| Knowledge base store | Qdrant, provisioned, not yet populated |
| Management dashboard | Live, reading operational data directly |

The infrastructure the brief's outcomes depend on is running. What is missing is the
connection to business systems, not the machinery.

---

## 5. Readiness by review area

| # | Review area | Ready to design | Blocked by |
|---|---|---|---|
| 1 | Business operating model | Yes | — |
| 2 | AI workflow design | Yes | — |
| 3 | Meeting workflow | Partly | Azure app registration → Graph → Teams transcripts |
| 4 | Email automation | Partly | Azure app registration → Outlook |
| 5 | Document management | Partly | Azure app registration → SharePoint |
| 6 | Marketing automation | Partly | LinkedIn platform limits (documented in the draft plan) |
| 7 | Knowledge management | Yes | Needs sample documents to seed |
| 8 | Forms and data capture | **Yes** | — |
| 9 | Recommended software | Yes | — |

Areas 1, 2, 7, 8 and 9 can be designed and in part built without any further access.
Areas 3, 4 and 5 — the highest-value ones — sit behind a single dependency.

---

## 6. Decisions needed before 25 August

1. **Is HubSpot staying?** Three options, and the architecture differs materially:
   - *Adopt it properly* — automation backfills companies and deals from ProjectManager,
     and HubSpot becomes the client source of truth as the draft plan describes.
   - *Demote it* — ProjectManager holds the client relationship, HubSpot is dropped, and
     the integration diagram loses a platform.
   - *Leave as-is* — least work, but the diagram would then document something unused.

2. **Should task completion drive reporting?** If status emails and dashboards read
   `percentComplete`, that field has to be maintained. Either the workflow updates it
   automatically from another signal, or reporting uses milestones and dates instead.

3. **How is project profitability calculated?** No hourly rates are recorded. Either
   rates go into ProjectManager, or the Xero integration reports on budget versus
   invoiced rather than true margin.

4. **Azure app registration** — the single dependency releasing areas 3, 4 and 5. Every
   day it waits compresses the build window before 8 September.

---

## 7. Method and limitations

Measured live via the ProjectManager and HubSpot REST APIs on 7 August 2026. Counts are
as returned by each API's default page; projects and deals fit within one page, so those
figures are complete. Task figures cover the 649 tasks returned in a single request.

**Not yet assessed:** Microsoft 365 usage patterns, Xero, Canva, WordPress and LinkedIn.
Those require the Azure registration and the remaining platform credentials, and are
scheduled for the final on 8 September.

**Deliberately not inferred:** how long any task actually takes. That needs the working
session noted in the draft plan; the API shows what is recorded, not what is spent.
