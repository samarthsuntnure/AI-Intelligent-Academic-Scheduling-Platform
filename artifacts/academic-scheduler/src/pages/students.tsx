import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Plus, Search, Trash2, UserRound, Users } from 'lucide-react';
import { getGetStudentQueryKey, getListStudentsQueryKey, useCreateStudent, useDeleteStudent, useGetStudent, useListStudents, useUpdateStudent } from '@workspace/api-client-react';
import type { Student } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, LoadingState, Modal, PageIntro, SectionHeading, StatusPill } from '@/components/primitives';

const blank = { name: '', division: 'TY-A', rollNo: '', prn: '' };

export default function Students() {
  const queryClient = useQueryClient();
  const students = useListStudents();
  const createStudent = useCreateStudent();
  const updateStudent = useUpdateStudent();
  const deleteStudent = useDeleteStudent();
  const [search, setSearch] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState('');
  const selected = useGetStudent(selectedId ?? 0, { query: { enabled: selectedId !== null, queryKey: getGetStudentQueryKey(selectedId ?? 0) } });
  const divisions = useMemo(() => Array.from(new Set((students.data || []).map((s) => s.division))).sort(), [students.data]);
  const list = useMemo(() => (students.data || []).filter((student) => (divisionFilter === 'ALL' || student.division === divisionFilter) && `${student.name} ${student.prn || ''} ${student.rollNo}`.toLowerCase().includes(search.toLowerCase())), [students.data, search, divisionFilter]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListStudentsQueryKey() });

  function openEdit(student: Student) { setForm({ name: student.name, division: student.division, rollNo: String(student.rollNo), prn: student.prn || '' }); setFormError(''); setSelectedId(student.id); setModal('edit'); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const name = form.name.trim(); const division = form.division.trim().toUpperCase().replace(/\s+/g, '-'); const rollNo = Number(form.rollNo);
    if (!name || !division || !Number.isInteger(rollNo) || rollNo < 1) { setFormError('Enter a name, division and valid roll number.'); return; }
    setFormError('');
    const payload = { name, division, rollNo, prn: form.prn.trim() || null, registeredSubject: 'CN' };
    const onError = (error: unknown) => setFormError((error instanceof Error ? error.message : 'Could not save the student.').replace(/^HTTP \d+ [^:]+: /, ''));
    if (modal === 'edit' && selectedId !== null) updateStudent.mutate({ id: selectedId, data: payload }, { onSuccess: () => { refresh(); setModal(null); }, onError });
    else createStudent.mutate({ data: payload }, { onSuccess: () => { refresh(); setModal(null); setForm(blank); }, onError });
  }

  if (students.isLoading) return <><PageIntro eyebrow="Directory · Student records" title="Students" description="A clean roster for divisions, attendance and timetable constraints." /><LoadingState rows={7} /></>;
  if (students.isError) return <><PageIntro eyebrow="Directory · Student records" title="Students" description="A clean roster for divisions, attendance and timetable constraints." /><ErrorState onRetry={() => students.refetch()} /></>;

  return <div className="animate-rise-in">
    <PageIntro eyebrow="Directory · Student records" title="Students" description="493 real student records across every active division. Choice subjects are used by the scheduler but kept out of this roster view." action={<Button onClick={() => { setForm(blank); setFormError(''); setModal('create'); }} testId="button-add-student"><Plus size={15} /> Add student</Button>} />
    <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
      <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm"><Search size={15} className="text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, PRN or roll number" className="w-full bg-transparent text-xs outline-none" data-testid="input-search-students" /></label>
      <select value={divisionFilter} onChange={(e) => setDivisionFilter(e.target.value)} className="rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-bold outline-none focus:border-primary"><option value="ALL">All divisions</option>{divisions.map((d) => <option key={d}>{d}</option>)}</select>
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-[10px] font-black uppercase tracking-[.12em] text-muted-foreground"><Users size={14} className="text-primary" /> {list.length} records</div>
    </div>

    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="hidden grid-cols-[1.45fr_.7fr_.65fr_1.1fr_90px] gap-4 border-b border-border bg-[#f7f9fc] px-5 py-3 text-[9px] font-black uppercase tracking-[.16em] text-muted-foreground md:grid"><span>Student</span><span>Division</span><span>Roll no.</span><span>PRN</span><span /></div>
      {list.map((student, index) => <div key={student.id} className="grid gap-3 border-b border-border px-4 py-4 last:border-0 md:grid-cols-[1.45fr_.7fr_.65fr_1.1fr_90px] md:items-center md:gap-4 md:px-5" data-testid={`row-student-${student.id}`}>
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-xs font-black text-primary">{student.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('')}</span><div className="min-w-0"><p className="truncate text-xs font-black">{student.name}</p><p className="text-[10px] text-muted-foreground">Student record #{String(index + 1).padStart(3, '0')}</p></div></div>
        <div><StatusPill tone="blue">{student.division}</StatusPill></div><p className="text-xs font-bold text-muted-foreground">{student.rollNo}</p><p className="font-mono text-[11px] text-muted-foreground">{student.prn || 'PRN not provided'}</p>
        <div className="flex items-center justify-end gap-1"><button onClick={() => setSelectedId(student.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary" title="View"><Eye size={14} /></button><button onClick={() => openEdit(student)} className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Edit"><Pencil size={14} /></button><button onClick={() => { if (window.confirm('Remove this student record?')) deleteStudent.mutate({ id: student.id }, { onSuccess: refresh }); }} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete"><Trash2 size={14} /></button></div>
      </div>)}
    </section>

    <div className="mt-5 grid gap-3 sm:grid-cols-3"><Stat icon={Users} value={String(students.data?.length || 0)} label="Total students" /><Stat icon={UserRound} value={String(divisions.length)} label="Active divisions" /><Stat icon={Users} value={String(list.length)} label="Current filter" /></div>

    {selectedId !== null && !modal && <Modal title="Student record" onClose={() => setSelectedId(null)}>{selected.isLoading ? <LoadingState rows={3} /> : selected.data ? <div className="space-y-4"><div className="rounded-2xl bg-muted/50 p-4"><p className="text-lg font-black">{selected.data.name}</p><p className="mt-1 text-xs text-muted-foreground">{selected.data.division} · Roll {selected.data.rollNo}</p></div><div className="grid grid-cols-2 gap-3"><Info label="PRN" value={selected.data.prn || 'Not provided'} /><Info label="Division" value={selected.data.division} /></div><p className="text-[11px] text-muted-foreground">Choice-subject information is intentionally kept separate from the student directory.</p></div> : <p className="text-sm text-muted-foreground">Student not found.</p>}</Modal>}
    {modal && <Modal title={modal === 'edit' ? 'Edit student' : 'Add student'} onClose={() => setModal(null)}><form onSubmit={submit} className="space-y-4"><Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Student name" required /><Field label="Division" value={form.division} onChange={(v) => setForm({ ...form, division: v })} placeholder="TY-A" required /><Field label="Roll number" value={form.rollNo} onChange={(v) => setForm({ ...form, rollNo: v })} placeholder="24" type="number" required /><Field label="PRN" value={form.prn} onChange={(v) => setForm({ ...form, prn: v })} placeholder="University PRN" />{formError && <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs font-semibold text-destructive">{formError}</div>}<div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={() => setModal(null)} testId="button-cancel-student">Cancel</Button><Button type="submit" testId="button-save-student">{modal === 'edit' ? 'Save changes' : 'Create student'}</Button></div></form></Modal>}
  </div>;
}

function Field({ label, value, onChange, placeholder, type = 'text', required = false }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string; required?: boolean }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold">{label}</span><input required={required} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" /></label>; }
function Stat({ icon: Icon, value, label }: { icon: typeof Users; value: string; label: string }) { return <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><Icon size={16} className="mb-3 text-primary" /><p className="text-xl font-black">{value}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</p></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-muted/50 p-3"><p className="text-[9px] font-black uppercase tracking-[.14em] text-muted-foreground">{label}</p><p className="mt-1 text-xs font-bold">{value}</p></div>; }
