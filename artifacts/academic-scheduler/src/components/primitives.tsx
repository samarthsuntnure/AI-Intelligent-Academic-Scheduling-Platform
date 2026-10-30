import { type ReactNode, type ElementType } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowRight, Check, ChevronRight, Inbox, RefreshCw, Search, X } from 'lucide-react';

export function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div className="animate-rise-in"><p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[.2em] text-primary">{eyebrow}</p><h1 className="text-3xl font-extrabold tracking-[-.055em] text-foreground sm:text-[40px]">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p></div>{action}</div>;
}

export function Button({ children, variant = 'primary', onClick, type = 'button', disabled, testId, className = '' }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean; testId?: string; className?: string }) {
  const styles = { primary: 'bg-primary text-primary-foreground shadow-[0_8px_18px_hsl(var(--primary)/.16)] hover:-translate-y-0.5', secondary: 'border border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary/5', ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground', danger: 'border border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10' };
  return <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}>{children}</button>;
}

export function MetricCard({ label, value, note, accent, icon: Icon }: { label: string; value: string | number; note: string; accent?: 'teal' | 'amber' | 'red' | 'blue'; icon: ElementType }) {
  const colors = { teal: 'text-primary bg-primary/10', amber: 'text-accent-foreground bg-accent/20', red: 'text-destructive bg-destructive/10', blue: 'text-chart-3 bg-chart-3/10' };
  return <div className="glass-panel group rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/25"><div className="mb-5 flex items-start justify-between"><span className="font-mono text-[10px] font-medium uppercase tracking-[.16em] text-muted-foreground">{label}</span><span className={`grid h-8 w-8 place-items-center rounded-lg ${colors[accent || 'teal']}`}><Icon size={16} /></span></div><p data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="text-3xl font-extrabold tracking-[-.055em]">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>;
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3" data-testid="state-loading">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>;
}

export function ErrorState({ onRetry, message = 'We could not load this view.' }: { onRetry: () => void; message?: string }) {
  return <div className="grid place-items-center rounded-2xl border border-destructive/20 bg-destructive/5 px-6 py-14 text-center" data-testid="state-error"><AlertTriangle className="mb-3 text-destructive" size={22} /><p className="text-sm font-bold">{message}</p><p className="mt-1 text-xs text-muted-foreground">Check the connection and try again.</p><Button variant="secondary" onClick={onRetry} testId="button-retry"><RefreshCw size={14} /> Retry</Button></div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center" data-testid="state-empty"><span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-muted text-muted-foreground"><Inbox size={19} /></span><p className="text-sm font-bold">{title}</p><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{description}</p>{action && <div className="mt-4">{action}</div>}</div>;
}

export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="text-sm font-extrabold tracking-[-.02em]">{title}</h2>{description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}</div>{action}</div>;
}

export function SearchInput({ value, onChange, placeholder, testId }: { value: string; onChange: (value: string) => void; placeholder: string; testId: string }) {
  return <label className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-muted-foreground transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10"><Search size={15} /><input data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70" /></label>;
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'blue' }) {
  const toneClass = { neutral: 'bg-muted text-muted-foreground', good: 'bg-primary/10 text-primary', warn: 'bg-accent/20 text-accent-foreground', bad: 'bg-destructive/10 text-destructive', blue: 'bg-chart-3/10 text-chart-3' };
  return <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[.08em] ${toneClass[tone]}`}>{tone === 'good' && <Check size={11} />}{children}</span>;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const modal = (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/35 p-4"
      data-testid="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 text-foreground shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2
            id="modal-title"
            className="text-lg font-extrabold tracking-[-.035em]"
          >
            {title}
          </h2>

          <button
            type="button"
            onClick={onClose}
            data-testid="button-close-modal"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close dialog"
          >
            <X size={17} />
          </button>
        </div>

        {children}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export function SmallArrow() { return <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />; }
export function Chevron() { return <ChevronRight size={15} />; }
