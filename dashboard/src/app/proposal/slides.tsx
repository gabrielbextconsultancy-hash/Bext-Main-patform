import { Box, Cols, Flow, Step, Table, Tag, type Slide } from '@/components/Deck';
import { SystemMindmap } from '@/components/SystemMindmap';

/**
 * Draft Plan for Business Structure Efficiency, due 11 August 2026.
 * Content is transcribed from Project Brief — Business Structure Efficiency,
 * 28 July 2026. Every review area in that brief gets an answer here.
 */
export const SLIDES: Slide[] = [
  // 1 ─────────────────────────────────────────────────────────────────
  {
    section: 'Overview',
    kicker: 'BEXT Consultancy · Draft Plan · 11 August 2026',
    title: 'Business Structure Efficiency',
    lede:
      'A digital operating model where information is captured once, flows between systems on its own, ' +
      'and AI does the drafting — leaving review and approval as the only manual steps.',
    body: (
      <div className="flex h-full flex-col justify-end">
        <Cols n={3}>
          <Box accent="a">
            <p className="text-3xl font-semibold text-brief-a">11</p>
            <p className="mt-1">platforms already in use — the plan adds almost nothing</p>
          </Box>
          <Box accent="b">
            <p className="text-3xl font-semibold text-brief-b">9</p>
            <p className="mt-1">review areas answered, meeting workflow first</p>
          </Box>
          <Box accent="c">
            <p className="text-3xl font-semibold text-warn">8 Sep</p>
            <p className="mt-1">final delivery · schematic architecture 25 Aug</p>
          </Box>
        </Cols>
        <p className="mt-5 text-[11px] text-ink-600">
          Responds to <em>Project Brief — Business Structure Efficiency</em>, 28 July 2026.
        </p>
      </div>
    ),
  },

  // 2 ─────────────────────────────────────────────────────────────────
  {
    section: 'Overview',
    kicker: 'The ask',
    title: 'What the brief asks for',
    lede: 'Maximise time spent consulting. Minimise administration.',
    body: (
      <Cols n={2}>
        <Box title="Stated outcomes">
          <ul className="list-disc space-y-1 pl-4">
            <li>Single point of data entry wherever possible</li>
            <li>Minimal duplication across systems</li>
            <li>Maximum use of AI for administrative tasks</li>
            <li>Highly automated document creation</li>
            <li>Automated meeting documentation and project administration</li>
            <li>Automated filing and organisation</li>
            <li>High-quality draft emails and reports needing only review</li>
            <li>Consistent processes, scalable, secure</li>
          </ul>
        </Box>
        <Box title="The binding constraint" accent="c">
          <p className="italic text-ink-300">
            “Confined to the shared capability of the following tools without need for third-party
            management platform.”
          </p>
          <p className="mt-2">
            This is the most important line in the brief. It rules out Monday, Notion, Asana, Zapier
            and every other SaaS layer. The design therefore uses <strong className="text-ink-200">what
            is already licensed</strong>, joined by automation you own and can hand over.
          </p>
          <p className="mt-2 text-ink-600">
            Section 9 still asks for software recommendations — answered, but deliberately short.
          </p>
        </Box>
      </Cols>
    ),
  },

  // 3 ─────────────────────────────────────────────────────────────────
  {
    section: 'Current state',
    kicker: 'Current state · deliverable 1',
    title: 'Eleven platforms, no connective tissue',
    lede:
      'Every platform is capable. None of them talk to each other, so the consultant is the ' +
      'integration layer.',
    body: (
      <Table
        head={['Platform', 'Role today', 'Where the effort goes', 'Verdict']}
        rows={[
          ['Microsoft 365 — Outlook, Teams, SharePoint, OneDrive, Office, Copilot', 'Email, meetings, files, documents',
            'Notes typed by hand, files named and filed by hand, actions tracked in memory', <Tag key="1" tone="a">Backbone</Tag>],
          ['HubSpot', 'CRM, pipeline', 'Contacts and deal stages re-entered from email threads', <Tag key="2" tone="a">Source of truth</Tag>],
          ['ProjectManager', 'Projects, tasks', 'Tasks retyped from meeting outcomes', <Tag key="3" tone="a">Source of truth</Tag>],
          ['Xero', 'Invoicing, accounts', 'Invoice triggers watched manually against milestones', <Tag key="4" tone="a">Source of truth</Tag>],
          ['Canva', 'Proposals, reports, presentations', 'Rebuilt from scratch each time; content re-keyed', <Tag key="5" tone="c">Template gap</Tag>],
          ['Claude / Copilot', 'Drafting assistance', 'Context pasted by hand every session; nothing is remembered', <Tag key="6" tone="c">Under-used</Tag>],
          ['WordPress · LinkedIn', 'Website, market presence', 'Content written ad hoc, publishing irregular', <Tag key="7" tone="c">Manual</Tag>],
          ['Adobe PDF · Chrome', 'Documents, browsing', 'Fine as-is', <Tag key="8">No change</Tag>],
        ]}
      />
    ),
  },

  // 4 ─────────────────────────────────────────────────────────────────
  {
    section: 'Current state',
    kicker: 'Diagnosis',
    title: 'The same fact gets entered four times',
    body: (
      <Cols n={2}>
        <div className="space-y-2">
          <p className="text-[13px] text-ink-400">
            One client conversation currently produces manual work in five places, because nothing
            carries information forward:
          </p>
          <Step label="Meeting" text="Discussion happens" who="you" />
          <Step label="HubSpot" text="Contact and stage updated — re-entered" who="you" />
          <Step label="ProjectManager" text="Actions become tasks — re-entered" who="you" />
          <Step label="Outlook" text="Follow-up written from scratch" who="you" />
          <Step label="SharePoint" text="Documents named and moved by hand" who="you" />
        </div>
        <div className="space-y-3">
          <Box title="The principle" accent="b">
            Capture once. Distribute automatically. Review at the end, not throughout.
            <p className="mt-2">
              The meeting already produces a recording and a transcript. Everything on the left can
              be derived from it — which is why the brief names the meeting workflow as the top
              priority, and why we start there.
            </p>
          </Box>
          <Box title="What this is not" accent="c">
            Not autonomous sending. Every outbound artefact — email, proposal, invoice trigger —
            stops at a draft for approval. The brief asks for “review, refinement and final
            approval”, and that gate stays everywhere the system touches a client.
          </Box>
        </div>
      </Cols>
    ),
  },

  // 5 ─────────────────────────────────────────────────────────────────
  {
    section: 'Future state',
    kicker: 'Future state · deliverable 2',
    title: 'Business Systems Integration Diagram',
    lede: 'Which system owns which fact, and how information moves.',
    body: (
      <div className="space-y-3">
        {[
          { lane: 'Capture', steps: [
            ['Teams', 'Meeting + transcript', 'sys'], ['Outlook', 'Email + enquiries', 'sys'], ['Forms', 'Structured intake', 'sys']] },
          { lane: 'Automation layer — n8n, owned by you', steps: [
            ['Route', 'Graph API listens, classifies, dispatches', 'ai'], ['Draft', 'Minutes, emails, reports, posts', 'ai'], ['Recall', 'Vector search over past work', 'ai']] },
          { lane: 'Systems of record', steps: [
            ['HubSpot', 'Clients, contacts, pipeline', 'sys'], ['ProjectManager', 'Projects, tasks, actions', 'sys'], ['SharePoint', 'Documents, knowledge', 'sys'], ['Xero', 'Invoices, finance', 'sys']] },
          { lane: 'Output', steps: [
            ['Outlook', 'Drafts awaiting approval', 'you'], ['Canva · Office', 'Proposals, reports, decks', 'you'], ['WordPress · LinkedIn', 'Published content', 'you'], ['Power BI', 'Business dashboard', 'sys']] },
        ].map(row => (
          <div key={row.lane} className="grid gap-2 sm:grid-cols-[150px_1fr]">
            <p className="pt-2 text-[11px] leading-snug text-ink-500">{row.lane}</p>
            <Flow>
              {row.steps.map(([l, t, w]) => (
                <Step key={l} label={l} text={t} who={w as 'ai' | 'you' | 'sys'} />
              ))}
            </Flow>
          </div>
        ))}
        <p className="text-[11px] text-ink-600">
          n8n is self-hosted on infrastructure you own — it is the integration layer, not a
          third-party management platform, which is what keeps the design inside the constraint.
        </p>
      </div>
    ),
  },

  // 5b ────────────────────────────────────────────────────────────────
  {
    section: 'Future state',
    kicker: 'Future state · the whole picture',
    title: 'One centre, five branches',
    lede:
      'The same architecture as a mind map — every platform hung off the branch that owns it, ' +
      'colour telling you what kind of thing each one is.',
    body: (
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <SystemMindmap />
        </div>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-[11px] text-ink-500">
          <span><span style={{ color: '#38bdf8' }}>●</span> Capture</span>
          <span><span style={{ color: '#a78bfa' }}>●</span> AI &amp; automation</span>
          <span><span style={{ color: '#14b8a6' }}>●</span> Systems of record</span>
          <span><span style={{ color: '#fbbf24' }}>●</span> Output</span>
          <span><span style={{ color: '#34d399' }}>●</span> AI workflows</span>
        </div>
      </div>
    ),
  },

  // 6 ─────────────────────────────────────────────────────────────────
  {
    section: 'Future state',
    kicker: 'Future state · operating model',
    title: 'One owner per fact',
    lede: 'Duplication ends when every type of information has exactly one home and everything else reads from it.',
    body: (
      <Table
        head={['Information', 'Source of truth', 'Flows to', 'Entered where']}
        rows={[
          ['Clients & contacts', <Tag key="a" tone="a">HubSpot</Tag>, 'ProjectManager, Xero, document metadata', 'Once, at onboarding form'],
          ['Projects & actions', <Tag key="b" tone="a">ProjectManager</Tag>, 'Minutes, status emails, Power BI', 'Derived from meetings — not typed'],
          ['Documents & deliverables', <Tag key="c" tone="a">SharePoint</Tag>, 'Knowledge base, Canva, proposals', 'Filed automatically on creation'],
          ['Finance', <Tag key="d" tone="a">Xero</Tag>, 'Power BI, project profitability', 'Triggered by project milestones'],
          ['Meetings & decisions', <Tag key="e" tone="a">Teams + SharePoint</Tag>, 'Minutes, actions, follow-up, knowledge base', 'Recording only'],
          ['Past work & methodology', <Tag key="f" tone="a">Knowledge base</Tag>, 'Every AI draft, every proposal', 'Indexed automatically'],
          ['Market presence', <Tag key="g" tone="a">WordPress</Tag>, 'LinkedIn, capability statements', 'Drafted by AI, approved by you'],
        ]}
      />
    ),
  },

  // 7 ─────────────────────────────────────────────────────────────────
  {
    section: 'Review areas',
    kicker: 'Review area 3 · stated highest priority',
    title: 'The meeting workflow',
    lede:
      '“No manual note taking should be required.” One recording produces the minutes, the decisions, ' +
      'the tasks, the follow-up and the filing.',
    body: (
      <div className="space-y-4">
        <Flow>
          <Step label="01" text="Record in Teams" who="sys" />
          <Step label="02" text="Transcript produced" who="sys" />
          <Step label="03" text="Minutes in your template" who="ai" />
          <Step label="04" text="Decisions extracted" who="ai" />
          <Step label="05" text="Actions to ProjectManager" who="ai" />
          <Step label="06" text="Follow-up email drafted" who="ai" />
          <Step label="07" text="Filed to SharePoint" who="ai" />
          <Step label="08" text="Review & send" who="you" />
        </Flow>
        <Cols n={3}>
          <Box title="How it is built" accent="a">
            Graph subscribes to meeting-transcript events. n8n pulls the transcript, runs it through
            the drafting prompt with your minutes template, then writes to ProjectManager, SharePoint
            and an Outlook draft.
          </Box>
          <Box title="Extends to daily notes" accent="b">
            The brief asks that this cover personal brainstorming too. Same pipeline, different
            template — a voice note or OneNote page in, structured and filed output back.
          </Box>
          <Box title="Open question" accent="c">
            Teams transcription must be enabled tenant-wide, and app-only transcript access needs an
            application access policy. Confirm licensing before 25 August — the one place the plan
            depends on a setting outside our control.
          </Box>
        </Cols>
      </div>
    ),
  },

  // 8 ─────────────────────────────────────────────────────────────────
  {
    section: 'Review areas',
    kicker: 'Review areas 4 & 5',
    title: 'Email and documents',
    body: (
      <Cols n={2}>
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-ink-100">Email automation</h3>
          <Table
            head={['Case', 'AI produces']}
            rows={[
              ['New client enquiry', 'Classified, drafted reply, HubSpot contact created'],
              ['Meeting follow-up', 'Draft with decisions and actions attached'],
              ['Project progress update', 'Draft with status graphic and report attached'],
              ['Proposal response', 'Draft built from the closest past proposal'],
              ['Standard enquiry', 'Draft from the response library'],
              ['Reminders', 'Scheduled from ProjectManager due dates'],
              ['Commercial email filing', 'Prompt to file, then filed on confirmation'],
            ]}
          />
          <p className="mt-2 text-[11px] text-ink-600">
            Everything lands in Outlook <strong>Drafts</strong>. Nothing sends itself.
          </p>
        </div>
        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold text-ink-100">Document management</h3>
          <div className="rounded-xl border border-ink-800 bg-ink-950 p-3">
            <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed text-ink-400">{`/Clients
   /{Client}
      /{ProjectNo}-{ProjectName}
         /01-Proposals
         /02-Meetings
         /03-Deliverables
         /04-Correspondence
         /05-Finance
/Business
   /Capability Statements
   /Templates /Methodologies
   /Lessons Learned`}</pre>
          </div>
          <p className="text-[13px] text-ink-400">
            <strong className="text-ink-200">Naming:</strong>{' '}
            <code className="text-brief-a">{'{YYYY-MM-DD}_{ProjectNo}_{DocType}_{Rev}'}</code> —
            applied by the automation, so it is consistent by construction rather than by discipline.
            Version control through SharePoint’s own history.
          </p>
        </div>
      </Cols>
    ),
  },

  // 9 ─────────────────────────────────────────────────────────────────
  {
    section: 'Review areas',
    kicker: 'Review areas 7 & 2',
    title: 'Knowledge management — where AI stops being an assistant',
    lede:
      '“The objective is to avoid recreating work already completed.” This is the difference between ' +
      'AI that drafts generically and AI that drafts like you.',
    body: (
      <Cols n={2}>
        <div className="space-y-2">
          <Step label="Index" text="Every past proposal, report, masterplan, capability statement, presentation, meeting note, template and lesson learned" who="sys" />
          <Step label="Embed" text="Chunked and vectorised into the knowledge base" who="sys" />
          <Step label="Retrieve" text="Every draft starts by finding what you already wrote on the subject" who="ai" />
        </div>
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-ink-100">AI as worker, not assistant</h3>
          <Table
            head={['Task', 'Today → Proposed']}
            rows={[
              ['Meeting minutes', <span key="1">Manual → <span className="text-brief-b">AI, you approve</span></span>],
              ['Action extraction', <span key="2">Manual → <span className="text-brief-b">AI, you approve</span></span>],
              ['Email drafting', <span key="3">Manual → <span className="text-brief-b">AI, you approve</span></span>],
              ['Proposals & briefs', <span key="4">Manual → <span className="text-brief-b">AI from past work</span></span>],
              ['Reports', <span key="5">Manual → <span className="text-brief-b">AI first draft</span></span>],
              ['Presentations', <span key="6">Manual → <span className="text-brief-b">AI into Canva template</span></span>],
              ['Filing & naming', <span key="7">Manual → <span className="text-brief-a">fully automatic</span></span>],
              ['Final judgement', <span key="8">You → <span className="text-warn">still you</span></span>],
            ]}
          />
        </div>
      </Cols>
    ),
  },

  // 10 ────────────────────────────────────────────────────────────────
  {
    section: 'Review areas',
    kicker: 'Review areas 6 & 8',
    title: 'Marketing and structured capture',
    body: (
      <Cols n={2}>
        <div className="space-y-3">
          <Box title="Enquiry handling" accent="a">
            Inbound enquiry classified, response drafted, HubSpot contact created, follow-up scheduled.
          </Box>
          <Box title="LinkedIn industry monitoring" accent="c">
            Summarising the energy industry’s LinkedIn activity into a periodic digest.
            <p className="mt-2 text-warn">
              Flagged: LinkedIn’s terms prohibit automated scrolling of the feed and their API does
              not expose it. Practical routes are the Pages API for company content, or a curated
              source list. Worth confirming appetite before committing.
            </p>
          </Box>
          <Box title="Content drafting" accent="a">
            Fortnightly LinkedIn posts and blogs drafted from your recent project work and the daily
            industry report — the two engagements feeding each other.
          </Box>
        </div>
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-ink-100">Forms &amp; data capture</h3>
          <Table
            head={['Form', 'Feeds']}
            rows={[
              ['Project initiation', 'PM + SharePoint'],
              ['Client onboarding', 'HubSpot + Xero'],
              ['Site inspection', 'Report draft'],
              ['Meeting preparation', 'Agenda + minutes'],
              ['Proposal request', 'Proposal draft'],
              ['Consultant checklist', 'Quality record'],
              ['Stakeholder input', 'Project record'],
              ['Design review', 'Deliverable record'],
              ['Defect / product issue claim', 'Issue register'],
              ['Stakeholder project enquiry', 'HubSpot'],
            ]}
          />
          <p className="mt-2 text-[11px] text-ink-600">
            Built in Microsoft Forms — already licensed, native to the tenant, no new platform.
          </p>
        </div>
      </Cols>
    ),
  },

  // 11 ────────────────────────────────────────────────────────────────
  {
    section: 'Review areas',
    kicker: 'Review area 9 · deliverable 5',
    title: 'Software recommendations',
    lede:
      'The brief prefers adding nothing. Three additions are proposed, all self-hosted or already ' +
      'owned — and one thing is explicitly not recommended.',
    body: (
      <div className="space-y-4">
        <Table
          head={['Addition', 'Justification', 'Cost', 'Effort', 'Maintenance']}
          rows={[
            [<strong key="1">n8n</strong>, 'The integration layer. Without it the platforms cannot talk without third-party SaaS.', '~A$12/mo VPS', 'Already running', 'Low — you own it'],
            [<strong key="2">Vector knowledge base</strong>, 'Lets AI draft from your past work instead of generically.', 'Included', 'Low', 'Low'],
            [<strong key="3">AI API</strong>, 'Drafting engine. Claude or Gemini; you already use Claude.', '~A$30–80/mo', 'Low', 'None'],
            [<strong key="4">Power BI Desktop</strong>, 'Business dashboard over HubSpot, ProjectManager and Xero.', 'Free', 'Medium', 'Low'],
          ]}
        />
        <Cols n={2}>
          <Box title="Not recommended" accent="c">
            A dedicated practice management platform. It would duplicate HubSpot, ProjectManager and
            Xero, cost more than everything above combined, and re-introduce exactly the third-party
            dependency the brief asks to avoid.
          </Box>
          <Box title="Worth a decision">
            Microsoft 365 Business Premium over Standard — adds Intune and stronger security controls
            for client data, relevant to the “secure handling of client and business information”
            outcome. Modest per-seat increase.
          </Box>
        </Cols>
      </div>
    ),
  },

  // 12 ────────────────────────────────────────────────────────────────
  {
    section: 'Content',
    kicker: 'Review area 6 · LinkedIn blog generation',
    title: 'A fortnight of industry news, turned into one post',
    lede:
      'The daily report already reads 68 sources and ranks what matters. That judgement ' +
      'currently ends with the email. This is where it goes next.',
    body: (
      <Cols n={2}>
        <Box title="What each fortnight produces" accent="b">
          <ul className="list-disc space-y-1 pl-4">
            <li>A scroll of every viable source from the previous 14 days</li>
            <li>Three ranked topic options, each with its supporting sources</li>
            <li>Two LinkedIn-ready drafts, one of them recommended</li>
            <li>A visual concept, a restrained call to action, a destination</li>
            <li>A fact-check record naming the source of every material claim</li>
            <li>A publication-ready final copy</li>
            <li>A performance entry once it has been published</li>
          </ul>
        </Box>
        <Box title="What it asks of you" accent="c">
          Five to ten minutes a fortnight, at a single point of entry: pick the topic, add the
          human perspective, make minor edits, approve, publish.
          <p className="mt-2">
            Everything else — reading the fortnight, ranking the options, drafting, checking the
            claims — happens before you open the page. The system never publishes on its own.
          </p>
        </Box>
      </Cols>
    ),
  },

  // 13 ────────────────────────────────────────────────────────────────
  {
    section: 'Content',
    kicker: 'The flow',
    title: 'Eight steps, three of them yours',
    lede: 'Machine work is front-loaded so the human work is a decision, not a task.',
    body: (
      <div className="space-y-4">
        <Flow>
          <Step label="1 · scan" text="14 days of ranked sources, already fetched and scored" who="sys" />
          <Step label="2 · rank" text="Three topic options, each carrying its evidence" who="ai" />
          <Step label="3 · select" text="You pick one and say what BEXT thinks" who="you" />
          <Step label="4 · draft" text="Two variants, one recommended, with a visual concept" who="ai" />
        </Flow>
        <Flow>
          <Step label="5 · verify" text="Every material claim matched back to a source" who="ai" />
          <Step label="6 · approve" text="Minor edits, then a publication-ready copy" who="you" />
          <Step label="7 · publish" text="You post it. Nothing posts itself" who="you" />
          <Step label="8 · record" text="The performance entry, against the register" who="sys" />
        </Flow>
        <Cols n={3}>
          <Box title="Where the material comes from" accent="a">
            The same pipeline as the daily report. No second collection, no new sources to
            maintain, and anything already in the sheet is already eligible here.
          </Box>
          <Box title="Why two drafts, not five" accent="b">
            The brief asks for a choice with a recommendation. Five variants is a shortlist to work
            through, and working through it is the cost the fortnightly budget cannot carry.
          </Box>
          <Box title="Why the fact-check step exists" accent="c">
            A model asked about a rebate will produce a figure whether or not one was in the source,
            and it looks equally confident either way. Every claim is traced back or flagged.
          </Box>
        </Cols>
      </div>
    ),
  },

  // 14 ────────────────────────────────────────────────────────────────
  {
    section: 'Content',
    kicker: 'The dashboard',
    title: 'One page, four states',
    lede: 'Content Generation sits in the platform sidebar, next to the daily report it reads.',
    body: (
      <Table
        head={['Screen', 'What you see', 'What you do']}
        rows={[
          [
            'Daily news',
            'Every daily report, newest first, each opening to the articles and links it carried',
            <>Read, then <Tag key="1" tone="b">Repurpose this report</Tag></>,
          ],
          [
            'Topic options',
            'Three ranked cards: the angle, why it earns BEXT’s name, and the sources behind it',
            'Pick one. Add your perspective in a paragraph',
          ],
          [
            'Drafts',
            'Two variants side by side, one marked recommended. Hook, body, visual concept, CTA, destination, character count',
            'Edit inline. Approve one',
          ],
          [
            'Fact check',
            'Each material claim, the article it came from, and the sentence that carries it. Anything unmatched is marked',
            'Resolve or remove what is unmatched',
          ],
          [
            'Register',
            'What was published, when, and how it performed',
            'Enter the numbers once, after the fact',
          ],
        ]}
      />
    ),
  },

  // 15 ────────────────────────────────────────────────────────────────
  {
    section: 'Content',
    kicker: 'Governance',
    title: 'Automated up to the point of judgement',
    body: (
      <Cols n={2}>
        <Box title="Runs on a schedule" accent="a">
          <ul className="list-disc space-y-1 pl-4">
            <li>The fortnightly scan opens a cycle without being asked</li>
            <li>Topic ranking and drafting run as soon as there is work</li>
            <li>The claim check runs on every draft, every time</li>
            <li>A missed run raises an alert, the same as every other workflow here</li>
          </ul>
          <p className="mt-2">
            You can also start a cycle by hand from any daily report, without waiting for the
            fortnight.
          </p>
        </Box>
        <Box title="Waits for a person" accent="c">
          <ul className="list-disc space-y-1 pl-4">
            <li>Which topic, and what BEXT thinks about it</li>
            <li>Which variant, and any edits to it</li>
            <li>Whether it is published at all</li>
          </ul>
          <p className="mt-2">
            Publishing is manual by design for launch. Automatic posting is a later switch, and it
            changes nothing upstream of the approval.
          </p>
        </Box>
      </Cols>
    ),
  },

  // 16 ────────────────────────────────────────────────────────────────
  {
    section: 'Environment',
    kicker: 'Review area 9 · what is running today',
    title: 'Development environment, and what BEXT will own',
    lede:
      'Everything is already running — but on the developer’s own accounts, at no cost to you. ' +
      'None of it is a BEXT asset yet. Going live means moving the same stack onto accounts BEXT ' +
      'owns and is billed for.',
    body: (
      <div className="space-y-3">
        <Cols n={2}>
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-100">
              <span className="h-2 w-2 rounded-full bg-warn" />
              Developer-provided today — temporary, not BEXT’s
            </h3>
            <Table
              head={['Component', 'Running on', 'BEXT will need']}
              rows={[
                ['Server', 'Developer’s Hostinger VPS srv1866850', <Tag key="1" tone="c">Own VPS account</Tag>],
                ['Domain', 'bext.dev-environment.site', <Tag key="2" tone="c">Own domain</Tag>],
                ['Dashboard host', 'Developer’s iFastNet cPanel', <Tag key="3" tone="c">Own hosting</Tag>],
                ['Report email', 'SMTP on the development domain', <Tag key="4" tone="c">Microsoft 365 mailbox</Tag>],
                ['AI model', 'Developer’s Gemini key', <Tag key="5" tone="c">Own AI subscription</Tag>],
                ['Source control', 'Developer’s GitHub repository', <Tag key="6" tone="c">Own repository</Tag>],
                ['Dev tooling', 'VS Code, Claude Code — developer licences', <Tag key="7">Never BEXT’s cost</Tag>],
              ]}
            />
            <p className="mt-2 text-[11px] leading-relaxed text-ink-600">
              These exist so there is something working to review now. Every one of them is replaced
              at go-live — BEXT is not billed for any of it during development, and inherits none of
              it by default.
            </p>
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-100">
              <span className="h-2 w-2 rounded-full bg-ok" />
              Work product — transfers to BEXT in full
            </h3>
            <Table
              head={['Component', 'What it is']}
              rows={[
                ['Automation platform', 'n8n Community — free, self-hosted, redeployed on your server'],
                ['Database', 'PostgreSQL 16, 8 tables — schema and data'],
                ['Knowledge base', 'Qdrant vector store'],
                ['Browser fetch service', 'For sources that block plain requests'],
                ['Reverse proxy + SSL', 'Traefik with auto-renewing certificates'],
                ['Source registry', 'All 68 briefed sources — 26 RSS, 29 scraped, 15 via browser'],
                ['Ingest workflow', 'Hourly, deduplicating — 1,455 articles from 46 sources'],
                ['Analysis workflow', 'Summary, relevance score and tags per article'],
                ['Management dashboard', 'Health, timeline, deliverables, sources, this deck'],
                ['Deploy pipeline', 'Push to deploy, plus full commit history'],
              ]}
            />
          </div>
        </Cols>
        <Box title="What “going live” actually means" accent="c">
          The software is all open-source and self-hosted, so the transition is an account change,
          not a rebuild — the same stack is redeployed onto BEXT-owned infrastructure and the
          credentials are reissued in BEXT’s name. After that the recurring cost is one VPS
          (~A$12/month), a domain, the Microsoft 365 licence and an AI subscription. No per-seat
          platform fees, no vendor holding your data, nothing that cannot be moved again later.
        </Box>
      </div>
    ),
  },

  // 17 ────────────────────────────────────────────────────────────────
  {
    section: 'Dependencies',
    kicker: 'Deliverable 4',
    title: 'Automation opportunities, ranked',
    lede: 'Ordered by return against effort. Maintenance is the ongoing cost once running.',
    body: (
      <Table
        head={['Automation', 'Integration', 'Effort', 'Maintenance', 'Return']}
        rows={[
          ['Meeting → minutes, actions, filing, follow-up', 'Graph (Teams) → n8n → PM, SharePoint, Outlook', <Tag key="1" tone="c">High</Tag>, <Tag key="2">Low</Tag>, <Tag key="3" tone="b">Highest</Tag>],
          ['Automatic filing & naming', 'Graph (SharePoint/OneDrive)', <Tag key="4">Low</Tag>, <Tag key="5">Low</Tag>, <Tag key="6" tone="b">High</Tag>],
          ['Email drafting & enquiry triage', 'Graph (Outlook) → AI → HubSpot', <Tag key="7">Medium</Tag>, <Tag key="8">Low</Tag>, <Tag key="9" tone="b">High</Tag>],
          ['Knowledge base over past work', 'SharePoint → vector store', <Tag key="10">Medium</Tag>, <Tag key="11">Low</Tag>, <Tag key="12" tone="b">High</Tag>],
          ['Client onboarding, one form', 'Forms → HubSpot, Xero, PM, SharePoint', <Tag key="13">Low</Tag>, <Tag key="14">Low</Tag>, <Tag key="15" tone="b">Medium</Tag>],
          ['Proposal & report generation', 'Knowledge base → Canva / Word', <Tag key="16" tone="c">High</Tag>, <Tag key="17">Medium</Tag>, <Tag key="18" tone="b">High</Tag>],
          ['Milestone → Xero invoice draft', 'PM → n8n → Xero', <Tag key="19">Medium</Tag>, <Tag key="20">Low</Tag>, <Tag key="21" tone="b">Medium</Tag>],
          ['Business dashboard', 'HubSpot, PM, Xero → Power BI', <Tag key="22">Medium</Tag>, <Tag key="23">Low</Tag>, <Tag key="24" tone="b">Medium</Tag>],
          ['LinkedIn monitoring & drafting', 'Sources → AI → draft posts', <Tag key="25">Medium</Tag>, <Tag key="26" tone="c">Medium</Tag>, <Tag key="27">Conditional</Tag>],
        ]}
      />
    ),
  },

  // 18 ────────────────────────────────────────────────────────────────
  {
    section: 'Delivery',
    kicker: 'Dependencies · please read',
    title: 'What is already provided, and what only you can provide',
    lede:
      'The build is underway on infrastructure and tooling supplied at no cost to you. What cannot ' +
      'be supplied on your behalf is licensing and account access — those are the hard blockers.',
    body: (
      <div className="space-y-3">
      <Cols n={2}>
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-100">
            <span className="h-2 w-2 rounded-full bg-ok" />
            Provided — already running, no cost to you
          </h3>
          <Table
            head={['Item', 'Status']}
            rows={[
              ['Hostinger VPS + Docker', <Tag key="1" tone="a">Live</Tag>],
              ['n8n automation platform (self-hosted)', <Tag key="2" tone="a">Live</Tag>],
              ['PostgreSQL — application database', <Tag key="3" tone="a">Live</Tag>],
              ['Qdrant — knowledge base store', <Tag key="4" tone="a">Live</Tag>],
              ['Headless browser service', <Tag key="5" tone="a">Live</Tag>],
              ['Management dashboard + this proposal', <Tag key="6" tone="a">Live</Tag>],
              ['AI development tooling', <Tag key="7" tone="a">Live</Tag>],
              ['Power BI Desktop', <Tag key="8" tone="a">Installed</Tag>],
            ]}
          />
          <p className="mt-2 text-[11px] text-ink-600">
            All of this is self-hosted and transfers to you at handover. No third-party management
            platform, no per-seat SaaS fee, no lock-in.
          </p>
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-100">
            <span className="h-2 w-2 rounded-full bg-blocked" />
            Required from you — cannot proceed without
          </h3>
          <Table
            head={['Licence / access', 'Blocks', '']}
            rows={[
              ['Microsoft 365 Business Standard or Premium — mailbox, Teams, SharePoint, OneDrive',
                'Meeting workflow, email automation, document management (areas 3, 4, 5)',
                <Tag key="1" tone="c">Mandatory</Tag>],
              ['Teams transcription enabled, tenant-wide',
                'The entire meeting workflow — the stated top priority',
                <Tag key="2" tone="c">Mandatory</Tag>],
              ['Azure App Registration + admin consent',
                'All Microsoft Graph access. Free, but needs the tenant above',
                <Tag key="3" tone="c">Mandatory</Tag>],
              ['HubSpot private app token', 'CRM sync, enquiry capture', <Tag key="4" tone="c">Mandatory</Tag>],
              ['Xero OAuth authorisation', 'Milestone → invoice drafting', <Tag key="5" tone="c">Mandatory</Tag>],
              ['ProjectManager API token', 'Actions → tasks automation', <Tag key="6" tone="c">Mandatory</Tag>],
              ['WordPress admin / application password', 'Content publishing', <Tag key="7">Conditional</Tag>],
              ['Production AI subscription — Claude, OpenAI or Azure OpenAI',
                'Live drafting once handed over', <Tag key="8" tone="c">Mandatory at go-live</Tag>],
              ['Power BI Pro', 'Only if dashboards are shared through the cloud', <Tag key="9">Optional</Tag>],
            ]}
          />
        </div>
      </Cols>
      <Box accent="c">
        <strong className="text-ink-200">Sequencing.</strong> Design and build continue without any
        of the items on the right — the architecture, process maps and integration specifications
        are all deliverable on schedule. What they gate is <em>connecting to live business data</em>.
        The Microsoft 365 licence is the first domino: it unlocks the Azure registration, which
        unlocks Graph, which unlocks the meeting workflow named as the highest priority. Confirming
        it before <strong className="text-ink-200">25 August</strong> keeps the 8 September date intact.
      </Box>
      </div>
    ),
  },

  // 19 ────────────────────────────────────────────────────────────────
  {
    section: 'Delivery',
    kicker: 'Delivery',
    title: 'Path to 8 September',
    body: (
      <div className="space-y-4">
        <Cols n={3}>
          <Box title="Draft Plan — 11 Aug" accent="c">
            This document. Operating model, target architecture, the nine review areas answered,
            opportunities ranked.
          </Box>
          <Box title="Schematic Architecture — 25 Aug">
            Full integration diagram, process flow maps per workflow, SharePoint information
            architecture, integration specifications.
          </Box>
          <Box title="Final — 8 Sep">
            Complete current-state assessment, final architecture, API integration schedule with
            effort and maintenance, software recommendations, implementation sequence.
          </Box>
        </Cols>
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-ink-100">
            Needed from you before 25 August
          </h3>
          <Cols n={2}>
            <ul className="list-disc space-y-1 pl-4 text-[13px] text-ink-400">
              <li><strong className="text-ink-200">Working session, ~90 minutes</strong> — walk through a real week so the current-state assessment reflects actual volumes</li>
              <li><strong className="text-ink-200">Templates</strong> — your minutes, proposal and report formats, so AI drafts into the real thing</li>
              <li><strong className="text-ink-200">Microsoft 365 tenant</strong> — licensing, and whether Teams transcription is enabled</li>
            </ul>
            <ul className="list-disc space-y-1 pl-4 text-[13px] text-ink-400">
              <li><strong className="text-ink-200">Decision on LinkedIn monitoring</strong> — scope to what the platform permits, or drop it</li>
              <li><strong className="text-ink-200">Sample documents</strong> — representative past proposals and reports to seed the knowledge base</li>
              <li><strong className="text-ink-200">Access</strong> — HubSpot private app token, Xero OAuth, ProjectManager API token, when build starts</li>
            </ul>
          </Cols>
        </div>
      </div>
    ),
  },

  // 20 ────────────────────────────────────────────────────────────────
  {
    section: 'Close',
    kicker: 'Honest assessment',
    title: 'Risks and open questions',
    lede: 'Stated now rather than discovered in September.',
    body: (
      <div className="space-y-3">
        <Table
          head={['Risk', 'Detail', 'Response']}
          rows={[
            ['Teams transcript access', 'App-only access to transcripts needs the right licensing and an application access policy.', 'Confirm before 25 Aug. Fallback: transcript export on meeting end.'],
            ['LinkedIn feed monitoring', 'The brief asks to scroll all latest posts. Terms prohibit it; the API does not expose the feed.', 'Rescope to permitted sources, or remove from scope.'],
            ['Canva automation depth', 'The API supports assets and templates, not arbitrary layout generation.', 'Prototype during architecture phase; Office fallback.'],
            ['AI draft quality', 'Drafts are only as good as the knowledge base behind them.', 'Seed with real past work early; measure on real tasks.'],
            ['Single point of failure', 'The automation layer becomes business-critical.', 'Self-hosted with backups; every workflow degrades to the current manual process.'],
          ]}
        />
        <Box accent="c">
          <strong className="text-ink-200">On scope.</strong> Two items — LinkedIn feed monitoring and
          full Canva generation — cannot be delivered exactly as written, because of platform limits
          rather than effort. Both are flagged so scope can be adjusted deliberately rather than
          quietly missed.
        </Box>
      </div>
    ),
  },

  // 21 ────────────────────────────────────────────────────────────────
  {
    section: 'Close',
    kicker: 'In one line',
    title: 'The business runs itself. You approve it.',
    body: (
      <div className="flex h-full flex-col justify-between">
        <Cols n={3}>
          <Box title="Captured once" accent="a">
            A meeting, an email or a form is the only input. Nothing is typed twice.
          </Box>
          <Box title="Drafted by AI" accent="b">
            Minutes, actions, emails, proposals, reports and posts arrive written, using your past
            work and your templates.
          </Box>
          <Box title="Approved by you" accent="c">
            Every client-facing artefact waits for you. Judgement stays where it belongs.
          </Box>
        </Cols>
        <p className="text-[11px] text-ink-600">
          Draft Plan · Business Structure Efficiency · 11 August 2026 · responds to the project brief
          dated 28 July 2026. Next: Schematic Architecture Plan, 25 August 2026.
        </p>
      </div>
    ),
  },
];
