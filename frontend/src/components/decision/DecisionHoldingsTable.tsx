'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Idea } from './DecisionCandidateRow'

interface HoldingsTableProps {
  holdings: Idea[]
  alerts: { ticker: string; type: string; detail: string }[]
}

const scoreTextColor = (s: number) => {
  if (s >= 10) return 'text-[#00FFD0]'
  if (s >= 8) return 'text-amber-300'
  return 'text-[#FF8FA3]'
}

export function DecisionHoldingsTable({ holdings, alerts }: HoldingsTableProps) {
  return (
    <section aria-label="Portfolio Holdings & Governance" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-[#F1F5F9]">
            Portfolio Holdings Audit
          </h2>
          <p className="text-xs text-[#8B95A8]">
            Enforcing the ~5% single-stock ceiling & fundamental probation monitoring
          </p>
        </div>
        <span className="text-xs font-mono text-[#8B95A8]">
          {holdings.length} Active Positions
        </span>
      </div>

      {/* Actionable Alerts Box */}
      {alerts.length > 0 ? (
        <div className="space-y-2.5">
          {alerts.map((a, i) => {
            const isTrim = a.type.toLowerCase().includes('trim')
            const isProbation = a.type.toLowerCase().includes('probation')
            const isAllocation = a.type.toLowerCase().includes('allocation')

            return (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-xl border p-3.5 text-xs sm:text-sm leading-relaxed ${
                  isTrim
                    ? 'border-amber-400/40 bg-amber-400/5 text-amber-200'
                    : isProbation
                    ? 'border-[#FF4D6A]/40 bg-[#FF4D6A]/5 text-[#FF8FA3]'
                    : isAllocation
                    ? 'border-[#38BDF8]/40 bg-[#38BDF8]/5 text-[#7DD3FC]'
                    : 'border-amber-400/30 bg-amber-400/5 text-amber-300'
                }`}
              >
                {isProbation ? (
                  <ShieldAlert size={16} className="mt-0.5 shrink-0 text-[#FF4D6A]" />
                ) : (
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-300" />
                )}
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap font-mono">
                    <span className="font-bold text-[#F1F5F9]">{a.ticker}</span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase tracking-wider bg-black/40 border border-current">
                      {a.type}
                    </span>
                  </div>
                  <p className="text-xs text-[#CBD5E1] opacity-90">{a.detail}</p>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-[#00D4AA]/25 bg-[#00D4AA]/5 px-4 py-3 text-xs sm:text-sm text-[#00D4AA]">
          <ShieldCheck size={16} className="shrink-0" />
          <span>Nothing needs action. Healthy holdings stay silent by design.</span>
        </div>
      )}

      {/* Holdings Table with Cap Corridor */}
      <div className="overflow-x-auto rounded-xl border border-[#1E293B] bg-[#141B2D]/60 backdrop-blur-md">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead>
            <tr className="border-b border-[#1E293B] bg-[#0A0F1A]/80 text-[11px] font-semibold uppercase tracking-wider text-[#8B95A8] font-mono">
              <th className="px-4 py-3">Holding</th>
              <th className="px-4 py-3">Weight</th>
              <th className="px-4 py-3">Cap Corridor (~5% Cap)</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Inspect</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E293B]">
            {holdings.map((h) => {
              const isEtfHolding = h.bucket === 'ETF Base' || h.verdict === 'Core ETF' || h.is_etf
              const isOverCap = !isEtfHolding && h.weight_pct > 5.0
              const isSevereOverCap = !isEtfHolding && h.weight_pct >= 5.5
              const isHealthy = h.verdict === 'Healthy' || h.verdict === 'Core ETF'
              const isProbation = h.verdict === 'Probation'

              // Cap corridor math: scale 0% - 10%
              const corridorPct = Math.min(100, (h.weight_pct / 10) * 100)

              return (
                <tr key={h.ticker} className="transition-colors hover:bg-[#111827]/70">
                  {/* Holding & Bucket */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <Link
                        href={`/ticker?ticker=${h.ticker}`}
                        className="font-mono font-bold text-[#F1F5F9] hover:text-[#00FFD0] transition-colors"
                      >
                        {h.ticker}
                      </Link>
                      <span className="text-[11px] text-[#8B95A8] truncate max-w-[140px]">
                        {h.bucket}
                      </span>
                    </div>
                  </td>

                  {/* Weight % */}
                  <td className="px-4 py-3 font-mono font-semibold tabular-nums text-[#F1F5F9]">
                    <div className="flex items-center gap-1.5">
                      <span>{h.weight_pct}%</span>
                      {isSevereOverCap && (
                        <span className="rounded bg-[#FF4D6A]/20 px-1 py-0.2 font-mono text-[9px] font-bold text-[#FF8FA3]">
                          TRIM
                        </span>
                      )}
                      {isEtfHolding && (
                        <span className="rounded bg-[#38BDF8]/15 border border-[#38BDF8]/30 px-1.5 py-0.2 font-mono text-[9px] font-bold text-[#7DD3FC]">
                          ETF
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Cap Corridor (0% to 10% with 5% reference marker, or ETF indicator) */}
                  <td className="px-4 py-3">
                    {isEtfHolding ? (
                      <span className="text-[11px] font-mono font-semibold text-[#7DD3FC]">
                        Foundation Allocation
                      </span>
                    ) : (
                      <div className="relative h-2 w-36 overflow-hidden rounded-full bg-[#0A0F1A] border border-[#2A364D]">
                        {/* 5% Ceiling vertical reference marker */}
                        <div
                          className="absolute bottom-0 top-0 w-0.5 bg-amber-400/80 z-10"
                          style={{ left: '50%' }}
                          title="5.0% Target Cap"
                        />
                        <div
                          className={`h-full transition-all duration-300 ${
                            isSevereOverCap
                              ? 'bg-[#FF4D6A]'
                              : isOverCap
                              ? 'bg-amber-400'
                              : 'bg-[#00D4AA]'
                          }`}
                          style={{ width: `${corridorPct}%` }}
                        />
                      </div>
                    )}
                  </td>

                  {/* Score /12 */}
                  <td className="px-4 py-3 font-mono tabular-nums font-semibold">
                    <span className={scoreTextColor(h.score)}>{h.score}</span>
                    <span className="text-xs text-[#8B95A8]">/12</span>
                  </td>

                  {/* Status Badge */}
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${
                        isEtfHolding
                          ? 'bg-[#38BDF8]/10 text-[#7DD3FC] border border-[#38BDF8]/25'
                          : isHealthy
                          ? 'bg-[#00D4AA]/10 text-[#00D4AA] border border-[#00D4AA]/25'
                          : isProbation
                          ? 'bg-[#FF4D6A]/10 text-[#FF8FA3] border border-[#FF4D6A]/25'
                          : 'bg-amber-400/10 text-amber-300 border border-amber-400/25'
                      }`}
                    >
                      {isEtfHolding ? (
                        <ShieldCheck size={12} />
                      ) : isHealthy ? (
                        <CheckCircle2 size={12} />
                      ) : isProbation ? (
                        <ShieldAlert size={12} />
                      ) : (
                        <AlertTriangle size={12} />
                      )}
                      <span>{h.verdict}</span>
                    </span>
                  </td>

                  {/* Action Link */}
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/ticker?ticker=${h.ticker}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#8B95A8] hover:text-[#00FFD0] transition-colors focus-visible:outline-none focus-visible:underline"
                    >
                      <span>Terminal</span>
                      <ArrowUpRight size={13} />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
