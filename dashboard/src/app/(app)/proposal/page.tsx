import { Deck } from '@/components/Deck';
import { SLIDES } from './slides';

export const metadata = {
  title: 'Proposal — Business Structure Efficiency | BEXT Consultancy',
};

export default function ProposalPage() {
  return (
    <div className="space-y-5">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
          Client deliverable · Engagement B
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink-100">
          Business Structure Efficiency — Draft Plan
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          Due 11 August 2026. Use ← and → to present, or F for full screen.
        </p>
      </header>

      <Deck
        slides={SLIDES}
        footer="Transcribed from Project Brief — Business Structure Efficiency, 28 July 2026. Every review area in that brief is answered across these slides."
      />
    </div>
  );
}
