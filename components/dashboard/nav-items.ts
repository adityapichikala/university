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
            soon('My Courses', 'menu_book'),
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
            soon('Placements', 'work'),
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
        {
          title: 'Class',
          items: [
            { label: 'Timetable', icon: 'calendar_month', href: `/dashboard/${slug}/timetable` },
            soon('Announcements', 'campaign'),
          ],
        },
      ]

    case 'HOD':
      return [
        overview(slug),
        {
          title: 'Department',
          items: [
            soon('Faculty', 'groups'),
            soon('Courses', 'menu_book'),
            soon('Approvals', 'task_alt'),
          ],
        },
      ]

    case 'ADMIN':
      return [
        overview(slug, 'Governance'),
        {
          title: 'Administration',
          items: [
            { label: 'Users', icon: 'group', href: `/dashboard/${slug}/users` },
            { label: 'Academics', icon: 'menu_book', href: `/dashboard/${slug}/academics` },
            soon('Departments', 'account_tree'),
            soon('Admissions', 'how_to_reg'),
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
            soon('Exams', 'quiz'),
            soon('Results', 'military_tech'),
            soon('Certificates', 'workspace_premium'),
          ],
        },
      ]

    case 'FINANCE':
      return [
        overview(slug),
        {
          title: 'Finance',
          items: [soon('Fee Structures', 'payments'), soon('Reports', 'insights')],
        },
      ]

    case 'LIBRARIAN':
      return [
        overview(slug),
        {
          title: 'Library',
          items: [soon('Catalog', 'auto_stories'), soon('Issues & Returns', 'swap_horiz')],
        },
      ]

    case 'WARDEN':
      return [
        overview(slug),
        {
          title: 'Hostel',
          items: [soon('Rooms', 'door_front'), soon('Allocations', 'bed')],
        },
      ]

    case 'HR':
      return [
        overview(slug),
        {
          title: 'People',
          items: [soon('Employees', 'badge'), soon('Leave Requests', 'event_busy')],
        },
      ]

    case 'PLACEMENT':
      return [
        overview(slug),
        {
          title: 'Placements',
          items: [soon('Drives', 'business_center'), soon('Applications', 'work')],
        },
      ]

    case 'PARENT':
      return [
        overview(slug),
        {
          title: 'My Child',
          items: [soon('Attendance', 'fact_check'), soon('Results', 'military_tech')],
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
