import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authorizePermission, scopes } from '@/lib/rbac'
import { PERMISSIONS } from '@/lib/roles'
import { audit } from '@/lib/audit'
import { contentDisposition, textPdfFile } from '@/lib/export-utils'

/**
 * GET /api/placements/drives/[id]/jd — download one drive's job description.
 *
 * Guarded by `placement.apply`, the same grant that lets a student see the
 * drive at all: being able to read the posting and being able to download it
 * are the same permission. The Tier-3 college scope is re-applied here rather
 * than trusted from the page, so a drive id from another tenant returns 404.
 *
 * The JD is rendered to a PDF on the fly from text stored on the drive. There
 * is no file store in this deployment, and a stored link would eventually
 * 404 — a JD that downloads is worth more than one that points at a dead URL.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await authorizePermission(req, PERMISSIONS.PLACEMENT_APPLY)
  if (!result.ok) return result.response

  const { id } = await params

  const drive = await prisma.placementDrive.findFirst({
    where: { id, ...scopes.college(result.ctx) },
    select: {
      id: true,
      companyName: true,
      role: true,
      eligibilityCriteria: true,
      packageOffered: true,
      driveDate: true,
      jobDescription: true,
    },
  })

  // Not found and not-yours are the same answer — otherwise the response
  // confirms which drive ids exist in another college.
  if (!drive) {
    return NextResponse.json({ error: 'Drive not found' }, { status: 404 })
  }

  const driveDate = drive.driveDate.toISOString().slice(0, 10)

  // A drive with no JD text still gets a useful document rather than a 404:
  // the structured fields are the parts a student needs most.
  const body =
    drive.jobDescription?.trim() ||
    'The detailed job description has not been published for this drive yet. ' +
      'The summary above is everything the placement office has released so far — ' +
      'contact them for the full posting.'

  const file = textPdfFile(
    [
      {
        heading: 'Role',
        body: `${drive.role}\n${drive.companyName} · ${drive.packageOffered}`,
      },
      { heading: 'Eligibility', body: drive.eligibilityCriteria },
      { heading: 'Drive date', body: driveDate },
      { heading: 'Job description', body },
    ],
    {
      title: drive.companyName,
      subtitle: `${drive.role} · campus drive ${driveDate}`,
      footer:
        'Issued by the Apex University placement cell. Details are indicative and may be ' +
        'revised by the recruiter; check the drive page for the latest.',
      basename: `jd-${drive.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    }
  )

  await audit({
    ctx: result.ctx,
    agentName: 'placement',
    actionType: 'PLACEMENT_JD_DOWNLOAD',
    targetEntity: 'PlacementDrive',
    entityId: drive.id,
    after: { company: drive.companyName, hasJd: Boolean(drive.jobDescription?.trim()) },
  })

  return new NextResponse(file.body, {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': contentDisposition(file.filename),
      // A JD is a point-in-time document; never serve a cached copy.
      'Cache-Control': 'no-store',
    },
  })
}
