import type { Role } from '@/lib/roles'

export interface NavItem {
  label: string
  /** Google Material Symbols Outlined ligature name. */
  icon: string
  /**
   * Omitted while the screen is not built yet (Phase 0 ships the shell only).
   * Link-less items render disabled with a "Soon" chip instead of 404-ing.
   */
  href?: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

/** Items for modules that do not exist yet. */
const soon = (label: string, icon: string): NavItem => ({ label, icon })

function overview(slug: string, label = 'Dashboard'): NavSection {
  return {
    title: 'Overview',
    items: [{ label, icon: 'space_dashboard', href: `/dashboard/${slug}` }],
  }
}

/**
 * Staff self-service: one shared route instead of eight per-role copies.
 * It is gated on `leave.request` rather than a role, so link it wherever
 * that permission is held.
 */
const myLeave = (): NavItem => ({ label: 'My Leave', icon: 'event_note', href: '/dashboard/leave' })

const selfService = (): NavSection => ({ title: 'Self-service', items: [myLeave()] })

/**
 * Role-aware navigation. Tier 1 decides the menu — but remember: hiding a link
 * is convenience, the API rejecting the request is security (architecture doc §2).
 */
export function getNav(role: Role): NavSection[] {
  const slug = roleSlugFor(role)

  switch (role) {
    case 'STUDENT':
      return [
        overview(slug),
        {
          title: 'Academics',
          items: [
            { label: 'My Courses', icon: 'menu_book', href: `/dashboard/${slug}/courses` },
            { label: 'Timetable', icon: 'calendar_month', href: `/dashboard/${slug}/timetable` },
            { label: 'Attendance', icon: 'fact_check', href: `/dashboard/${slug}/attendance` },
            { label: 'Assignments', icon: 'assignment', href: `/dashboard/${slug}/assignments` },
            { label: 'Results', icon: 'military_tech', href: `/dashboard/${slug}/results` },
          ],
        },
        {
          title: 'Campus',
          items: [
            { label: 'Fees', icon: 'payments', href: `/dashboard/${slug}/fees` },
            { label: 'Library', icon: 'local_library', href: `/dashboard/${slug}/library` },
            { label: 'Hostel', icon: 'hotel', href: `/dashboard/${slug}/hostel` },
            {
              label: 'Announcements',
              icon: 'campaign',
              href: `/dashboard/${slug}/announcements`,
            },
            { label: 'Placements', icon: 'work', href: `/dashboard/${slug}/placements` },
          ],
        },
      ]

    case 'TEACHER':
      return [
        overview(slug),
        {
          title: 'Teaching',
          items: [
            { label: 'My Courses', icon: 'menu_book', href: `/dashboard/${slug}/courses` },
            { label: 'Attendance', icon: 'fact_check', href: `/dashboard/${slug}/attendance` },
            { label: 'Exams & Marks', icon: 'quiz', href: `/dashboard/${slug}/exams` },
            { label: 'Assignments', icon: 'assignment', href: `/dashboard/${slug}/assignments` },
          ],
        },
        selfService(),
        {
          title: 'Class',
          items: [
            { label: 'Timetable', icon: 'calendar_month', href: `/dashboard/${slug}/timetable` },
            {
              label: 'Announcements',
              icon: 'campaign',
              href: `/dashboard/${slug}/announcements`,
            },
          ],
        },
      ]

    case 'HOD':
      return [
        overview(slug),
        {
          title: 'Department',
          items: [
            // One portal, three sections — the anchors jump straight to the
            // relevant card instead of making three near-identical routes.
            { label: 'Faculty', icon: 'groups', href: `/dashboard/${slug}#faculty` },
            { label: 'Courses', icon: 'menu_book', href: `/dashboard/${slug}#courses` },
            { label: 'Leave Approvals', icon: 'task_alt', href: `/dashboard/${slug}#leave` },
          ],
        },
        selfService(),
      ]

    case 'ADMIN':
      return [
        overview(slug, 'Governance'),
        {
          title: 'Administration',
          items: [
            { label: 'Users', icon: 'group', href: `/dashboard/${slug}/users` },
            { label: 'Academics', icon: 'menu_book', href: `/dashboard/${slug}/academics` },
            { label: 'Departments', icon: 'account_tree', href: `/dashboard/${slug}/departments` },
            { label: 'Admissions', icon: 'how_to_reg', href: `/dashboard/${slug}/admissions` },
          ],
        },
        {
          title: 'Governance',
          items: [
            { label: 'Access Control', icon: 'verified_user', href: `/dashboard/${slug}` },
            { label: 'Audit Log', icon: 'policy', href: `/dashboard/${slug}/audit` },
            soon('Notifications', 'notifications'),
          ],
        },
      ]

    case 'REGISTRAR':
      return [
        overview(slug),
        {
          title: 'Records',
          items: [
            { label: 'Issue Certificate', icon: 'workspace_premium', href: `/dashboard/${slug}#issue` },
            {
              label: 'Certificate Register',
              icon: 'history_edu',
              href: `/dashboard/${slug}#certificates`,
            },
            { label: 'Results', icon: 'military_tech', href: `/dashboard/${slug}#results` },
          ],
        },
        selfService(),
      ]

    case 'FINANCE':
      return [
        overview(slug),
        {
          title: 'Finance',
          items: [
            { label: 'Fee Desk', icon: 'payments', href: `/dashboard/${slug}` },
            soon('Reports', 'insights'),
          ],
        },
        selfService(),
      ]

    case 'LIBRARIAN':
      return [
        overview(slug),
        {
          title: 'Library',
          items: [
            { label: 'Circulation Desk', icon: 'swap_horiz', href: `/dashboard/${slug}` },
            soon('Catalog Import', 'auto_stories'),
          ],
        },
        selfService(),
      ]

    case 'WARDEN':
      return [
        overview(slug),
        {
          title: 'Hostel',
          items: [
            { label: 'Rooms & Beds', icon: 'bed', href: `/dashboard/${slug}` },
            soon('Maintenance', 'build'),
          ],
        },
        selfService(),
      ]

    case 'HR':
      return [
        overview(slug),
        {
          title: 'People',
          items: [
            { label: 'Employees', icon: 'badge', href: `/dashboard/${slug}#employees` },
            { label: 'Leave Requests', icon: 'event_busy', href: `/dashboard/${slug}#leave` },
          ],
        },
        selfService(),
      ]

    case 'PLACEMENT':
      return [
        overview(slug),
        {
          title: 'Placements',
          items: [
            { label: 'Drives', icon: 'business_center', href: `/dashboard/${slug}` },
            soon('Reports', 'insights'),
          ],
        },
        selfService(),
      ]

    case 'PARENT':
      return [
        overview(slug),
        {
          title: 'My Child',
          items: [
            { label: 'Attendance', icon: 'fact_check', href: `/dashboard/${slug}#attendance` },
            { label: 'Results', icon: 'military_tech', href: `/dashboard/${slug}#results` },
            { label: 'Fees', icon: 'payments', href: `/dashboard/${slug}#fees` },
          ],
        },
      ]

    default:
      return [overview(slug)]
  }
}

function roleSlugFor(role: Role): string {
  // Kept local so this module stays importable from client components.
  return role.toLowerCase()
}
