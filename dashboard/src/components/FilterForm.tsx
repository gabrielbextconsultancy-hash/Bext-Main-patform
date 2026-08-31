'use client';

/**
 * The filter row, which applies itself.
 *
 * It stays a plain GET form — the filters live in the URL, so a filtered view
 * is linkable, survives a refresh and works with the back button, none of which
 * client-side state gives for free. The only thing added is submitting on
 * change: choosing a source and then having to find a button is a step that
 * exists for the form's benefit rather than the reader's.
 *
 * Selects submit the moment they change. The text box does not — submitting on
 * every keystroke would reload the table mid-word — so it submits on Enter,
 * which a GET form already does natively, or when focus leaves it.
 */
export function FilterForm({
  action,
  className,
  children,
}: {
  action: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      method="get"
      action={action}
      className={className}
      onChange={e => {
        const t = e.target as HTMLElement;
        if (t.tagName === 'SELECT') (e.currentTarget as HTMLFormElement).requestSubmit();
      }}
      onBlur={e => {
        const t = e.target as unknown as HTMLInputElement;
        if (t.tagName !== 'INPUT' || t.type !== 'search') return;
        // Only when the value actually changed, or leaving an untouched box
        // would reload the page for nothing.
        if (t.value !== t.defaultValue) (e.currentTarget as HTMLFormElement).requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
