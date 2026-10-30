import { useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, GraduationCap, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

type LoginRole = 'admin' | 'faculty' | 'student';

const roleInfo: Record<LoginRole, { title: string; description: string; email: string; password: string; icon: typeof ShieldCheck }> = {
  admin: { title: 'Academic Office', description: 'Manage students, faculty, rooms, holidays and timetable generation.', email: 'admin@vit.edu', password: 'Admin@123', icon: ShieldCheck },
  faculty: { title: 'Faculty Portal', description: 'View your teaching load, assigned divisions and weekly schedule.', email: 'faculty.name@vit.edu', password: 'faculty123', icon: GraduationCap },
  student: { title: 'Student Portal', description: 'View your division timetable, rooms and assigned faculty.', email: 'PRN@vit.edu', password: 'Your PRN', icon: Users },
};

export default function Login() {
  const [, navigate] = useLocation();
  const { refresh } = useAuth();
  const [role, setRole] = useState<LoginRole>('admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const current = roleInfo[role];
  const Icon = current.icon;

  function changeRole(next: LoginRole) {
    setRole(next);
    setEmail('');
    setPassword('');
    setError('');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('Enter your VIT email and password to continue.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'The credentials could not be verified.');
        return;
      }
      await refresh();
      navigate('/');
    } catch {
      setError('The academic server is not reachable. Start the API and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[#f3f6fb] text-[#142844]">
      <div className="grid min-h-[100dvh] lg:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden overflow-hidden bg-[#12345b] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
          <div className="absolute -right-32 -top-32 h-80 w-80 rounded-full bg-[#ef7d28]/20 blur-2xl" />
          <div className="absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-[#2c72b8]/30 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-xl bg-white p-1 shadow-xl"><img src="/vit-logo.png" alt="VIT" className="h-full w-full object-contain" /></div>
              <div><p className="text-xl font-black tracking-tight">VIT Pune</p><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-white/60">Academic Operations</p></div>
            </div>
            <div className="mt-28 max-w-xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.18em] text-white/80"><Sparkles size={13} className="text-[#f39a4a]" /> Smart timetable workspace</div>
              <h1 className="text-5xl font-black leading-[1.02] tracking-[-.045em] xl:text-6xl">Plan the week.<br /><span className="text-[#f39a4a]">Protect every hour.</span></h1>
              <p className="mt-6 max-w-lg text-sm leading-7 text-white/70">A VIT-focused academic scheduling workspace for conflict-free faculty, room, lab and division planning.</p>
            </div>
          </div>
          <div className="relative flex items-center justify-between border-t border-white/10 pt-5 text-[10px] uppercase tracking-[.14em] text-white/45"><span>Monday–Saturday · 08:00–18:00</span><span>Sunday · Holiday</span></div>
        </section>

        <section className="flex min-h-[100dvh] items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[480px]">
            <div className="mb-7 flex items-center gap-3 lg:hidden"><div className="grid h-11 w-11 place-items-center overflow-hidden rounded-xl bg-white p-1 shadow-sm"><img src="/vit-logo.png" alt="VIT" className="h-full w-full object-contain" /></div><div><p className="text-lg font-black">VIT Pune</p><p className="text-[9px] font-bold uppercase tracking-[.18em] text-slate-500">Academic Operations</p></div></div>
            <div className="mb-7"><p className="mb-2 text-[10px] font-black uppercase tracking-[.22em] text-[#d66d21]">Secure VIT access</p><h2 className="text-3xl font-black tracking-[-.04em] text-[#142844]">Welcome back.</h2><p className="mt-2 text-sm leading-6 text-slate-500">Choose your role and sign in to continue.</p></div>

            <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm"><div className="grid grid-cols-3 gap-1">
              {(['admin', 'faculty', 'student'] as LoginRole[]).map((item) => (
                <button key={item} type="button" onClick={() => changeRole(item)} className={`rounded-xl px-3 py-2.5 text-xs font-extrabold transition ${role === item ? 'bg-[#12345b] text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-[#12345b]'}`}>{item[0].toUpperCase() + item.slice(1)}</button>
              ))}
            </div></div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(18,52,91,.12)] sm:p-8">
              <div className="mb-7 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#eef4fb] text-[#12345b]"><Icon size={20} /></div><div><h3 className="text-sm font-black text-[#142844]">{current.title}</h3><p className="mt-0.5 text-[11px] leading-5 text-slate-500">{current.description}</p></div></div>
              <form onSubmit={handleSubmit} className="space-y-5" data-testid="form-login">
                <label className="block"><span className="mb-2 block text-xs font-extrabold text-[#142844]">VIT email</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder={current.email} data-testid="input-email" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm outline-none transition focus:border-[#2867a5] focus:bg-white focus:ring-4 focus:ring-[#2867a5]/10" /></label>
                <label className="block"><span className="mb-2 block text-xs font-extrabold text-[#142844]">Password</span><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder={current.password} data-testid="input-password" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm outline-none transition focus:border-[#2867a5] focus:bg-white focus:ring-4 focus:ring-[#2867a5]/10" /></label>
                {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-bold leading-5 text-red-700">{error}</div>}
                <button type="submit" disabled={submitting} data-testid="button-sign-in" className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#12345b] px-4 py-3.5 text-sm font-black text-white shadow-lg shadow-[#12345b]/15 transition hover:bg-[#174674] disabled:cursor-not-allowed disabled:opacity-60">{submitting ? 'Signing in…' : <>Sign in <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" /></>}</button>
              </form>
              <div className="mt-7 flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-[10px] font-semibold text-slate-400"><ShieldCheck size={13} className="text-[#d66d21]" /> VIT academic account · secure access</div>
            </div>
            <p className="mt-5 text-center text-[10px] font-semibold text-slate-400">Use the account created by the academic office. Student passwords default to the student's PRN.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
