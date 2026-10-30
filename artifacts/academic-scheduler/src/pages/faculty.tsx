import { useMemo, useState, type FormEvent, type ElementType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Edit3, Mail, Plus, Trash2, UserRound, Users, WandSparkles } from 'lucide-react';
import { getListFacultyQueryKey, useCreateFaculty, useListFaculty } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, LoadingState, Modal, PageIntro, SearchInput, SectionHeading, StatusPill } from '@/components/primitives';

const blank = { name: '', email: '', department: '', maxWeeklyHours: '18' };

type FacultyForm = typeof blank;

export default function Faculty() {
  const queryClient = useQueryClient();
  const faculty = useListFaculty();
  const create = useCreateFaculty();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FacultyForm>(blank);
  const [formError, setFormError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const list = useMemo(() => (faculty.data || []).filter((person) => `${person.name} ${person.email || ''} ${person.department || ''}`.toLowerCase().includes(search.toLowerCase())), [faculty.data, search]);

  function openCreate() { setEditingId(null); setForm(blank); setFormError(''); setModal(true); }
  function openEdit(person: any) { setEditingId(person.id); setForm({ name: person.name, email: person.email || '', department: person.department || '', maxWeeklyHours: String(person.maxWeeklyHours) }); setFormError(''); setModal(true); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    const name = form.name.trim();
    const email = form.email.trim();
    const department = form.department.trim();
    const maxWeeklyHours = Number(form.maxWeeklyHours);
    if (!name || !Number.isInteger(maxWeeklyHours) || maxWeeklyHours < 1) { setFormError('Enter a faculty name and a valid weekly capacity.'); return; }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) { setFormError('Enter a valid work email or leave it blank.'); return; }
    try {
      if (editingId !== null) {
        const response = await fetch(`/api/faculty/${editingId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email: email || null, department: department || null, maxWeeklyHours }) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Could not update faculty.');
      } else {
        await new Promise<void>((resolve, reject) => create.mutate({ data: { name, email: email || null, department: department || null, maxWeeklyHours } }, { onSuccess: () => resolve(), onError: (e) => reject(e) }));
      }
      await queryClient.invalidateQueries({ queryKey: getListFacultyQueryKey() });
      setModal(false);
      setForm(blank);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the faculty profile.';
      setFormError(message.replace(/^HTTP \d+ [^:]+: /, ''));
    }
  }

  async function remove(id: number) {
    if (!window.confirm('Remove this faculty profile? This cannot be undone.')) return;
    setDeletingId(id);
    try { await fetch(`/api/faculty/${id}`, { method: 'DELETE', credentials: 'include' }); await queryClient.invalidateQueries({ queryKey: getListFacultyQueryKey() }); }
    finally { setDeletingId(null); }
  }

  if (faculty.isLoading) return <><PageIntro eyebrow="Directory · Teaching team" title="Faculty" description="Manage the people who teach every theory, lab and tutorial session." /><LoadingState /></>;
  if (faculty.isError) return <><PageIntro eyebrow="Directory · Teaching team" title="Faculty" description="Manage the people who teach every theory, lab and tutorial session." /><ErrorState onRetry={() => faculty.refetch()} /></>;

  const average = list.length ? Math.round(list.reduce((sum, person) => sum + person.maxWeeklyHours, 0) / list.length) : 0;

  return <div className="animate-rise-in">
    <PageIntro eyebrow="Directory · Teaching team" title="Faculty" description="Manage faculty profiles, capacity and contact details used by the scheduling engine." action={<Button onClick={openCreate} testId="button-add-faculty"><Plus size={15} /> Add faculty</Button>} />
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="w-full sm:max-w-sm"><SearchInput value={search} onChange={setSearch} placeholder="Search name, email or department" testId="input-search-faculty" /></div><p className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">{list.length} of {faculty.data?.length || 0} profiles</p></div>
    {!list.length ? <EmptyState title="No faculty found" description={search ? 'Try another search term.' : 'Add faculty to make workload planning possible.'} action={!search && <Button onClick={openCreate} testId="button-add-faculty-empty"><Plus size={14} /> Add faculty</Button>} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.map((person, index) => <article key={person.id} className="group rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-xl" data-testid={`card-faculty-${person.id}`}>
      <div className="mb-5 flex items-start justify-between"><div className="flex min-w-0 items-center gap-3"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-black ${index % 2 ? 'bg-accent/15 text-accent-foreground' : 'bg-primary/10 text-primary'}`}>{person.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span><div className="min-w-0"><p className="truncate text-sm font-black">{person.name}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{person.department || 'Department not assigned'}</p></div></div><div className="flex items-center gap-1"><StatusPill tone="good">Active</StatusPill><button onClick={() => openEdit(person)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Edit faculty"><Edit3 size={14} /></button><button onClick={() => remove(person.id)} disabled={deletingId === person.id} className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40" title="Delete faculty"><Trash2 size={14} /></button></div></div>
      <div className="space-y-3 border-t border-border pt-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Mail size={13} className="text-primary" />{person.email || 'Email not provided'}</p><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-bold"><WandSparkles size={13} className="text-accent-foreground" /> Weekly capacity</span><span className="font-mono text-xs font-bold">{person.maxWeeklyHours}h</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (person.maxWeeklyHours / 24) * 100)}%` }} /></div></div>
    </article>)}</div>}
    <section className="mt-7 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"><SectionHeading title="Faculty capacity" description="The scheduler uses these limits together with real availability and manual assignments." action={<Users size={16} className="text-primary" />} /><div className="grid gap-3 sm:grid-cols-3"><Signal icon={UserRound} value={String(list.length)} label="Profiles shown" /><Signal icon={WandSparkles} value={`${average}h`} label="Average capacity" /><Signal icon={Mail} value={String(list.filter((p) => p.email).length)} label="Email profiles" /></div></section>
    {modal && <Modal title={editingId !== null ? 'Edit faculty profile' : 'Add faculty profile'} onClose={() => { setModal(false); setFormError(''); }}><form onSubmit={submit} className="space-y-4"><Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. Dr. Neel Shah" testId="input-faculty-name" required /><Field label="Work email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="name@vit.edu" testId="input-faculty-email" type="email" /><Field label="Department / designation" value={form.department} onChange={(v) => setForm({ ...form, department: v })} placeholder="e.g. Assistant Professor" testId="input-faculty-department" /><Field label="Maximum weekly hours" value={form.maxWeeklyHours} onChange={(v) => setForm({ ...form, maxWeeklyHours: v })} placeholder="18" testId="input-faculty-hours" type="number" required />{formError && <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs font-semibold text-destructive">{formError}</div>}<div className="flex justify-end gap-2 pt-3"><Button variant="secondary" onClick={() => setModal(false)} testId="button-cancel-faculty">Cancel</Button><Button type="submit" disabled={create.isPending} testId="button-save-faculty">{create.isPending ? 'Saving…' : editingId !== null ? 'Save changes' : 'Create profile'}</Button></div></form></Modal>}
  </div>;
}

function Field({ label, value, onChange, placeholder, testId, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; testId: string; type?: string; required?: boolean }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold">{label}</span><input required={required} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10" /></label>; }
function Signal({ icon: Icon, value, label }: { icon: ElementType; value: string; label: string }) { return <div className="rounded-xl bg-muted/55 p-3.5"><Icon size={15} className="mb-3 text-primary" /><p className="text-xl font-extrabold tracking-[-.04em]">{value}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p></div>; }
