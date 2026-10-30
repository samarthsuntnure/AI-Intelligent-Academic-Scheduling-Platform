import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Check, Edit3, Plus, Trash2, Users, X, Send, FileClock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetTimetableQueryKey, useGetTimetable, useGetTimetableConflicts, useListFaculty, useListStudents, useListSubjects } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, LoadingState, Modal, PageIntro, SectionHeading, StatusPill } from '@/components/primitives';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SLOTS = ['8:00–9:00','9:00–10:00','10:00–11:00','11:00–12:00','12:00–1:00','1:00–2:00','2:00–3:00','3:00–4:00','4:00–5:00','5:00–6:00'];
const LAB_TIMES = ['8:00–10:00','9:00–11:00','2:00–4:00','3:00–5:00','4:00–6:00'];

type Entry = any;
type Room = { id: number; roomNumber: string; capacity: number; roomType: string };
const ONLINE_CODES = new Set(['COURSERA1', 'COURSERA2', 'DT']);
const isOnlineSubject = (code: string) => ONLINE_CODES.has(String(code).split(' · ')[0].trim().toUpperCase());
const baseDivision = (value: unknown) => String(value ?? '').split(' · ')[0].trim();

export default function Timetable() {
  const qc = useQueryClient();
  const timetable = useGetTimetable();
  const conflicts = useGetTimetableConflicts();
  const faculty = useListFaculty();
  const students = useListStudents();
  const subjects = useListSubjects();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [division, setDivision] = useState('ALL');
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [autoGenerationAttempted, setAutoGenerationAttempted] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishNotice, setPublishNotice] = useState('');
  const [validating, setValidating] = useState(false);
  const [form, setForm] = useState({ day: 'Monday', time: '8:00–9:00', subject: '', facultyId: '', roomId: '', division: '', classType: 'Theory', batch: '', batchSize: '' });

  async function loadRooms() {
    const r = await fetch('/api/classrooms', { credentials: 'include' }).then((x) => x.json());
    setRooms(Array.isArray(r) ? r : []);
  }
  useEffect(() => { loadRooms().catch(() => setError('Could not load rooms.')); }, []);

  const rawEntries = (timetable.data || []) as Entry[];
  const draftEntries = rawEntries.filter((e) => e.status === 'draft');
  const publishedEntries = rawEntries.filter((e) => e.status === 'published');
  // Admin review always focuses on the draft when one exists. Published rows
  // remain in the database so students/faculty keep seeing the last approved
  // timetable until the admin explicitly publishes the draft.
  const allEntries = draftEntries.length ? draftEntries : publishedEntries;
  const divisions = useMemo(() => {
    const fromStudents = (students.data || []).map((s: any) => baseDivision(s.division)).filter(Boolean);
    const fromTimetable = allEntries.map((e) => baseDivision(e.division)).filter(Boolean);
    return Array.from(new Set([...fromStudents, ...fromTimetable])).sort();
  }, [students.data, allEntries]);
  const hasScheduleForEveryDivision = divisions.every((d) =>
    allEntries.some((entry) => baseDivision(entry.division) === d),
  );
  const activeDivision = division !== 'ALL' && divisions.includes(division) ? division : '';
  const entries = allEntries.filter((e) => {
    if (!activeDivision) return true;
    const rawDivision = String(e.division);
    return baseDivision(rawDivision) === activeDivision || baseDivision(rawDivision) === '__SHARED_MLOPS__';
  });
  const conflictCount = conflicts.data?.length || 0;

  // A first visit to Timetable should show the generated week instead of an
  // empty grid. Generate only when there is no draft or published schedule;
  // existing reviewed/published timetables are never replaced on page load.
  useEffect(() => {
    if (
      autoGenerationAttempted || autoGenerating || timetable.isLoading ||
      timetable.isError || students.isLoading || students.isError ||
      hasScheduleForEveryDivision || !divisions.length
    ) return;

    setAutoGenerationAttempted(true);
    setAutoGenerating(true);
    setError('');
    fetch('/api/timetable/generate', { method: 'POST', credentials: 'include' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Could not generate the timetable.');
        await Promise.all([
          qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() }),
          qc.invalidateQueries({ queryKey: ['/api/timetable/conflicts'] }),
        ]);
        await timetable.refetch();
        await conflicts.refetch();
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not generate the timetable.'))
      .finally(() => setAutoGenerating(false));
  }, [autoGenerationAttempted, autoGenerating, timetable.isLoading, timetable.isError, hasScheduleForEveryDivision, students.isLoading, students.isError, divisions.length, qc]);

  function openCreate() {
    setEditing(null); setError('');
    setForm({ day: 'Monday', time: '8:00–9:00', subject: subjects.data?.[0]?.code || '', facultyId: faculty.data?.[0]?.id ? String(faculty.data[0].id) : '', roomId: rooms[0]?.id ? String(rooms[0].id) : '', division: activeDivision || divisions[0] || '', classType: 'Theory', batch: '', batchSize: '' });
    setManualOpen(true);
  }
  function openEdit(entry: Entry) {
    const subjectCode = String(entry.subject).split(' · ')[0];
    setEditing(entry); setError('');
    const person = faculty.data?.find((f: any) => f.name === entry.faculty);
    const room = rooms.find((r) => r.roomNumber === entry.room);
    setForm({ day: entry.day, time: entry.time, subject: subjectCode, facultyId: person ? String(person.id) : '', roomId: entry.room === 'Online' ? '0' : (room ? String(room.id) : ''), division: String(entry.division), classType: entry.classType || 'Theory', batch: entry.batch || '', batchSize: entry.batchSize ? String(entry.batchSize) : '' });
    setManualOpen(true);
  }
  async function save() {
    setError('');
    if (!form.division) { setError('Select a division before creating the session.'); return; }
    if (!form.subject) { setError('Select a subject before creating the session.'); return; }
    if (!form.facultyId || Number(form.facultyId) <= 0) { setError('Select a faculty member before creating the session.'); return; }
    if (!form.day || !form.time) { setError('Select a day and time before creating the session.'); return; }
    const online = isOnlineSubject(form.subject);
    if (!online && (!form.roomId || Number(form.roomId) <= 0)) { setError('Select a physical classroom for this session.'); return; }
    if (online && Number(form.roomId) !== 0) { setError('Online sessions must use the Online / no physical room option.'); return; }
    if (form.classType === 'Lab' && (!form.batch || !form.batchSize || Number(form.batchSize) <= 0)) { setError('Lab sessions require a batch name and a positive batch size.'); return; }
    setSaving(true);
    try {
      const subject = (subjects.data || []).find((s: any) => s.code === form.subject && String(s.type || '').toLowerCase() === form.classType.toLowerCase()) || (subjects.data || []).find((s: any) => s.code === form.subject);
      const payload = { ...form, subject: subject ? `${subject.code} · ${subject.name}` : form.subject, facultyId: Number(form.facultyId), roomId: Number(form.roomId), batch: form.batch || null, batchSize: form.batchSize ? Number(form.batchSize) : null };
      const response = await fetch(editing ? `/api/timetable/${editing.id}` : '/api/timetable/manual', { method: editing ? 'PUT' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || 'The entry could not be saved.'); return; }
      setManualOpen(false); await qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The server could not create the timetable session. Make sure the API is running.');
    } finally { setSaving(false); }
  }
  async function remove(entry: Entry) {
    if (!window.confirm(`Delete ${entry.subject} from ${entry.day} ${entry.time}?`)) return;
    const response = await fetch(`/api/timetable/${entry.id}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) return setError('Could not delete the timetable entry.');
    await qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() });
  }

  async function validateDraft() {
    setError(''); setPublishNotice(''); setValidating(true);
    try {
      const response = await fetch('/api/timetable/validate', { method: 'POST', credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.issues?.[0]?.error || body.error || 'The draft still has validation issues.');
        await qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() });
        return;
      }
      setPublishNotice('Draft validation passed. The timetable is ready for admin approval.');
      await qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() });
    } finally { setValidating(false); }
  }

  async function publishDraft() {
    setError(''); setPublishNotice(''); setPublishing(true);
    try {
      const response = await fetch('/api/timetable/publish', { method: 'POST', credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || 'The draft could not be published.'); return; }
      setPublishNotice(`Published ${body.publishedSessions || 0} reviewed sessions.`);
      await qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() });
    } finally { setPublishing(false); }
  }

  const slotEntries = (day: string, slot: string) => entries.filter((e) => e.day === day && (e.time === slot || (e.classType === 'Lab' && `${e.time}`.split('–')[0].trim() === slot.split('–')[0].trim())));

  if (timetable.isLoading || conflicts.isLoading || faculty.isLoading || students.isLoading || subjects.isLoading) return <><PageIntro eyebrow="Planning surface" title="Weekly timetable" description="Conflict-safe teaching plan for Monday–Saturday, 08:00 AM–06:00 PM. Sunday is always a holiday." /><LoadingState rows={8} /></>;
  if (timetable.isError || conflicts.isError) return <><PageIntro eyebrow="Planning surface" title="Weekly timetable" description="Conflict-safe teaching plan for Monday–Saturday, 08:00 AM–06:00 PM." /><ErrorState onRetry={() => { timetable.refetch(); conflicts.refetch(); }} /></>;

  return <div className="animate-rise-in">
    <PageIntro eyebrow="Planning surface · VIT" title="Weekly timetable" description="Generate a draft, review every session, make validated manual changes, then publish the approved week." action={<div className="flex flex-wrap gap-2"><Button variant={showConflicts ? 'primary' : 'secondary'} onClick={() => setShowConflicts(!showConflicts)} testId="button-toggle-conflicts"><AlertTriangle size={15} /> {conflictCount ? `${conflictCount} conflicts` : 'No conflicts'}</Button>{draftEntries.length > 0 && <><Button variant="secondary" onClick={validateDraft} disabled={validating} testId="button-validate-timetable"><Check size={15} /> {validating ? 'Validating…' : 'Validate draft'}</Button><Button onClick={publishDraft} disabled={publishing || conflictCount > 0} testId="button-publish-timetable"><Send size={15} /> {publishing ? 'Publishing…' : 'Publish approved draft'}</Button></>}<Button onClick={openCreate} testId="button-add-manual-session"><Plus size={15} /> Manual session</Button></div>} />
    {publishNotice && <div className="mb-5 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs font-semibold text-primary"><Check size={15} /> {publishNotice}</div>}
    {draftEntries.length > 0 && <div className="mb-5 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"><FileClock size={18} className="text-primary" /><div><p className="text-xs font-extrabold">Draft review mode</p><p className="mt-1 text-[11px] text-muted-foreground">The generated timetable is not visible to students/faculty until you publish it. Edit any lecture or lab, resolve warnings, then publish.</p></div></div>}
    <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto_auto]">
      <select value={division} onChange={(e) => setDivision(e.target.value)} className="rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-bold outline-none focus:border-primary"><option value="ALL">All divisions</option>{divisions.map((d) => <option key={d}>{d}</option>)}</select>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 text-[11px] font-semibold text-muted-foreground"><CalendarDays size={14} className="text-primary" /> Monday – Saturday</div>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 text-[11px] font-semibold text-muted-foreground"><Check size={14} className="text-primary" /> Sunday holiday</div>
    </div>
    <div className="mb-5 flex flex-wrap gap-2">
      <button onClick={() => setDivision('ALL')} className={`rounded-full border px-3 py-1.5 text-[11px] font-extrabold transition ${division === 'ALL' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/30'}`}>All divisions</button>
      {divisions.map((d) => <button key={d} onClick={() => setDivision(d)} className={`rounded-full border px-3 py-1.5 text-[11px] font-extrabold transition ${division === d ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/30'}`}>{d}</button>)}
    </div>
    {showConflicts && <section className="mb-5 rounded-2xl border border-destructive/20 bg-destructive/5 p-5"><SectionHeading title="Validation report" description="Generation and manual edits are rejected when a faculty, room or division would overlap." />{conflicts.data?.length ? <div className="grid gap-2 md:grid-cols-2">{conflicts.data.map((c: any) => <div key={c.id} className="rounded-xl border border-destructive/15 bg-background/60 p-3"><StatusPill tone="bad">{c.severity}</StatusPill><p className="mt-2 text-xs font-bold">{c.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{c.detail}</p></div>)}</div> : <div className="flex items-center gap-2 text-xs font-semibold text-primary"><Check size={15} /> All known generated constraints are satisfied.</div>}</section>}
    {!entries.length ? <EmptyState title={autoGenerating ? 'Generating timetable' : 'No timetable yet'} description={autoGenerating ? 'Building the weekly timetable for all divisions from the active subjects and student choices. This can take a little while.' : error || 'No timetable sessions were generated. Review the academic data and try again.'} action={autoGenerating ? undefined : <Button onClick={async () => { setAutoGenerationAttempted(false); setError(''); }} testId="button-retry-timetable-generation">Retry generation</Button>} /> : <section className="overflow-auto rounded-2xl border border-border bg-card shadow-sm"><div className="min-w-[1080px]"><div className="grid grid-cols-[105px_repeat(6,1fr)] border-b border-border bg-muted/40"><div className="p-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Time</div>{DAYS.map((d) => <div key={d} className="border-l border-border p-4"><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{d.slice(0,3)}</p><p className="mt-1 text-xs font-extrabold">{d}</p></div>)}</div>{SLOTS.map((slot) => <div key={slot} className="grid grid-cols-[105px_repeat(6,1fr)]"><div className="min-h-[110px] border-b border-border p-3 font-mono text-[10px] text-muted-foreground">{slot}</div>{DAYS.map((day) => { const cell = slotEntries(day, slot); return <div key={`${day}-${slot}`} className="min-h-[110px] border-b border-l border-border p-1.5">{cell.map((e) => <div key={e.id} className="group relative mb-1.5 rounded-xl border border-primary/20 bg-primary/5 p-2.5"><div className="pr-8"><div className="flex flex-wrap gap-1"><StatusPill tone={e.classType === 'Lab' ? 'warn' : e.classType === 'Tutorial' ? 'blue' : 'good'}>{e.classType}</StatusPill>{e.batch && <StatusPill>{e.batch}</StatusPill>}</div><p className="mt-1 text-[11px] font-extrabold leading-4">{e.subject}</p>{e.division === '__SHARED_MLOPS__' && <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-primary">Shared MLOPS cohort</p>}<p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><Users size={11} /> {e.faculty}</p><p className="text-[10px] text-muted-foreground">Room {e.room}</p></div><div className="absolute right-1.5 top-1.5 flex opacity-0 transition group-hover:opacity-100"><button onClick={() => openEdit(e)} className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-primary" title="Edit"><Edit3 size={12} /></button><button onClick={() => remove(e)} className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-destructive" title="Delete"><Trash2 size={12} /></button></div></div>)}</div>; })}</div>)}</div></section>}
    <div className="mt-5 grid gap-3 md:grid-cols-5"><Info label="Review sessions" value={String(entries.length)} /><Info label="Divisions" value={String(divisions.length)} /><Info label="Generated conflicts" value={String(conflictCount)} /><Info label="Draft / published" value={`${draftEntries.length} / ${publishedEntries.length}`} /><Info label="Operating window" value="08:00–18:00" /></div>
    {manualOpen && <Modal title={editing ? 'Edit timetable session' : 'Create manual timetable session'} onClose={() => setManualOpen(false)}><div className="space-y-4"><Field label="Division" value={form.division} onChange={(v) => setForm({ ...form, division: v })} options={divisions.map((d) => ({ value: d, label: d }))} /><Field label="Subject" value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} options={(subjects.data || []).map((s: any) => ({ value: s.code, label: `${s.code} · ${s.name} · ${s.type}` }))} /><Field label="Class type" value={form.classType} onChange={(v) => setForm({ ...form, classType: v, time: v === 'Lab' ? LAB_TIMES[0] : SLOTS[0] })} options={['Theory','Lab','Tutorial'].map((v) => ({ value: v, label: v }))} /><div className="grid gap-3 sm:grid-cols-2"><Field label="Day" value={form.day} onChange={(v) => setForm({ ...form, day: v })} options={DAYS.map((d) => ({ value: d, label: d }))} /><Field label="Time" value={form.time} onChange={(v) => setForm({ ...form, time: v })} options={(form.classType === 'Lab' ? LAB_TIMES : SLOTS).map((v) => ({ value: v, label: v }))} /></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Faculty" value={form.facultyId} onChange={(v) => setForm({ ...form, facultyId: v })} options={(faculty.data || []).map((f: any) => ({ value: String(f.id), label: f.name }))} /><Field label="Room / mode" value={form.roomId} onChange={(v) => setForm({ ...form, roomId: v })} options={[...(isOnlineSubject(form.subject) ? [{ value: '0', label: 'Online · no physical room' }] : []), ...rooms.filter((r) => form.classType === 'Lab' ? r.roomType.toUpperCase().includes('LAB') : !r.roomType.toUpperCase().includes('LAB')).map((r) => ({ value: String(r.id), label: `${r.roomNumber} · cap ${r.capacity}` }))]} /></div>{form.classType === 'Lab' && <div className="grid gap-3 sm:grid-cols-2"><TextField label="Batch" value={form.batch} onChange={(v) => setForm({ ...form, batch: v })} placeholder="Batch A" /><TextField label="Batch size" value={form.batchSize} onChange={(v) => setForm({ ...form, batchSize: v })} placeholder="35" /></div>}{error && <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs font-semibold text-destructive">{error}</div>}<div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={() => setManualOpen(false)} testId="button-cancel-manual">Cancel</Button><Button onClick={save} disabled={saving} testId="button-save-manual">{saving ? 'Saving…' : editing ? 'Save changes' : 'Create session'}</Button></div></div></Modal>}
  </div>;
}
function Field({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs outline-none focus:border-primary"><option value="">Select {label.toLowerCase()}</option>{options.map((o) => <option key={`${o.value}-${o.label}`} value={o.value}>{o.label}</option>)}</select></label>; }
function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold">{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs outline-none focus:border-primary" /></label>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-border bg-card p-3.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{label}</p><p className="mt-1 text-lg font-extrabold">{value}</p></div>; }
