'use client'

export function DecisionSkeleton() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6 animate-pulse">
      {/* Header Skeleton */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-64 rounded-md bg-[#141B2D]" />
          <div className="h-4 w-96 rounded-md bg-[#141B2D]/60" />
        </div>
        <div className="h-10 w-36 rounded-md bg-[#141B2D]" />
      </div>

      {/* Telemetry Strip Skeleton */}
      <div className="mt-6 h-14 w-full rounded-xl border border-[#1E293B]/80 bg-[#141B2D]/60" />

      {/* Apex Directive Skeleton */}
      <div className="mt-6 h-56 w-full rounded-2xl border border-[#00D4AA]/20 bg-[#141B2D]/80" />

      {/* Main Grid Skeleton */}
      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <div className="h-6 w-48 rounded bg-[#141B2D]" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl border border-[#1E293B] bg-[#141B2D]/40 p-5 space-y-3">
                <div className="flex justify-between">
                  <div className="h-6 w-32 rounded bg-[#1E293B]" />
                  <div className="h-6 w-16 rounded bg-[#1E293B]" />
                </div>
                <div className="h-2 w-full rounded bg-[#1E293B]/60" />
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-2">
                  {[1, 2, 3, 4, 5, 6].map((j) => (
                    <div key={j} className="h-8 rounded bg-[#1E293B]/40" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="h-64 rounded-xl border border-[#1E293B] bg-[#141B2D]/40 p-4" />
          <div className="h-48 rounded-xl border border-[#1E293B] bg-[#141B2D]/40 p-4" />
        </div>
      </div>
    </main>
  )
}
