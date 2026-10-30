import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, Bell, CalendarDays, GraduationCap, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings2, Users, X, SlidersHorizontal, Database, BrainCircuit } from 'lucide-react';
import { useHealthCheck } from '@workspace/api-client-react';
import { BRAND } from '@/lib/brand';
import { useAuth, type Role } from '@/lib/auth-context';

const ADMIN_NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/timetable', label: 'Timetable', icon: CalendarDays },
  { href: '/students', label: 'Students', icon: GraduationCap },
  { href: '/faculty', label: 'Faculty', icon: Users },
  { href: '/subjects', label: 'Subjects', icon: Settings2 },
  { href: '/planning', label: 'Planning', icon: SlidersHorizontal },
  { href: '/academic-data', label: 'Academic Data', icon: Database },
  { href: '/ml-studio', label: 'AI/ML Studio', icon: BrainCircuit },
];
const FACULTY_NAV = [{ href: '/', label: 'My Schedule', icon: CalendarDays }];
const STUDENT_NAV = [{ href: '/', label: 'My Timetable', icon: CalendarDays }];

function navForRole(role?: Role) {
  if (role === 'faculty') return FACULTY_NAV;
  if (role === 'student') return STUDENT_NAV;
  return ADMIN_NAV;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useHealthCheck();
  const { user, logout } = useAuth();
  const navItems = navForRole(user?.role);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${collapsed ? 'md:w-[78px]' : ''} ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-[76px] items-center justify-between border-b border-sidebar-border px-5">
          <Link href="/" data-testid="link-brand" className={`flex items-center gap-3 overflow-hidden ${collapsed ? 'md:mx-auto' : ''}`}>
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-[0_8px_20px_hsl(169_70%_48%/.2)]"><img src="/vit-logo.png" alt="VIT" className="h-full w-full object-contain p-1" /></span>
            <span className={`whitespace-nowrap font-semibold tracking-[-.03em] ${collapsed ? 'md:hidden' : ''}`}>{BRAND.name}<span className="text-sidebar-primary">.</span></span>
          </Link>
          <button onClick={() => setMobileOpen(false)} data-testid="button-close-navigation" className="rounded-lg p-2 text-sidebar-foreground/60 hover:bg-sidebar-accent md:hidden"><X size={18} /></button>
        </div>
        <div className={`px-3 pt-7 ${collapsed ? 'md:px-2' : ''}`}>
          <p className={`mb-3 px-3 font-mono text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/40 ${collapsed ? 'md:hidden' : ''}`}>Workspace</p>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = item.href === '/' ? location === '/' : location.startsWith(item.href);
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} data-testid={`link-nav-${item.label.toLowerCase()}`} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_10px_24px_hsl(169_70%_48%/.16)]' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground'} ${collapsed ? 'md:justify-center md:px-0' : ''}`}>
                <Icon size={17} strokeWidth={active ? 2.4 : 1.8} />
                <span className={collapsed ? 'md:hidden' : ''}>{item.label}</span>
                {item.href === '/timetable' && <span className={`ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary ${active ? 'bg-sidebar-primary-foreground' : ''} ${collapsed ? 'md:hidden' : ''}`} />}
              </Link>;
            })}
          </nav>
        </div>
        <div className="mt-auto px-3 pb-4">
          <div className={`mb-4 rounded-2xl border border-sidebar-border bg-sidebar-accent/45 p-3 ${collapsed ? 'md:hidden' : ''}`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[.14em] text-sidebar-foreground/45">System</span>
              <span className={`h-2 w-2 rounded-full ${health.isError ? 'bg-destructive' : health.isLoading ? 'animate-pulse-soft bg-accent' : 'bg-sidebar-primary'}`} />
            </div>
            <p className="text-xs text-sidebar-foreground/75">{health.isError ? 'Connection needs attention' : 'All systems operational'}</p>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-sidebar-foreground/45"><Activity size={12} /> Last checked just now</div>
          </div>
          <button onClick={() => setCollapsed(!collapsed)} data-testid="button-collapse-sidebar" className="hidden w-full items-center justify-center gap-2 rounded-xl border border-sidebar-border py-2 text-sidebar-foreground/55 transition hover:bg-sidebar-accent hover:text-sidebar-foreground md:flex">
            {collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /><span className="text-xs">Collapse sidebar</span></>}
          </button>
          <div className={`mt-4 flex items-center gap-3 rounded-xl border border-sidebar-border p-2.5 ${collapsed ? 'md:justify-center md:border-0' : ''}`}>
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-extrabold text-accent-foreground">{(user?.name ?? '??').slice(0, 2).toUpperCase()}</div>
            <div className={collapsed ? 'md:hidden' : ''}><p className="text-xs font-bold">{user?.name}</p><p className="text-[10px] capitalize text-sidebar-foreground/45">{user?.role === 'admin' ? BRAND.org : user?.role}</p></div>
            <button
              onClick={async () => { await logout(); window.location.assign('/login'); }}
              data-testid="button-sign-out"
              title="Sign out"
              className={`ml-auto rounded-lg p-1.5 text-sidebar-foreground/45 transition hover:bg-sidebar-accent hover:text-sidebar-foreground ${collapsed ? 'md:hidden' : ''}`}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="Close navigation" data-testid="button-navigation-backdrop" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-sidebar/35 backdrop-blur-sm md:hidden" />}
      <main className={`min-h-[100dvh] transition-[padding] duration-300 ${collapsed ? 'md:pl-[78px]' : 'md:pl-[252px]'}`}>
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/70 bg-background/90 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} data-testid="button-open-navigation" className="rounded-xl border border-border bg-card p-2 text-muted-foreground md:hidden"><Menu size={18} /></button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="font-mono text-[10px] uppercase tracking-[.16em]">Academic operations</span><span className="text-border">/</span><span className="font-semibold text-foreground">{navItems.find((item) => item.href === '/' ? location === '/' : location.startsWith(item.href))?.label}</span></div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <button data-testid="button-search" className="hidden items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm transition hover:border-primary/40 hover:text-foreground sm:flex"><Search size={15} /><span>Search anything</span><kbd className="ml-4 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘ K</kbd></button>
            <button data-testid="button-notifications" className="relative rounded-xl border border-border bg-card p-2.5 text-muted-foreground shadow-sm transition hover:border-primary/40 hover:text-foreground"><Bell size={17} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-card" /></button>
            <div className="hidden h-7 w-px bg-border sm:block" />
            <span className="font-mono text-[10px] font-medium uppercase tracking-[.13em] text-muted-foreground">VIT · 08:00–18:00</span>
          </div>
        </header>
        <div className="p-4 sm:p-7 lg:p-10">{children}</div>
      </main>
    </div>
  );
}