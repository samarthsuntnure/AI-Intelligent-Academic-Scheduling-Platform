import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Clock3,
  Code2,
  Layers3,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';

import {
  getListSubjectsQueryKey,
  useCreateSubject,
  useListSubjects,
} from '@workspace/api-client-react';

import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageIntro,
  SearchInput,
  SectionHeading,
  StatusPill,
} from '@/components/primitives';

/* -------------------------------------------------------
   SUBJECT TYPE CONFIGURATION
------------------------------------------------------- */

const SUBJECT_TYPES = {
  Theory: 1,
  Lab: 2,
  Tutorial: 1,
} as const;

type SubjectType = keyof typeof SUBJECT_TYPES;

/* -------------------------------------------------------
   EMPTY FORM
------------------------------------------------------- */

const blank = {
  code: '',
  name: '',
  type: 'Theory' as SubjectType,
  weeklyHours: '1',
};

/* -------------------------------------------------------
   MAIN COMPONENT
------------------------------------------------------- */

export default function Subjects() {
  const queryClient = useQueryClient();

  const subjects = useListSubjects();
  const create = useCreateSubject();

  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(blank);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(blank);
  const [editError, setEditError] = useState('');

  /* -------------------------------------------------------
     FILTER SUBJECTS
  ------------------------------------------------------- */

  const list = useMemo(
    () =>
      (subjects.data || []).filter((subject) =>
        `${subject.code} ${subject.name} ${subject.type || ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [subjects.data, search],
  );

  /* -------------------------------------------------------
     CHANGE SUBJECT TYPE
  ------------------------------------------------------- */

  function handleTypeChange(type: SubjectType) {
    const hours = SUBJECT_TYPES[type];

    setForm((previous) => ({
      ...previous,
      type,
      weeklyHours: String(hours),
    }));
  }

  /* -------------------------------------------------------
     SUBMIT SUBJECT
  ------------------------------------------------------- */

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const type = form.type;
    const hoursPerDay = SUBJECT_TYPES[type];

    create.mutate(
      {
        data: {
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          type,
          weeklyHours: hoursPerDay,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListSubjectsQueryKey(),
          });

          setModal(false);
          setForm(blank);
        },
      },
    );
  };

  /* -------------------------------------------------------
     DELETE SUBJECT
  ------------------------------------------------------- */

  function openEdit(subject: any) { setEditingId(subject.id); setEditForm({ code: subject.code, name: subject.name, type: (subject.type || 'Theory') as SubjectType, weeklyHours: String(subject.weeklyHours || 1) }); setEditError(''); }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await fetch(`/api/subjects/${editingId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: editForm.code.trim().toUpperCase(), name: editForm.name.trim(), type: editForm.type, weeklyHours: Number(editForm.weeklyHours) }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not update subject.');
      await queryClient.invalidateQueries({ queryKey: getListSubjectsQueryKey() });
      setEditingId(null);
    } catch (e) { setEditError(e instanceof Error ? e.message : 'Could not update subject.'); }
  }

  async function remove(id: number) {
    if (!window.confirm('Remove this subject from the catalog?')) {
      return;
    }

    setDeletingId(id);

    try {
      await fetch(`/api/subjects/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      queryClient.invalidateQueries({
        queryKey: getListSubjectsQueryKey(),
      });
    } finally {
      setDeletingId(null);
    }
  }

  /* -------------------------------------------------------
     LOADING STATE
  ------------------------------------------------------- */

  if (subjects.isLoading) {
    return (
      <>
        <PageIntro
          eyebrow="Catalog · Curriculum map"
          title="Subjects"
          description="The catalog behind every constraint: codes, cadence, and the shape of each teaching commitment."
        />

        <LoadingState />
      </>
    );
  }

  /* -------------------------------------------------------
     ERROR STATE
  ------------------------------------------------------- */

  if (subjects.isError) {
    return (
      <>
        <PageIntro
          eyebrow="Catalog · Curriculum map"
          title="Subjects"
          description="The catalog behind every constraint: codes, cadence, and the shape of each teaching commitment."
        />

        <ErrorState onRetry={() => subjects.refetch()} />
      </>
    );
  }

  /* -------------------------------------------------------
     UI
  ------------------------------------------------------- */

  return (
    <div className="animate-rise-in">
      <PageIntro
        eyebrow="Catalog · Curriculum map"
        title="Subjects"
        description="The catalog behind every constraint: codes, cadence, and the shape of each teaching commitment."
        action={
          <Button
            onClick={() => {
              setForm(blank);
              setModal(true);
            }}
            testId="button-add-subject"
          >
            <Plus size={15} />
            Add subject
          </Button>
        }
      />

      {/* SEARCH */}

      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="w-full sm:max-w-sm">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search code, title, or type"
            testId="input-search-subjects"
          />
        </div>

        <p className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          {list.length} catalog entries
        </p>
      </div>

      {/* SUBJECT LIST */}

      {!list.length ? (
        <EmptyState
          title="No subjects found"
          description={
            search
              ? 'Try a different code or subject name.'
              : 'Add subjects to give the scheduling engine a curriculum to place.'
          }
          action={
            !search && (
              <Button
                onClick={() => {
                  setForm(blank);
                  setModal(true);
                }}
                testId="button-add-first-subject"
              >
                <Plus size={14} />
                Add subject
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((subject, index) => (
            <article
              key={subject.id}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
              data-testid={`card-subject-${subject.id}`}
            >
              <div
                className={`absolute right-0 top-0 h-20 w-20 rounded-bl-[60px] ${
                  index % 2 ? 'bg-accent/15' : 'bg-primary/10'
                }`}
              />

              <div className="relative flex items-start justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-foreground text-background">
                  <Code2 size={17} />
                </span>

                <div className="flex items-center gap-2">
                  <StatusPill tone="blue">
                    {subject.type || 'General'}
                  </StatusPill>

                  <button
                    onClick={() => openEdit(subject)}
                    data-testid={`button-edit-subject-${subject.id}`}
                    title="Edit subject"
                    className="rounded-lg p-1.5 text-muted-foreground/50 transition hover:bg-primary/10 hover:text-primary"
                  >
                    <Pencil size={14} />
                  </button>

                  <button
                    onClick={() => remove(subject.id)}
                    disabled={deletingId === subject.id}
                    data-testid={`button-delete-subject-${subject.id}`}
                    title="Remove subject"
                    className="rounded-lg p-1.5 text-muted-foreground/50 transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <p className="mt-5 font-mono text-xs font-medium tracking-[.1em] text-primary">
                {subject.code}
              </p>

              <h2 className="mt-1.5 min-h-[44px] text-base font-extrabold leading-5 tracking-[-.025em]">
                {subject.name}
              </h2>

              <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 size={14} />
                  Daily duration
                </span>

                <span className="font-mono text-xs font-medium">
                  {SUBJECT_TYPES[
                    subject.type as SubjectType
                  ] ?? 1}{' '}
                  hour
                  {(SUBJECT_TYPES[
                    subject.type as SubjectType
                  ] ?? 1) > 1
                    ? 's'
                    : ''}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* CURRICULUM SUMMARY */}

      <section className="mt-7 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <SectionHeading
          title="Curriculum shape"
          description="A quick read of how your catalog is composed."
          action={<Layers3 size={16} className="text-primary" />}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-primary/5 p-4">
            <BookOpen size={16} className="mb-4 text-primary" />

            <p className="text-2xl font-extrabold tracking-[-.05em]">
              {list.length}
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              Total subjects
            </p>
          </div>

          <div className="rounded-xl bg-accent/10 p-4">
            <Clock3
              size={16}
              className="mb-4 text-accent-foreground"
            />

            <p className="text-2xl font-extrabold tracking-[-.05em]">
              {list.reduce(
                (total, subject) => total + subject.weeklyHours,
                0,
              )}
              h
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              Planned hours / cycle
            </p>
          </div>

          <div className="rounded-xl bg-chart-3/10 p-4">
            <Layers3 size={16} className="mb-4 text-chart-3" />

            <p className="text-2xl font-extrabold tracking-[-.05em]">
              {
                new Set(
                  list.map(
                    (subject) => subject.type || 'General',
                  ),
                ).size
              }
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              Subject types
            </p>
          </div>
        </div>
      </section>

      {/* ADD SUBJECT MODAL */}

      {modal && (
        <Modal
          title="Add subject"
          onClose={() => {
            setModal(false);
            setForm(blank);
          }}
        >
          <form onSubmit={submit} className="space-y-4">
            {/* SUBJECT CODE */}

            <Field
              label="Subject code"
              value={form.code}
              onChange={(value) =>
                setForm({
                  ...form,
                  code: value,
                })
              }
              placeholder="e.g. CS204"
              testId="input-subject-code"
              required
            />

            {/* SUBJECT NAME */}

            <Field
              label="Subject name"
              value={form.name}
              onChange={(value) =>
                setForm({
                  ...form,
                  name: value,
                })
              }
              placeholder="e.g. Operating Systems"
              testId="input-subject-name"
              required
            />

            {/* TYPE + DAILY HOURS */}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold">
                  Type
                </span>

                <select
                  value={form.type}
                  onChange={(event) =>
                    handleTypeChange(
                      event.target.value as SubjectType,
                    )
                  }
                  data-testid="input-subject-type"
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                >
                  <option value="Theory">Theory</option>
                  <option value="Lab">Lab</option>
                  <option value="Tutorial">Tutorial</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold">
                  Hours per day
                </span>

                <input
                  type="text"
                  value={`${SUBJECT_TYPES[form.type]} hour${
                    SUBJECT_TYPES[form.type] === 1 ? '' : 's'
                  }`}
                  readOnly
                  disabled
                  data-testid="input-subject-hours"
                  className="w-full cursor-not-allowed rounded-xl border border-input bg-muted px-3 py-2.5 text-xs outline-none"
                />
              </label>
            </div>

            {/* ACTIONS */}

            <div className="flex justify-end gap-2 pt-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setModal(false);
                  setForm(blank);
                }}
                testId="button-cancel-subject"
              >
                Cancel
              </Button>

              <Button
                type="submit"
                disabled={create.isPending}
                testId="button-save-subject"
              >
                {create.isPending
                  ? 'Saving…'
                  : 'Save subject'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {editingId !== null && <Modal title="Edit subject" onClose={() => setEditingId(null)}><form onSubmit={saveEdit} className="space-y-4"><Field label="Subject code" value={editForm.code} onChange={v => setEditForm({ ...editForm, code: v })} placeholder="DAA" testId="input-edit-subject-code" required /><Field label="Subject name" value={editForm.name} onChange={v => setEditForm({ ...editForm, name: v })} placeholder="Design and Analysis of Algorithms" testId="input-edit-subject-name" required /><label className="block"><span className="mb-1.5 block text-xs font-bold">Type</span><select value={editForm.type} onChange={e => setEditForm({ ...editForm, type: e.target.value as SubjectType, weeklyHours: String(SUBJECT_TYPES[e.target.value as SubjectType]) })} className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs"><option>Theory</option><option>Lab</option><option>Tutorial</option></select></label><Field label="Weekly hours" value={editForm.weeklyHours} onChange={v => setEditForm({ ...editForm, weeklyHours: v })} placeholder="3" testId="input-edit-subject-hours" type="number" required />{editError&&<p className="text-xs font-semibold text-destructive">{editError}</p>}<div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => setEditingId(null)}>Cancel</Button><Button type="submit">Save changes</Button></div></form></Modal>}
    </div>
  );
}

/* -------------------------------------------------------
   FIELD COMPONENT
------------------------------------------------------- */

function Field({
  label,
  value,
  onChange,
  placeholder,
  testId,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold">
        {label}
      </span>

      <input
        required={required}
        type={type}
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        data-testid={testId}
        className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
      />
    </label>
  );
}