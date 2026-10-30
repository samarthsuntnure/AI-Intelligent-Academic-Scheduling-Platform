import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, Check, Plus, Trash2, UserCog, Users, DoorOpen, FlaskConical, Save } from 'lucide-react';
import { useListFaculty, useListStudents, useListSubjects } from '@workspace/api-client-react';
import { Button, EmptyState, LoadingState, Modal, PageIntro, SectionHeading, StatusPill } from '@/components/primitives';

type Assignment = { id: number; subjectCode: string; division: string; facultyId: number; facultyName: string | null };
type Holiday = { id: number; division: string; day: string };
type Room = { id: number; roomNumber: string; building?: string | null; capacity: number; roomType: string };
type Batch = { id: number; division: string; subjectCode: string | null; batchName: string; studentCount: number };
type RoomAssignment = { id: number; division: string; roomId: number; classType: string; subjectCode: string | null; batchName: string | null; roomNumber: string | null };

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TABS = [
  { key: 'faculty', label: 'Faculty', icon: UserCog },
  { key: 'batches', label: 'Lab batches', icon: Users },
  { key: 'rooms', label: 'Rooms & labs', icon: DoorOpen },
  { key: 'holidays', label: 'Holidays', icon: CalendarClock },
] as const;

export default function Planning() {
  const faculty = useListFaculty();
  const students = useListStudents();
  const subjects = useListSubjects();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [roomAssignments, setRoomAssignments] = useState<RoomAssignment[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [divisions, setDivisions] = useState<string[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('faculty');
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [subjectCode, setSubjectCode] = useState('');
  const [division, setDivision] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [holidayDivision, setHolidayDivision] = useState('');
  const [holidayDay, setHolidayDay] = useState('Saturday');
  const [batchSubject, setBatchSubject] = useState('');
  const [batchDivision, setBatchDivision] = useState('');
  const [batchRows, setBatchRows] = useState([{ batchName: 'Batch A', studentCount: '' }, { batchName: 'Batch B', studentCount: '' }]);
  const [roomDivision, setRoomDivision] = useState('');
  const [roomType, setRoomType] = useState<'Theory' | 'Tutorial' | 'Lab'>('Theory');
  const [roomId, setRoomId] = useState('');
  const [roomSubject, setRoomSubject] = useState('');
  const [roomBatch, setRoomBatch] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const [a, h, s, b, ra, r] = await Promise.all([
      fetch('/api/subject-faculty-assignments', { credentials: 'include' }).then((x) => x.json()),
      fetch('/api/division-holidays', { credentials: 'include' }).then((x) => x.json()),
      fetch('/api/students', { credentials: 'include' }).then((x) => x.json()),
      fetch('/api/planning/lab-batches', { credentials: 'include' }).then((x) => x.json()),
      fetch('/api/planning/room-assignments', { credentials: 'include' }).then((x) => x.json()),
      fetch('/api/classrooms', { credentials: 'include' }).then((x) => x.json()),
    ]);
    setAssignments(Array.isArray(a) ? a : []);
    setHolidays(Array.isArray(h) ? h : []);
    setBatches(Array.isArray(b) ? b : []);
    setRoomAssignments(Array.isArray(ra) ? ra : []);
    setRooms(Array.isArray(r) ? r : []);
    const unique = Array.from(new Set((Array.isArray(s) ? s : []).map((x: any) => String(x.division)).filter(Boolean))).sort();
    setDivisions(unique);
  }

  useEffect(() => { load().catch(() => setError('Could not load planning settings.')); }, []);

  const assignmentRows = useMemo(() => assignments.slice().sort((a, b) => `${a.division}${a.subjectCode}`.localeCompare(`${b.division}${b.subjectCode}`)), [assignments]);
  const labRooms = useMemo(() => rooms.filter((r) => r.roomType.toUpperCase().includes('LAB')), [rooms]);
  const teachingSubjects = useMemo(() => (subjects.data || []).filter((s: any) => s.code && s.type), [subjects.data]);
  const commonSubjects = useMemo(() => Array.from(new Map(teachingSubjects.filter((s: any) => !['CN', 'MLOPS'].includes(String(s.code).toUpperCase())).map((s: any) => [s.code, s])).values()), [teachingSubjects]);
  const batchSubjectOptions = useMemo(() => [
    { value: '', label: 'All lab subjects' },
    { value: 'CN', label: 'CN · choice lab' },
    ...commonSubjects.filter((s: any) => String(s.type).toLowerCase() === 'lab').map((s: any) => ({ value: s.code, label: `${s.code} · ${s.name}` })),
  ], [commonSubjects]);
  const selectedDivisionStudentCount = useMemo(() => {
    if (!batchDivision) return 0;
    return (students.data || []).filter((s: any) => String(s.division) === batchDivision).length;
  }, [students.data, batchDivision]);

  function openBatchEditor() {
    const max = Math.max(1, ...labRooms.map((r) => r.capacity));
    const total = selectedDivisionStudentCount || 70;
    const first = Math.min(total, max);
    const second = Math.max(0, total - first);
    setBatchRows([
      { batchName: 'Batch A', studentCount: String(first) },
      ...(second ? [{ batchName: 'Batch B', studentCount: String(second) }] : []),
    ]);
    setError('');
    setBatchOpen(true);
  }

  async function saveAssignment() {
    setError('');
    if (!subjectCode || !division || !facultyId) return setError('Choose a subject, division and faculty member.');
    const response = await fetch('/api/subject-faculty-assignments', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subjectCode, division, facultyId: Number(facultyId) }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setError(body.error || 'Could not save faculty assignment.');
    setAssignmentOpen(false); setSubjectCode(''); setDivision(''); setFacultyId(''); await load();
  }

  async function removeAssignment(id: number) {
    if (!window.confirm('Remove this manual faculty assignment? The next generation will use automatic assignment.')) return;
    await fetch(`/api/subject-faculty-assignments/${id}`, { method: 'DELETE', credentials: 'include' });
    await load();
  }

  async function saveHoliday() {
    setError('');
    if (!holidayDivision) return setError('Choose a division.');
    const response = await fetch('/api/division-holidays', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ division: holidayDivision, day: holidayDay }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setError(body.error || 'Could not save holiday.');
    setHolidayOpen(false); setHolidayDivision(''); await load();
  }

  async function removeHoliday(division: string) {
    await fetch(`/api/division-holidays/${encodeURIComponent(division)}`, { method: 'DELETE', credentials: 'include' });
    await load();
  }

  async function saveBatches() {
    setError('');
    const clean = batchRows.map((b) => ({ batchName: b.batchName.trim(), studentCount: Number(b.studentCount) })).filter((b) => b.batchName && b.studentCount > 0);
    if (!batchDivision || !clean.length) return setError('Choose a division and enter at least one valid batch.');
    const total = clean.reduce((n, b) => n + b.studentCount, 0);
    if (!['CN', 'MLOPS'].includes(batchSubject) && total !== selectedDivisionStudentCount) return setError(`Batch sizes total ${total}, but ${batchDivision} has ${selectedDivisionStudentCount} students.`);
    if (clean.some((b) => labRooms.length && b.studentCount > Math.max(...labRooms.map((r) => r.capacity)))) return setError('A batch is larger than the largest available laboratory capacity.');
    setSaving(true);
    try {
      const response = await fetch('/api/planning/lab-batches', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ division: batchDivision, subjectCode: batchSubject || null, batches: clean }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return setError(body.error || 'Could not save lab batches.');
      setBatchOpen(false); await load();
    } finally { setSaving(false); }
  }

  async function removeBatchSet(divisionName: string, subject: string | null) {
    const rows = batches.filter((b) => b.division === divisionName && (b.subjectCode || null) === (subject || null));
    if (!rows.length || !window.confirm(`Remove the configured batches for ${divisionName}${subject ? ` · ${subject}` : ''}? The scheduler will fall back to room capacity.`)) return;
    for (const row of rows) await fetch(`/api/planning/lab-batches/${row.id}`, { method: 'DELETE', credentials: 'include' });
    await load();
  }

  async function saveRoomAssignment() {
    setError('');
    if (!roomDivision || !roomId) return setError('Choose a division and room/lab.');
    const response = await fetch('/api/planning/room-assignments', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ division: roomDivision, roomId: Number(roomId), classType: roomType, subjectCode: roomSubject || null, batchName: roomBatch || null }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setError(body.error || 'Could not save room assignment.');
    setRoomOpen(false); setRoomDivision(''); setRoomId(''); setRoomSubject(''); setRoomBatch(''); await load();
  }

  async function removeRoomAssignment(id: number) {
    await fetch(`/api/planning/room-assignments/${id}`, { method: 'DELETE', credentials: 'include' });
    await load();
  }

  if (faculty.isLoading || students.isLoading || subjects.isLoading) return <><PageIntro eyebrow="Planning controls" title="Academic planning" description="Configure the constraints that the timetable generator must follow." /><LoadingState rows={8} /></>;

  const batchGroups = Array.from(new Map(batches.map((b) => [`${b.division}|${b.subjectCode || ''}`, b])).values()).map((first) => ({ division: first.division, subjectCode: first.subjectCode, rows: batches.filter((b) => b.division === first.division && (b.subjectCode || null) === (first.subjectCode || null)) }));

  return <div className="animate-rise-in">
    <PageIntro eyebrow="Planning controls · Admin" title="Academic planning" description="Set faculty, student lab batches, preferred rooms/labs and the flexible second holiday before generating a draft timetable." />
    {error && <div className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs font-semibold text-destructive">{error}</div>}
    <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-2">
      {TABS.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => setTab(key)} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={14} />{label}</button>)}
    </div>

    {tab === 'faculty' && <section className="rounded-2xl border border-border bg-card p-5">
      <PageAction title="Faculty allocation" description="These assignments override automatic faculty selection for the selected subject + division." action={<Button onClick={() => { setAssignmentOpen(true); setError(''); }}><UserCog size={15} /> Assign faculty</Button>} />
      {!assignmentRows.length ? <EmptyState title="No manual assignments" description="Automatic faculty allocation is active. Add rows when the admin wants to control teaching ownership." action={<Button onClick={() => setAssignmentOpen(true)}><Plus size={14} /> Add assignment</Button>} /> : <div className="space-y-2">{assignmentRows.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3.5"><div><div className="flex items-center gap-2"><StatusPill tone="blue">{row.subjectCode}</StatusPill><span className="text-xs font-extrabold">{row.division}</span></div><p className="mt-1 text-[11px] text-muted-foreground">{row.facultyName || `Faculty #${row.facultyId}`} · all components</p></div><button onClick={() => removeAssignment(row.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={14} /></button></div>)}</div>}
    </section>}

    {tab === 'batches' && <section className="rounded-2xl border border-border bg-card p-5">
      <PageAction title="Lab batch planning" description="Tell the generator exactly how each division is split. For CN/MLOPS you can configure the choice cohort separately; otherwise the total must match the division population." action={<Button onClick={() => { setBatchDivision(divisions[0] || ''); setBatchSubject(''); openBatchEditor(); }}><FlaskConical size={15} /> Create batches</Button>} />
      <div className="mb-4 rounded-xl bg-primary/5 p-3 text-xs leading-5 text-muted-foreground"><Check size={14} className="mb-1 text-primary" /> If no batch plan exists, the scheduler still falls back to laboratory capacity. A saved plan becomes a hard planning input for generation.</div>
      {!batchGroups.length ? <EmptyState title="Automatic lab batching" description="No manual batches yet. Create them when the admin wants explicit Batch A / Batch B / Batch C control." action={<Button onClick={() => { setBatchDivision(divisions[0] || ''); setBatchSubject(''); openBatchEditor(); }}><Plus size={14} /> Create first batch plan</Button>} /> : <div className="grid gap-3 md:grid-cols-2">{batchGroups.map((group) => <div key={`${group.division}-${group.subjectCode || 'ALL'}`} className="rounded-xl border border-border p-4"><div className="flex items-center justify-between"><div><StatusPill tone="warn">{group.subjectCode || 'All labs'}</StatusPill><p className="mt-2 text-xs font-extrabold">{group.division}</p></div><button onClick={() => removeBatchSet(group.division, group.subjectCode)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={14} /></button></div><div className="mt-3 flex flex-wrap gap-2">{group.rows.sort((a,b) => a.batchName.localeCompare(b.batchName)).map((b) => <span key={b.id} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold">{b.batchName} · {b.studentCount} students</span>)}</div></div>)}</div>}
    </section>}

    {tab === 'rooms' && <section className="rounded-2xl border border-border bg-card p-5">
      <PageAction title="Preferred rooms & labs" description="Assign a default physical room/lab to a division, or make it specific to a subject and batch. Online subjects do not need a room." action={<Button onClick={() => { setRoomOpen(true); setError(''); }}><DoorOpen size={15} /> Assign room / lab</Button>} />
      <div className="mb-4 grid gap-3 md:grid-cols-3"><Info label="Lecture / seminar rooms" value={String(rooms.filter((r) => !r.roomType.toUpperCase().includes('LAB')).length)} /><Info label="Laboratories" value={String(labRooms.length)} /><Info label="Largest lab capacity" value={String(Math.max(0, ...labRooms.map((r) => r.capacity)))} /></div>
      {!roomAssignments.length ? <EmptyState title="No preferred room assignments" description="The scheduler will choose any compatible room. Add assignments to make room/lab allocation deterministic." action={<Button onClick={() => setRoomOpen(true)}><Plus size={14} /> Add room assignment</Button>} /> : <div className="space-y-2">{roomAssignments.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3.5"><div><div className="flex flex-wrap items-center gap-2"><StatusPill tone={row.classType === 'Lab' ? 'warn' : 'blue'}>{row.classType}</StatusPill><span className="text-xs font-extrabold">{row.division}</span>{row.subjectCode && <StatusPill>{row.subjectCode}</StatusPill>}{row.batchName && <StatusPill>{row.batchName}</StatusPill>}</div><p className="mt-1 text-[11px] text-muted-foreground">{row.roomNumber || `Room #${row.roomId}`}</p></div><button onClick={() => removeRoomAssignment(row.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={14} /></button></div>)}</div>}
    </section>}

    {tab === 'holidays' && <section className="rounded-2xl border border-border bg-card p-5">
      <PageAction title="Flexible second holiday" description="Sunday remains mandatory. This is the one additional division holiday used by the scheduler." action={<Button variant="secondary" onClick={() => { setHolidayOpen(true); setError(''); }}><CalendarClock size={15} /> Set holiday</Button>} />
      {!holidays.length ? <EmptyState title="Automatic holiday plan" description="No overrides yet. The scheduler will distribute the second holiday automatically." /> : <div className="space-y-2">{holidays.map((row) => <div key={row.id} className="flex items-center justify-between rounded-xl border border-border p-3"><div><p className="text-xs font-extrabold">{row.division}</p><p className="text-[11px] text-muted-foreground">{row.day} · second holiday</p></div><button onClick={() => removeHoliday(row.division)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={14} /></button></div>)}</div>}
    </section>}

    {assignmentOpen && <Modal title="Assign faculty to a subject + division" onClose={() => setAssignmentOpen(false)}><div className="space-y-4"><Field label="Subject" value={subjectCode} onChange={setSubjectCode} options={teachingSubjects.map((s: any) => ({ value: s.code, label: `${s.code} · ${s.name} · ${s.type}` })).filter((x, i, a) => a.findIndex((y) => y.value === x.value) === i)} /><Field label="Division" value={division} onChange={setDivision} options={divisions.map((d) => ({ value: d, label: d }))} /><Field label="Faculty" value={facultyId} onChange={setFacultyId} options={(faculty.data || []).map((f: any) => ({ value: String(f.id), label: f.name }))} /><ModalActions onCancel={() => setAssignmentOpen(false)} onSave={saveAssignment} /></div></Modal>}
    {holidayOpen && <Modal title="Choose the second holiday" onClose={() => setHolidayOpen(false)}><div className="space-y-4"><Field label="Division" value={holidayDivision} onChange={setHolidayDivision} options={divisions.map((d) => ({ value: d, label: d }))} /><Field label="Holiday" value={holidayDay} onChange={setHolidayDay} options={DAYS.map((d) => ({ value: d, label: d }))} /><ModalActions onCancel={() => setHolidayOpen(false)} onSave={saveHoliday} /></div></Modal>}
    {batchOpen && <Modal title="Create manual lab batches" onClose={() => setBatchOpen(false)}><div className="space-y-4"><Field label="Division" value={batchDivision} onChange={(v) => { setBatchDivision(v); }} options={divisions.map((d) => ({ value: d, label: `${d} · ${(students.data || []).filter((s: any) => String(s.division) === d).length} students` }))} /><Field label="Lab scope" value={batchSubject} onChange={setBatchSubject} options={batchSubjectOptions} /><div className="space-y-2"><div className="flex items-center justify-between"><span className="text-xs font-bold">Batches</span><button onClick={() => setBatchRows([...batchRows, { batchName: `Batch ${String.fromCharCode(65 + batchRows.length)}`, studentCount: '' }])} className="rounded-lg border border-border px-2 py-1 text-[10px] font-bold"><Plus size={12} className="inline" /> Add batch</button></div>{batchRows.map((row, index) => <div key={index} className="grid grid-cols-[1fr_110px_auto] gap-2"><input value={row.batchName} onChange={(e) => setBatchRows(batchRows.map((x,i) => i === index ? { ...x, batchName: e.target.value } : x))} className="rounded-xl border border-input bg-background px-3 py-2.5 text-xs" /><input type="number" min="1" value={row.studentCount} onChange={(e) => setBatchRows(batchRows.map((x,i) => i === index ? { ...x, studentCount: e.target.value } : x))} placeholder="Students" className="rounded-xl border border-input bg-background px-3 py-2.5 text-xs" /><button disabled={batchRows.length === 1} onClick={() => setBatchRows(batchRows.filter((_,i) => i !== index))} className="rounded-lg p-2 text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button></div>)}</div><p className="text-[10px] text-muted-foreground">Division population: {selectedDivisionStudentCount}. Maximum configured lab capacity: {Math.max(0, ...labRooms.map((r) => r.capacity))}.</p><ModalActions onCancel={() => setBatchOpen(false)} onSave={saveBatches} saving={saving} /></div></Modal>}
    {roomOpen && <Modal title="Assign a preferred room / laboratory" onClose={() => setRoomOpen(false)}><div className="space-y-4"><Field label="Division" value={roomDivision} onChange={setRoomDivision} options={divisions.map((d) => ({ value: d, label: d }))} /><Field label="Class type" value={roomType} onChange={(v) => setRoomType(v as any)} options={['Theory','Tutorial','Lab'].map((v) => ({ value: v, label: v }))} /><Field label={roomType === 'Lab' ? 'Laboratory' : 'Room'} value={roomId} onChange={setRoomId} options={rooms.filter((r) => roomType === 'Lab' ? r.roomType.toUpperCase().includes('LAB') : !r.roomType.toUpperCase().includes('LAB')).map((r) => ({ value: String(r.id), label: `${r.roomNumber} · cap ${r.capacity}` }))} /><Field label="Subject (optional)" value={roomSubject} onChange={setRoomSubject} options={[{ value: '', label: 'Default for this division' }, ...teachingSubjects.filter((s: any) => String(s.type).toLowerCase() === (roomType === 'Lab' ? 'lab' : String(s.type).toLowerCase())).map((s: any) => ({ value: s.code, label: `${s.code} · ${s.name}` }))]} /><Field label="Batch (optional)" value={roomBatch} onChange={setRoomBatch} options={[{ value: '', label: 'All batches' }, ...batches.filter((b) => b.division === roomDivision).map((b) => ({ value: b.batchName, label: b.batchName }))]} /><p className="text-[10px] text-muted-foreground">A default assignment applies to the division. Adding a subject or batch makes the rule more specific.</p><ModalActions onCancel={() => setRoomOpen(false)} onSave={saveRoomAssignment} /></div></Modal>}
  </div>;
}

function PageAction({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-sm font-extrabold">{title}</h2><p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">{description}</p></div>{action}</div>;
}
function ModalActions({ onCancel, onSave, saving = false }: { onCancel: () => void; onSave: () => void; saving?: boolean }) {
  return <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button onClick={onSave} disabled={saving}><Save size={14} />{saving ? 'Saving…' : 'Save'}</Button></div>;
}
function Field({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-bold">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs outline-none focus:border-primary"><option value="">Select {label.toLowerCase()}</option>{options.map((o) => <option key={`${o.value}-${o.label}`} value={o.value}>{o.label}</option>)}</select></label>;
}
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-border bg-card p-3.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{label}</p><p className="mt-1 text-lg font-extrabold">{value}</p></div>; }
