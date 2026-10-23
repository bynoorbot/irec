'use client'

import { Flame } from 'lucide-react'

interface SectorHeatmapProps {
  sectors: {
    bucket: string
    score: number
    verdict: string
    members: number
    weight_pct: number
  }[]
}

const verdictColor = (v: string) => {
  if (v === 'Hot') return 'text-[#00FFD0] bg-[#00D4AA]/10 border-[#00D4AA]/30'
  if (v === 'Neutral') return 'text-amber-300 bg-amber-400/10 border-amber-400/30'
  return 'text-[#8B95A8] bg-[#1E293B]/40 border-[#1E293B]'
}

export function DecisionSectorHeatmap({ sectors }: SectorHeatmapProps) {
  return (
    <section aria-label="Sector Ranking & Momentum" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-tight text-[#F1F5F9] font-[family-name:var(--font-geist-sans)]">
          Sector Momentum & Ranking
        </h3>
        <span className="text-[11px] font-mono text-[#8B95A8]">Score /10.0</span>
      </div>

      <p className="text-xs text-[#8B95A8]">
        Hot sectors receive new money. Ignore sectors get zero this cycle.
      </p>

      <div className="space-y-2 pt-1">
        {sectors.map((s) => {
          const isHot = s.verdict === 'Hot'
          const isIgnore = s.verdict === 'Ignore'
          const isOverConcentrated = s.weight_pct > 30

          return (
            <div
              key={s.bucket}
              className={`rounded-xl border p-2.5 sm:p-3 transition-colors ${
                isHot
                  ? 'border-[#00D4AA]/30 bg-[#141B2D]/80 shadow-[0_0_15px_rgba(0,212,170,0.05)]'
                  : 'border-[#1E293B] bg-[#141B2D]/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-[#F1F5F9] truncate">
                      {s.bucket}
                    </span>
                    {s.weight_pct > 0 && (
                      <span className={`text-[10px] font-mono tabular-nums ${isOverConcentrated ? 'text-amber-400 font-bold' : 'text-[#8B95A8]'}`}>
                        ({s.weight_pct}% held{isOverConcentrated ? ' ⚠️' : ''})
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 font-mono">
                  <span className="text-xs font-bold tabular-nums text-[#F1F5F9]">
                    {s.score.toFixed(1)}
                  </span>
                  <span
                    className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold border uppercase tracking-wider ${verdictColor(
                      s.verdict
                    )}`}
                  >
                    {isHot && <Flame size={10} className="text-[#00FFD0]" />}
                    <span>{s.verdict}</span>
                  </span>
                </div>
              </div>

              {/* Score Bar with Threshold Markers */}
              <div className="mt-2 relative h-1.5 w-full overflow-hidden rounded-full bg-[#0A0F1A]">
                <div
                  className={`h-full transition-all duration-500 ${
                    isHot ? 'bg-[#00D4AA]' : isIgnore ? 'bg-[#FF4D6A]/60' : 'bg-amber-400'
                  }`}
                  style={{ width: `${Math.min(100, (s.score / 10) * 100)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
