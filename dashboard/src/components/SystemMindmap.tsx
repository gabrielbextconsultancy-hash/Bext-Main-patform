/**
 * A radial concept map of the BEXT operating model — the same architecture as the
 * "Business Systems Integration Diagram" slide, drawn as a mind map so the whole
 * ecosystem reads at a glance: one centre, five branches, every platform hung off
 * the branch that owns it.
 *
 * Positions are computed, not hand-placed: each branch takes an equal slice of the
 * circle and fans its platforms across that slice. Colour carries meaning — the
 * same three tones the deck uses everywhere (teal = a system of record, purple =
 * AI/automation, amber = something you do), plus sky for inputs and emerald for the
 * AI workflows, so a glance tells you what kind of thing each node is.
 *
 * Single dark theme, matching the proposal deck. No animation, no client state.
 */

type Branch = {
  label: string;
  color: string;
  angle: number; // degrees, 0 = up, clockwise
  nodes: string[];
};

const CX = 470;
const CY = 340;

const BRANCHES: Branch[] = [
  { label: 'Capture', color: '#38bdf8', angle: -90, nodes: ['Teams', 'Outlook', 'Forms', 'LinkedIn'] },
  { label: 'AI & automation', color: '#a78bfa', angle: -18, nodes: ['n8n', 'Graph API', 'Claude', 'Copilot'] },
  { label: 'Systems of record', color: '#14b8a6', angle: 54, nodes: ['HubSpot', 'ProjectManager', 'SharePoint', 'Xero'] },
  { label: 'Output', color: '#fbbf24', angle: 126, nodes: ['Emails', 'Documents', 'Published', 'Power BI'] },
  { label: 'AI workflows', color: '#34d399', angle: 198, nodes: ['Meetings', 'Email', 'Marketing', 'Knowledge'] },
];

// 0deg = straight up, clockwise. SVG y grows downward, so up is -y.
function polar(cx: number, cy: number, deg: number, r: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function Node({
  x, y, w, label, color, kind,
}: { x: number; y: number; w: number; label: string; color: string; kind: 'center' | 'branch' | 'leaf' }) {
  const h = kind === 'center' ? 54 : kind === 'branch' ? 34 : 28;
  const rx = h / 2;
  const fill = kind === 'center' ? color : '#111a1f';
  const stroke = kind === 'center' ? color : color;
  const textFill = kind === 'center' ? '#08131a' : kind === 'branch' ? color : '#dfe7ea';
  const fs = kind === 'center' ? 17 : kind === 'branch' ? 12.5 : 11.5;
  const fw = kind === 'leaf' ? 400 : 600;
  return (
    <g>
      <rect
        x={x - w / 2} y={y - h / 2} width={w} height={h} rx={rx}
        fill={fill} stroke={stroke} strokeWidth={kind === 'center' ? 0 : 1.4}
        opacity={kind === 'leaf' ? 0.96 : 1}
      />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
        fontSize={fs} fontWeight={fw} fill={textFill}
        style={{ fontFamily: 'inherit', letterSpacing: kind === 'center' ? '0.02em' : 0 }}>
        {label}
      </text>
    </g>
  );
}

export function SystemMindmap() {
  const rBranch = 150;
  const rLeaf = 288;
  const leafSpread = 15; // degrees between fanned leaves

  const edges: React.ReactNode[] = [];
  const nodes: React.ReactNode[] = [];

  BRANCHES.forEach((b, bi) => {
    const bp = polar(CX, CY, b.angle, rBranch);
    // centre → branch
    edges.push(
      <line key={`e-c-${bi}`} x1={CX} y1={CY} x2={bp.x} y2={bp.y}
        stroke={b.color} strokeWidth={2} opacity={0.55} />,
    );
    const n = b.nodes.length;
    b.nodes.forEach((label, li) => {
      const off = (li - (n - 1) / 2) * leafSpread;
      const lp = polar(CX, CY, b.angle + off, rLeaf);
      edges.push(
        <line key={`e-${bi}-${li}`} x1={bp.x} y1={bp.y} x2={lp.x} y2={lp.y}
          stroke={b.color} strokeWidth={1.3} opacity={0.32} />,
      );
      nodes.push(
        <Node key={`n-${bi}-${li}`} x={lp.x} y={lp.y} w={Math.max(72, label.length * 7.2 + 22)}
          label={label} color={b.color} kind="leaf" />,
      );
    });
    nodes.push(
      <Node key={`b-${bi}`} x={bp.x} y={bp.y} w={Math.max(104, b.label.length * 7.4 + 24)}
        label={b.label} color={b.color} kind="branch" />,
    );
  });

  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 940 680" role="img"
        aria-label="Radial concept map of the BEXT operating model: a central BEXT node with five branches — Capture, AI and automation, Systems of record, Output, and AI workflows — each carrying its platforms."
        className="h-auto w-full"
        style={{ maxHeight: '78vh' }}
      >
        {edges}
        <Node x={CX} y={CY} w={132} label="BEXT" color="#14b8a6" kind="center" />
        <text x={CX} y={CY + 20} textAnchor="middle" fontSize={9} fill="#08131a" opacity={0.75}
          style={{ fontFamily: 'inherit', letterSpacing: '0.14em' }}>
          CAPTURE ONCE
        </text>
      </svg>
    </figure>
  );
}
