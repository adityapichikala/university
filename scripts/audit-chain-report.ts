import { PrismaClient } from '@prisma/client'
import { verifyAuditChain, getAuditHead } from '../lib/audit'

const p = new PrismaClient()

async function main() {
  const integrity = await verifyAuditChain(100000)
  console.log('verifyAuditChain →', JSON.stringify(integrity, null, 1))

  const head = await getAuditHead()
  console.log('head →', head ? `${head.actionType} ${head.hash?.slice(0, 12)}… len=${head.length}` : 'none')

  // Ordering sanity: the chain is walked by (timestamp, id).
  const byTs = await p.agentActionLog.findMany({
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    select: { id: true, timestamp: true },
  })
  let tsMismatch = 0
  for (let i = 1; i < byTs.length; i++) {
    if (byTs[i].timestamp < byTs[i - 1].timestamp) tsMismatch++
  }
  console.log('out-of-order timestamps:', tsMismatch)
  console.log('rows:', byTs.length)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => p.$disconnect())
