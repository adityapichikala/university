# Apex University ERP

A full-featured, multi-role campus management platform built with **Next.js 16**, **Prisma**, and **PostgreSQL** (via [Supabase](https://supabase.com/)). The system serves 11 distinct roles from students and faculty to wardens and placement officers, each with their own dashboard, permissions, and workflows.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Authentication and RBAC](#authentication-and-rbac)
- [Roles and Dashboards](#roles-and-dashboards)
- [Feature Modules](#feature-modules)
- [API Routes](#api-routes)
- [Design System](#design-system)
- [Scripts and Tooling](#scripts-and-tooling)
- [Known Limitations and Roadmap](#known-limitations-and-roadmap)

---

## Overview

Apex University ERP is a unified campus management platform that consolidates academic, financial, HR, hostel, library, and placement workflows into one application. It is architected around a **three-tier RBAC** model:

| Tier | Enforcement | Purpose |
|------|-------------|---------|
| **Tier 1** | Role guard (route-level) | Each user belongs to exactly one of 11 roles and can only access their own dashboard namespace |
| **Tier 2** | Permission guard (feature-level) | Fine-grained capabilities (`grade.entry`, `fee.manage`, ...) are granted per role and can be overridden per user |
| **Tier 3** | Query scope (data-level) | Every DB query is scoped to `collegeId`, `departmentId`, or `userId` � no cross-tenant data leaks |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org/) (App Router, Turbopack) |
| Language | TypeScript 5 |
| Database ORM | [Prisma 5](https://www.prisma.io/) |
| Database | PostgreSQL, hosted on [Supabase](https://supabase.com/) (dev and prod) |
| Auth | JWT via [`jose`](https://github.com/panva/jose) � no NextAuth |
| Styling | Tailwind CSS v4 + custom design tokens |
| UI Components | Custom components (`components/ui/`) + [Base UI](https://base-ui.com/) |
| Tables | [TanStack Table v8](https://tanstack.com/table) |
| Icons | Google Material Symbols Outlined (CDN) |
| Fonts | Plus Jakarta Sans, Manrope, JetBrains Mono (Google Fonts, self-hosted by Next) |
| Email | Nodemailer (OTP-based password reset) |
| QR Codes | `qrcode` package (hostel leave slips) |

---

## Project Structure

```
university/
|-- app/
|   |-- (auth)/
|   |   |-- login/            # Login page + form
|   |   `-- forgot-password/  # OTP-based password reset
|   |-- api/                  # Route handlers (REST API)
|   |   |-- auth/             # login, logout, forgot-password
|   |   |-- admin/            # users, permissions, departments
|   |   |-- announcements/    # CRUD + read-receipt
|   |   |-- attendance/       # mark + fetch attendance
|   |   |-- courses/          # course list + enrollment
|   |   |-- fees/             # fee records + payments
|   |   |-- hostel/           # rooms, allocations, leaves
|   |   |-- library/          # catalog, issues, returns
|   |   |-- placements/       # drives + applications
|   |   |-- results/          # exam results
|   |   |-- timetable/        # slot management
|   |   `-- telemetry/        # crash reporting
|   `-- dashboard/
|       |-- layout.tsx        # Shell: Sidebar + Header (role-aware)
|       |-- admin/            # Admin governance console
|       |-- finance/          # Fee desk
|       |-- hod/              # Department portal
|       |-- hr/               # Employee + leave management
|       |-- leave/            # Shared staff self-service leave
|       |-- librarian/        # Library circulation desk
|       |-- parent/           # Read-only child portal
|       |-- placement/        # Drive management
|       |-- registrar/        # Certificates + results
|       |-- student/          # Full student portal
|       |-- teacher/          # Teaching portal
|       `-- warden/           # Hostel management
|-- components/
|   |-- dashboard/            # Sidebar, Header, NavItems, KpiCard, DataTable ...
|   `-- ui/                   # Button, Card, Input, Switch, Toast, DataTable ...
|-- lib/                      # Server-side business logic (no UI imports)
|   |-- auth.ts               # JWT sign/verify + session cookie helpers
|   |-- rbac.ts               # requireUser / authorize / scopes (the guard chain)
|   |-- roles.ts              # Role constants + permission keys
|   |-- db.ts                 # Prisma singleton
|   |-- mailer.ts             # Nodemailer wrapper (SMTP + console fallback)
|   |-- permissions.ts        # Tier-2 matrix + section-access logic
|   |-- enrollment.ts         # Seat-cap + waitlist logic
|   |-- announcements.ts      # Feed + read-receipt
|   |-- audit.ts              # Immutable audit log writer
|   `-- ...                   # Domain modules (fees, hostel, library, ...)
|-- prisma/
|   |-- schema.prisma         # Single source of truth for the DB schema
|   `-- seed.ts               # Demo data seeder
|-- scripts/                  # Standalone verification / smoke-test scripts
|-- types/                    # Ambient TypeScript declarations
|-- next.config.ts
|-- tsconfig.json
`-- package.json
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **npm** >= 10

### Install and run

```bash
# 1. Install dependencies (also runs prisma generate via postinstall)
npm install

# 2. Copy the env template and fill in your Supabase connection strings + JWT_SECRET
cp .env.example .env

# 3. Push the schema to your Supabase Postgres database
npm run db:push

# 4. Seed demo accounts and sample data
npm run db:seed

# 5. Start the development server
npm run dev
```

Visit **http://localhost:3000** � you will be redirected to `/login`.

### Demo accounts

All demo accounts use the password **`password123`**.

| Registration No | Role | Dashboard |
|-----------------|------|-----------|
| `STU001` | Student | `/dashboard/student` |
| `TCH001` | Teacher | `/dashboard/teacher` |
| `ADM001` | Administrator | `/dashboard/admin` |
| `HOD001` | Head of Department | `/dashboard/hod` |
| `FIN001` | Finance Officer | `/dashboard/finance` |
| `LIB001` | Librarian | `/dashboard/librarian` |
| `WAR001` | Warden | `/dashboard/warden` |
| `HR001` | HR Manager | `/dashboard/hr` |
| `PLC001` | Placement Officer | `/dashboard/placement` |
| `REG001` | Registrar | `/dashboard/registrar` |
| `PAR001` | Parent | `/dashboard/parent` |

---

## Environment Variables

Create a `.env` file at the project root — copy `.env.example` and fill in your own values (no `.env` ships with the repo; it's gitignored):

```dotenv
# Required — Supabase Settings -> Database -> Connection string
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"  # pooled, used by the app
DIRECT_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"                  # direct, used by `prisma migrate`
JWT_SECRET="your-secret-at-least-32-chars"

# Optional � email/OTP password reset
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_USER="user@example.com"
SMTP_PASS="yourpassword"
MAIL_FROM="no-reply@apex.edu"

# Optional � move the Next.js build output outside OneDrive sync (Windows)
NEXT_DIST_DIR="C:/next-build/university"
```

> **Security note:** The default `JWT_SECRET` in `.env` is for local development only. Always set a strong, random secret in production.

---

## Database

### Schema highlights

- **Multi-tenant ready**: every model has a `collegeId` column + index. Adding more colleges is a query-scope change, not a migration.
- **Postgres via Supabase**: enums are still plain strings (validated in TypeScript) even though native Postgres enums are now available — kept as-is to minimize migration risk, not a technical constraint.
- **Key models**: `College`, `Department`, `User`, `Course`, `Class`, `CourseEnrollment`, `Attendance`, `Assignment`, `Submission`, `Grade`, `Exam`, `ExamResult`, `FeeStructure`, `FeeRecord`, `FeePayment`, `LibraryItem`, `LibraryIssue`, `HostelRoom`, `HostelAllocation`, `HostelLeave`, `Employee`, `LeaveRequest`, `PlacementDrive`, `PlacementApplication`, `Notification`, `Certificate`, `AgentActionLog`.

### Useful commands

```bash
npm run db:push      # Sync schema to DB (no migration files � dev only)
npm run db:migrate   # Create a named migration (staging / prod)
npm run db:seed      # Seed demo data
npm run db:reset     # Drop all data and re-seed
npm run db:studio    # Open Prisma Studio GUI on http://localhost:5555
npm run db:generate  # Regenerate Prisma client after schema changes
```

---

## Authentication and RBAC

### Session flow

```
Browser                 Server
  |--- POST /api/auth/login ---> verify regno+password (bcrypt)
  |                              sign JWT (jose, HS256, 7-day TTL)
  |<-- Set-Cookie: session ----- store in httpOnly cookie
  |
  |--- GET /dashboard/student -> requireUser()
  |                              1. verifySession (JWT)
  |                              2. prisma.user.findUnique
  |                              3. matchesRoute (role <-> URL slug)
  |                              4. loadPermissions (role grants + user overrides)
  |<-- Render dashboard --------
```

### Guards

| Function | Used in | Behaviour on fail |
|----------|---------|-------------------|
| `requireUser()` | Server Components, Server Actions | Redirect to `/login` or own dashboard |
| `requirePermission(key)` | Server Components, Server Actions | Redirect to own dashboard |
| `authorize(req)` | Route Handlers | JSON `401` / `403` |
| `authorizePermission(req, key)` | Route Handlers | JSON `403` |

### Query scopes (lib/rbac.ts)

```typescript
scopes.college(ctx)         // { collegeId }    multi-tenant isolation
scopes.department(ctx)      // { departmentId } HOD sees their dept only
scopes.taughtCourses(ctx)   // { teacherId }    teacher's own courses
scopes.own(ctx)             // { studentId }    student's own rows
```

---

## Roles and Dashboards

| Role | Slug | Key capabilities |
|------|------|-----------------|
| `STUDENT` | `/dashboard/student` | Courses, attendance, assignments, results, fees, library, hostel, placements, announcements |
| `TEACHER` | `/dashboard/teacher` | Mark attendance, grade assignments, set exams, announcements |
| `HOD` | `/dashboard/hod` | Department overview, faculty workload, course list, leave approvals |
| `ADMIN` | `/dashboard/admin` | User management, RBAC overrides, departments, admissions, audit log |
| `REGISTRAR` | `/dashboard/registrar` | Issue certificates (bonafide, transcript, no-dues), view results |
| `FINANCE` | `/dashboard/finance` | Fee structures, assign fees, record payments |
| `LIBRARIAN` | `/dashboard/librarian` | Catalog management, issue/return books, fines |
| `WARDEN` | `/dashboard/warden` | Hostel rooms, allocations, approve student leave |
| `HR` | `/dashboard/hr` | Employee register, approve/reject leave requests |
| `PLACEMENT` | `/dashboard/placement` | Create drives, manage applications pipeline |
| `PARENT` | `/dashboard/parent` | Read-only view of child's attendance, results, fees |

---

## Feature Modules

### Academics
- **Courses** � per-department, teacher-assigned, section-access locks per class
- **Timetable** � weekly slot grid per section with room assignments
- **Calendar** � academic calendar with holidays, closures, events
- **Attendance** � per-course, per-student; percentage dashboard for students
- **Assignments** � teacher creates, students submit, teacher grades with rubric support
- **Grading** � score + feedback + AI-suggested score field + re-grade history trail
- **Exams and Results** � midterm/final/quiz types, semester-linked, publish gate (null = hidden from students)

### Finance
- **Fee Structures** � program x batch x amount x due date
- **Fee Records** � one record per student per structure with installment payments
- **Online Payment** � in-app modal to record a payment with method (cash, UPI, bank transfer)

### Library
- **Catalog** � title, author, ISBN, copy count, available copies (auto-decremented)
- **Circulation** � issue/return with automatic fine calculation on overdue returns

### Hostel
- **Rooms** � block + room number + capacity management
- **Allocations** � one active allocation per student
- **Student Leave** � request -> warden approval -> printable QR leave slip + PDF download

### HR and Leave
- **Employee Register** � links a `User` to designation, salary band, join date
- **Staff Leave** � any staff files a request; HOD / HR approves; shared `LeaveQueue` component

### Placements
- **Drives** � company, role, eligibility criteria, drive date, package offered, JD text
- **Applications** � APPLIED -> SHORTLISTED -> INTERVIEWED -> OFFERED / REJECTED with withdrawal reason

### Announcements
- **Broadcast** � targeted by role / department / class / individual user
- **Priority levels** � URGENT, HIGH, NORMAL, LOW
- **Read receipts** � per-user, drives the bell badge count and top-of-page banner

### Registrar / Certificates
- **Certificate types** � BONAFIDE, TRANSCRIPT, NO_DUES
- **QR-verified download** � issued, logged, auditable

### Admin Governance
- **User management** � create / update / deactivate accounts with full CSV/PDF export
- **Per-user permission overrides** � Default | Allow | Deny matrix for every permission key
- **Section access locks** � lock a class section out of a specific course (Tier 3)
- **Department management** � create/rename departments, appoint HOD
- **Admissions** � applicant pipeline with merit score, convert to student account
- **Audit log** � immutable record of every governance write with before/after JSON

---

## API Routes

All routes live under `/api/`. Route handlers use `authorize()` / `authorizePermission()` and always return JSON.

| Method + Path | Description |
|---------------|-------------|
| `POST /api/auth/login` | Issue a session cookie |
| `POST /api/auth/logout` | Clear the session cookie |
| `POST /api/auth/forgot-password` | Send OTP to email |
| `POST /api/auth/reset-password` | Verify OTP + set new password |
| `GET /api/admin/users` | List all users in college |
| `POST /api/admin/users` | Create a new user |
| `PATCH /api/admin/users/[id]` | Update user fields |
| `DELETE /api/admin/users/[id]` | Deactivate user |
| `GET /api/admin/users/export` | Download full register (CSV or PDF) |
| `PUT /api/admin/permissions` | Set per-user permission override |
| `GET /api/announcements` | Fetch announcement feed |
| `POST /api/announcements` | Create announcement |
| `PATCH /api/announcements/[id]/read` | Mark announcement as read |
| `GET /api/attendance` | Fetch attendance records |
| `POST /api/attendance` | Mark attendance for a session |
| `GET/POST /api/courses` | List / create courses |
| `GET/POST /api/enrollments` | List / enroll students |
| `GET/POST /api/fees` | Fee structures + records |
| `GET/POST /api/hostel` | Rooms + allocations |
| `GET/POST /api/library` | Catalog + issues |
| `GET/POST /api/placements` | Drives + applications |
| `GET /api/results` | Exam results |
| `GET/POST /api/timetable` | Timetable slots |

---

## Design System

All tokens are defined in `app/globals.css` under `@theme` and referenced via Tailwind utility classes.

### Color tokens

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-primary` | `#000000` | Headings, primary buttons |
| `--color-accent` | `#4b41e1` | Active states, CTAs (indigo) |
| `--color-accent-soft` | `#eeecfd` | Active nav backgrounds |
| `--color-background` | `#f8f9ff` | App canvas |
| `--color-surface` | `#ffffff` | Cards, sidebar, header |
| `--color-foreground` | `#0b0b0f` | Primary text |
| `--color-muted` | `#65677a` | Secondary text |
| `--color-subtle` | `#9a9cb0` | Placeholders, meta text |
| `--color-border` | `#e9eaf6` | Default borders |
| `--color-success` | `#16a34a` | Success states |
| `--color-warning` | `#d97706` | Warning states |
| `--color-danger` | `#dc2626` | Error/danger states |

### Typography

| Variable | Font | Usage |
|----------|------|-------|
| `--font-heading` | Plus Jakarta Sans | All h1-h6 headings |
| `--font-body` | Manrope | Body text |
| `--font-mono` | JetBrains Mono | Numbers, IDs, codes (`.num` class) |

### Conventions

- Apply the `.num` CSS class to any numeric value (roll numbers, KPIs, IDs, amounts).
- Icons: `<span className="material-symbols-outlined">icon_name</span>` � no separate icon library.
- Error UI: `bg-danger-soft text-danger` | Success UI: `bg-success-soft text-success`.
- All cards use the `card` utility class (defined in `@utility` block).

---

## Scripts and Tooling

```bash
npm run dev           # Start dev server with Turbopack hot reload
npm run build         # Production build
npm run start         # Serve the production build
npm run lint          # ESLint (Next.js + TypeScript + React Hooks rules)
npx tsc --noEmit      # Type-check without emitting files
npm run db:seed       # Seed demo data
npm run db:studio     # Prisma Studio on http://localhost:5555
```

### Verification scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `smoke-roles.sh` | End-to-end role redirect tests via curl |
| `verify-student.sh` | Student workflow (login, courses, attendance) |
| `verify-admin.sh` | Admin user and permission workflow |
| `verify-enrollment.ts` | Enrollment seat-cap and waitlist logic |
| `verify-otp.ts` | OTP password reset flow |
| `verify-phase5.sh` | Full Phase 5 feature smoke test |

---

## Known Limitations and Roadmap

| Area | Status | Notes |
|------|--------|-------|
| File uploads | Not implemented | `fileUrl` / `documentsUrl` fields exist but storage layer is not wired. Use an external bucket (S3, Cloudinary). |
| Email delivery | Console fallback in dev | Set `SMTP_*` env vars to actually send OTP emails. |
| Admin notifications | Soon | Nav item exists; page not yet built. |
| Finance reports | Soon | Summarised fee analytics planned. |
| Library bulk import | Soon | CSV catalog import planned. |
| Hostel maintenance | Soon | Student maintenance ticket flow planned. |
| QR img element | Warning | The QR code in `HostelLeavePanel` uses a raw `<img>` for a base64 data URL. `next/image` does not support data URLs without a custom loader. |
| TanStack memoization | Info | `useReactTable` returns new function references each render; React Compiler skips memoising `DataTable`. No functional impact. |

---

## Architecture Notes

- **No `next-auth`** � the JWT is managed manually with `jose` so it works in the Edge runtime with no third-party session store dependency.
- **No client-side data fetching** � all data loading happens in Server Components via Prisma. Client components receive fully serialised props.
- **Audit trail** � every write that changes permissions, certificates, or financial records is written to `AgentActionLog` with full before/after JSON snapshots.
- **Crash telemetry** � `app/global-error.tsx` catches uncaught client errors and reports them to `/api/telemetry` with a structured payload.
- **OneDrive compatibility** � `next.config.ts` reads `NEXT_DIST_DIR` to place the build cache outside the synced folder, avoiding Windows EPERM errors during `next build`.
