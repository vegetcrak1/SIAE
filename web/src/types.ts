export type Role = 'admin' | 'profesor' | 'estudiante' | 'padre';
export type Status = 'puntual' | 'tarde' | 'ausente' | 'justificado';
export type ExcuseKind = 'medica' | 'personal' | 'error_registro';
export type ExcuseState = 'pendiente' | 'aprobada' | 'rechazada';
export type Level = 'info' | 'warning' | 'critical';

export interface User { id: number; role: Role; name: string; email: string | null; grade: string | null; mustChangePassword: boolean; passwordIsDefault: boolean }
export interface SessionInfo { user: User | null; redirectTo?: string }
export interface AppConfig { institution: string; googleClientId: string | null; passwordDigits: number }

export interface Course { id: number; grade: string; subject: string; blockId: string; blockLabel: string; start: string | null; room: string; active: boolean }
export interface AttendanceRow { id: number; date: string; status: Status; minutesLate: number | null; scannedAt: number | null; method: string; observation: string; courseId: number; subject: string }
export interface Evidence { id: number; name: string; mime: string; size: number }
export interface Excuse { id: number; date: string; kind: ExcuseKind; reason: string; status: ExcuseState; createdAt: number; subject: string; evidence: Evidence[] }
export type Counts = Record<Status, number>;

export interface StudentOverview { today: string; student: { name: string; grade: string; documento: string | null }; courses: Course[]; records: AttendanceRow[]; excuses: Excuse[]; counts: Counts; riskThreshold: number }
export interface GuardianStudent { id: number; name: string; grade: string; status: string; documento: string | null; courses: Course[]; records: AttendanceRow[]; excuses: Excuse[]; counts: Counts }
export interface GuardianOverview { riskThreshold: number; today: string; students: GuardianStudent[] }

export interface NotificationItem { id: number; title: string; body: string; level: Level; createdAt: number; read: boolean }

export interface TeacherClass extends Course { substitute: boolean; covering: string | null }
export interface RosterStudent { id: number; name: string; record: { status: Status; minutesLate: number | null; scannedAt: number | null; method: string } | null }
export interface Roster { date: string; course: Course; limits: { tolerance: number; absentAfter: number }; contingency: string | null; students: RosterStudent[] }
export interface ScanResult { student: { id: number; name: string }; status: Status; minutesLate: number; scannedAt: number }

export interface Block { id: string; label: string; start: string }
export interface Rules { toleranceMinutes: number; absentAfterMinutes: number; riskThreshold: number; blocks: Block[]; contingency: { active: boolean; extraMinutes: number; reason: string; activatedAt: number | null } }
