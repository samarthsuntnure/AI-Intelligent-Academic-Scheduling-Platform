import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppShell } from '@/components/shell';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import Dashboard from '@/pages/dashboard';
import Faculty from '@/pages/faculty';
import FacultyDashboard from '@/pages/faculty-dashboard';
import Login from '@/pages/login';
import NotFound from '@/pages/not-found';
import Students from '@/pages/students';
import StudentDashboard from '@/pages/student-dashboard';
import Subjects from '@/pages/subjects';
import Timetable from '@/pages/timetable';
import Planning from '@/pages/planning';
import AcademicData from '@/pages/academic-data';
import MLStudio from '@/pages/ml-studio';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
function RoutedErrorBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }

/** Gates every route except /login behind a signed-in session, verified with the server. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-[100dvh] place-items-center text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <Redirect to="/login" />;
  return <>{children}</>;
}

/** Only admin can see the management pages (students/faculty/subjects/timetable). */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Redirect to="/" />;
  return <>{children}</>;
}

/** "/" shows a different dashboard depending on who's signed in. */
function RoleHome() {
  const { user } = useAuth();
  if (user?.role === 'faculty') return <FacultyDashboard />;
  if (user?.role === 'student') return <StudentDashboard />;
  return <Dashboard />;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/login" component={Login} />
        <Route>
          <RequireAuth>
            <AppShell>
              <Switch>
                <Route path="/" component={RoleHome} />
                <Route path="/timetable"><RequireAdmin><Timetable /></RequireAdmin></Route>
                <Route path="/students"><RequireAdmin><Students /></RequireAdmin></Route>
                <Route path="/faculty"><RequireAdmin><Faculty /></RequireAdmin></Route>
                <Route path="/subjects"><RequireAdmin><Subjects /></RequireAdmin></Route>
                <Route path="/planning"><RequireAdmin><Planning /></RequireAdmin></Route>
                <Route path="/academic-data"><RequireAdmin><AcademicData /></RequireAdmin></Route>
                <Route path="/ml-studio"><RequireAdmin><MLStudio /></RequireAdmin></Route>
                <Route component={NotFound} />
              </Switch>
            </AppShell>
          </RequireAuth>
        </Route>
      </Switch>
    </RoutedErrorBoundary>
  );
}
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
export default App;
