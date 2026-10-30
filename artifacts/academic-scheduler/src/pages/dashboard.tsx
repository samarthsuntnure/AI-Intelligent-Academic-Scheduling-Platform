import { useMemo, useState } from 'react';
import { Activity, ArrowUpRight, CalendarClock, CheckCircle2, CircleAlert, Clock3, FileCheck2, Gauge, Sparkles, UsersRound } from 'lucide-react';
import { Link } from 'wouter';
import { useGetDashboardSummary, useGetTimetable, useGetTimetableConflicts } from '@workspace/api-client-react';
import { Button, ErrorState, LoadingState, MetricCard, PageIntro, SectionHeading, StatusPill } from '@/components/primitives';

export default function Dashboard() {
  const summaryQuery = useGetDashboardSummary();
  const timetableQuery = useGetTimetable();
  const conflictsQuery = useGetTimetableConflicts();
  const [notice, setNotice] = useState('');
  const [generating, setGenerating] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);

  async function refreshAfterGeneration() {
    summaryQuery.refetch();
    timetableQuery.refetch();
    conflictsQuery.refetch();
  }

  async function handleGenerate() {
    setGenerating(true);
    setNotice('');
    try {
      const res = await fetch('/api/timetable/generate', { method: 'POST' });
      if (!res.ok) throw new Error(`Request failed with ${res.status}`);
      const data: { sessionsScheduled: number; conflictsFound: number } = await res.json();
      setNotice(
        data.conflictsFound
          ? `Draft generated: ${data.sessionsScheduled} sessions — ${data.conflictsFound} item(s) need review. Review it in Timetable before publishing.`
          : `Draft generated: ${data.sessionsScheduled} sessions with no conflicts. Review it in Timetable before publishing.`,
      );
      refreshAfterGeneration();
    } catch (err) {
      setNotice('Could not generate a timetable — check that the API server is running.');
    } finally {
      setGenerating(false);
    }
  }

  /*
   * Admin-only: type an instruction like "make the table for division
   * AIML-B" and the agent regenerates just that division's timetable —
   * still using the deterministic, conflict-free scheduler underneath.
   */
  async function handleAgentPrompt() {
    if (!agentPrompt.trim()) return;
    setAgentBusy(true);
    setNotice('');
    try {
      const res = await fetch('/api/timetable/generate-from-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: agentPrompt.trim() }),
      });
      if (!res.ok) throw new Error(`Request failed with ${res.status}`);
      const data: { message: string } = await res.json();
      setNotice(data.message);
      setAgentPrompt('');
      refreshAfterGeneration();
    } catch (err) {
      setNotice('Could not run that request — check that the API server is running.');
    } finally {
      setAgentBusy(false);
    }
  }
  const summary = summaryQuery.data;
  const upcoming = useMemo(() => (timetableQuery.data || []).slice(0, 4), [timetableQuery.data]);
  const conflicts = useMemo(() => (conflictsQuery.data || []).slice(0, 3), [conflictsQuery.data]);
  const loadError = summaryQuery.isError || timetableQuery.isError || conflictsQuery.isError;

  if (summaryQuery.isLoading) return <><PageIntro eyebrow="Command center" title="Welcome to VIT." description="A clear read on the academic operation, from enrollment to the next timetable run." /><LoadingState rows={5} /></>;
  if (loadError || !summary) return <><PageIntro eyebrow="Command center" title="Welcome to VIT." description="A clear read on the academic operation, from enrollment to the next timetable run." /><ErrorState onRetry={() => { summaryQuery.refetch(); timetableQuery.refetch(); conflictsQuery.refetch(); }} /></>;

  const utilization = Math.min(100, Math.round(summary.facultyUtilization));
  return <div className="animate-rise-in">
    <PageIntro eyebrow="Command center · VIT Academic Management" title="Welcome to VIT." description="A clear read on the academic operation, from enrollment to the next timetable run." action={<Button onClick={handleGenerate} disabled={generating} testId="button-generate-timetable"><Sparkles size={15} /> {generating ? 'Generating draft…' : 'Generate draft timetable'}</Button>} />
    {notice && <div className="mb-6 flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-primary" data-testid="status-generation-request"><span className="flex items-center gap-2"><CheckCircle2 size={15} />{notice}</span><button onClick={() => setNotice('')} data-testid="button-dismiss-notice">Dismiss</button></div>}
    <div className="mb-6 rounded-2xl border border-border bg-card p-4">
      <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground"><Sparkles size={12} /> AI scheduling agent · admin only</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={agentPrompt}
          onChange={(e) => setAgentPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !agentBusy) handleAgentPrompt(); }}
          placeholder='e.g. "make the table for division AIML-B" or "regenerate all divisions"'
          data-testid="input-agent-prompt"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary/40"
        />
        <Button onClick={handleAgentPrompt} disabled={agentBusy || !agentPrompt.trim()} testId="button-agent-generate">
          {agentBusy ? 'Working…' : 'Run'}
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Generate creates a reviewable draft. The last published timetable stays live for students/faculty until the admin reviews and publishes the new draft.</p>
    </div>
    <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <MetricCard label="Students" value={summary.students} note="Across active divisions" icon={UsersRound} accent="blue" />
      <MetricCard label="Faculty" value={summary.faculty} note="Teaching this semester" icon={UsersRound} accent="teal" />
      <MetricCard label="Subjects" value={summary.subjects} note="In current catalog" icon={FileCheck2} accent="amber" />
      <MetricCard label="Scheduled classes" value={summary.scheduledClasses} note="Of planned sessions" icon={CalendarClock} accent="teal" />
      <MetricCard label="Open conflicts" value={summary.conflicts} note={summary.conflicts ? 'Needs coordinator review' : 'Nothing blocking'} icon={CircleAlert} accent={summary.conflicts ? 'red' : 'teal'} />
    </div>
    <div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <SectionHeading title="Schedule pulse" description="Where the week stands right now." action={<Link href="/timetable" data-testid="link-view-timetable" className="group inline-flex items-center gap-1 text-xs font-bold text-primary">Open timetable <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5" /></Link>} />
        <div className="mb-6 grid gap-4 border-b border-border pb-6 sm:grid-cols-[1fr_1fr]">
          <div className="rounded-xl bg-muted/65 p-4"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">Faculty load</span><Gauge size={15} className="text-primary" /></div><div className="flex items-end justify-between"><span className="text-3xl font-extrabold tracking-[-.06em]">{utilization}<span className="text-lg text-muted-foreground">%</span></span><StatusPill tone={utilization > 85 ? 'warn' : 'good'}>{utilization > 85 ? 'Near capacity' : 'Balanced'}</StatusPill></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${utilization}%` }} /></div></div>
          <div className="rounded-xl bg-[#f9f5e9] p-4 dark:bg-accent/10"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold text-accent-foreground/70">Next generation</span><Clock3 size={15} className="text-accent-foreground/70" /></div><p className="text-lg font-extrabold tracking-[-.04em]">{summary.nextGeneration ? new Date(summary.nextGeneration).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Not scheduled'}</p><p className="mt-1 text-xs text-accent-foreground/65">{summary.nextGeneration ? new Date(summary.nextGeneration).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : 'Ready when you are'}</p><div className="mt-4 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-accent-foreground/70"><Activity size={12} /> AI constraint check ready</div></div>
        </div>
        <div className="space-y-1">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Next on the board</p>
          {upcoming.length ? upcoming.map((entry) => <div key={entry.id} className="group flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-muted/60" data-testid={`row-upcoming-${entry.id}`}><div className="w-[82px] shrink-0 font-mono text-[10px] text-muted-foreground">{entry.day}<br /><span className="text-foreground">{entry.time}</span></div><div className="h-9 w-1 rounded-full bg-primary/60" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{entry.subject}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{entry.faculty} · {entry.room}</p></div><StatusPill tone={entry.status.toLowerCase().includes('conflict') ? 'bad' : 'good'}>{entry.status}</StatusPill></div>) : <p className="py-8 text-center text-xs text-muted-foreground">No sessions scheduled yet.</p>}
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <SectionHeading title="Needs attention" description={conflicts.length ? 'Review before publishing the week.' : 'The board is in good shape.'} action={summary.conflicts > 3 && <Link href="/timetable" data-testid="link-view-conflicts" className="text-xs font-bold text-primary">View all</Link>} />
        <div className="space-y-3">
          {conflicts.length ? conflicts.map((conflict) => <div key={conflict.id} className="rounded-xl border border-border bg-background/55 p-3.5 transition hover:border-destructive/30" data-testid={`card-conflict-${conflict.id}`}><div className="mb-2 flex items-center justify-between"><StatusPill tone={conflict.severity.toLowerCase() === 'high' || conflict.severity.toLowerCase() === 'critical' ? 'bad' : 'warn'}>{conflict.severity}</StatusPill><span className="font-mono text-[10px] text-muted-foreground">{conflict.category}</span></div><p className="text-xs font-bold">{conflict.title}</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{conflict.detail}</p></div>) : <div className="grid place-items-center py-12 text-center"><CheckCircle2 size={25} className="mb-3 text-primary" /><p className="text-sm font-bold">No conflicts detected</p><p className="mt-1 text-xs text-muted-foreground">All current constraints are satisfied.</p></div>}
        </div>
        <Link href="/timetable" data-testid="link-audit-schedule" className="mt-5 flex items-center justify-between rounded-xl border border-border px-3.5 py-3 text-xs font-bold transition hover:border-primary/30 hover:bg-primary/5"><span>Audit full schedule</span><ArrowUpRight size={14} className="text-primary" /></Link>
      </section>
    </div>
  </div>;
}