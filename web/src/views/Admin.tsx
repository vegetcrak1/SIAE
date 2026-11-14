import { api } from '../api';
import { useTab } from '../hooks';
import { useLoad, type NavItem } from '../ui';
import { CoursesView } from './admin/Courses';
import { DashboardView } from './admin/Dashboard';
import { AuditView, ExcusesAdminView, FeedbackView, NoticesAdminView, RulesView } from './admin/Inbox';
import { StudentsView } from './admin/Students';
import { SubstitutionsView } from './admin/Substitutions';
import { UsersView } from './admin/Users';
import { Shell } from './Shell';

const TABS = ['panel', 'estudiantes', 'usuarios', 'cursos', 'reemplazos', 'excusas', 'mensajes', 'reglas', 'avisos', 'actividad'];

export function AdminView() {
  const [tab, setTab] = useTab(TABS, 'panel');
  const badges = useLoad(() => api.get<{ pendingRegistrations: number; pendingExcuses: number }>('/admin/dashboard'), [tab]);
  const nav: NavItem[] = [
    { id: 'panel', label: 'Panel', icon: 'home' },
    { id: 'estudiantes', label: 'Estudiantes', icon: 'graduation', badge: badges.data?.pendingRegistrations },
    { id: 'usuarios', label: 'Usuarios', icon: 'users' },
    { id: 'cursos', label: 'Cursos', icon: 'book' },
    { id: 'reemplazos', label: 'Reemplazos', icon: 'refresh' },
    { id: 'excusas', label: 'Excusas', icon: 'file', badge: badges.data?.pendingExcuses },
    { id: 'mensajes', label: 'Mensajes', icon: 'message' },
    { id: 'reglas', label: 'Reglas', icon: 'settings' },
    { id: 'avisos', label: 'Avisos', icon: 'megaphone' },
    { id: 'actividad', label: 'Actividad', icon: 'shield' },
  ];
  return (
    <Shell nav={nav} current={tab} onSelect={setTab} label="Secciones de administración" side>
      {tab === 'panel' && <DashboardView go={setTab} />}
      {tab === 'estudiantes' && <StudentsView />}
      {tab === 'usuarios' && <UsersView />}
      {tab === 'cursos' && <CoursesView />}
      {tab === 'reemplazos' && <SubstitutionsView />}
      {tab === 'excusas' && <ExcusesAdminView />}
      {tab === 'mensajes' && <FeedbackView />}
      {tab === 'reglas' && <RulesView />}
      {tab === 'avisos' && <NoticesAdminView />}
      {tab === 'actividad' && <AuditView />}
    </Shell>
  );
}
