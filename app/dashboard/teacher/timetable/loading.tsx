import { Skeleton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'

export default function TeacherTimetableLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-[28rem]" />
      </div>
      <Skeleton className="mb-4 h-8 w-28 rounded-xl" />
      <Card className="p-4">
        <Skeleton className="h-[420px] w-full" />
      </Card>
    </div>
  )
}
