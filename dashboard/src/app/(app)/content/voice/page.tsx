import Link from 'next/link';
import { getVoice } from '@/lib/queries';
import { DatabaseDown, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The voice and rules every draft is written to. Read-only here: the profile is
 * seeded in the migration and, when the client wants a change, edited through the
 * update_voice action. Shown so a reviewer can see exactly what the drafter was
 * told before judging what it produced.
 */
export default async function VoicePage() {
  const voice = await getVoice();
  if (voice === null) return <DatabaseDown />;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/content" className="text-xs text-ink-500 transition hover:text-ink-300">← Content Generation</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink-100">Voice &amp; rules</h1>
        <p className="mt-1 text-sm text-ink-400">What every draft is written to. Change it through the client, not by hand.</p>
      </div>

      {!voice ? (
        <Card>The voice profile has not been seeded. Run migration 025.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Who is speaking">
            <p className="text-sm text-ink-200">{voice.author}</p>
            <p className="mt-2 text-[13px] text-ink-400">{voice.audience}</p>
          </Card>
          <Card title="How it sounds">
            <p className="text-[13px] text-ink-300">{voice.fingerprint}</p>
          </Card>
          <Card title="Pillars">
            <ul className="flex flex-wrap gap-1.5">
              {voice.pillars.map((p) => (
                <li key={p} className="rounded-full border border-ink-700 bg-ink-800 px-2 py-0.5 text-[12px] text-ink-300">{p}</li>
              ))}
            </ul>
          </Card>
          <Card title="Posting windows (Australia/Melbourne)">
            <ul className="space-y-1 text-[13px] text-ink-300">
              {voice.post_windows.map((w, i) => (
                <li key={i}>{['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][w.day]} · {w.from}–{w.to}</li>
              ))}
            </ul>
          </Card>
          <Card title="Always" className="lg:col-span-1">
            <ul className="list-disc space-y-1 pl-4 text-[13px] text-ink-300">
              {voice.always_rules.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </Card>
          <Card title="Never" className="lg:col-span-1">
            <ul className="list-disc space-y-1 pl-4 text-[13px] text-ink-300">
              {voice.never_rules.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </Card>
          {voice.banned_terms.length > 0 && (
            <Card title="Banned words" className="lg:col-span-2">
              <p className="text-[12px] leading-relaxed text-ink-500">{voice.banned_terms.join(' · ')}</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
