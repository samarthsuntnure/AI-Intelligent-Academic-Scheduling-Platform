import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="grid min-h-[70dvh] place-items-center rounded-3xl border border-border bg-card px-6 text-center" data-testid="state-not-found">
      <div>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Compass size={26} /></span>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[.2em] text-primary">Route not charted</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-[-.055em]">That view is not on the board.</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">The page you requested does not exist in this workspace. Head back to the operations overview.</p>
        <Link href="/" data-testid="link-back-overview" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-xs font-bold text-primary-foreground shadow-[0_8px_18px_hsl(var(--primary)/.16)] transition-all hover:-translate-y-0.5"><ArrowLeft size={15} /> Back to overview</Link>
      </div>
    </div>
  );
}
