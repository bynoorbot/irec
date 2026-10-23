'use client'

import { Scale } from 'lucide-react'

export interface LogEntry {
  action: string
  ticker?: string | null
  reason: string
  created_at?: string | null
}

interface AuditLogProps {
  log: LogEntry[]
  benchmarkNote: string
}

export function DecisionAuditLog({ log, benchmarkNote }: AuditLogProps) {
  return (
    <section aria-label="Decision Audit Log & Benchmark Proof" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-tight text-[#F1F5F9] font-[family-name:var(--font-geist-sans)]">
          Decision Audit Trail
        </h3>
        <span className="text-[11px] font-mono text-[#8B95A8]">Last {Math.min(log.length, 6)} Runs</span>
      </div>

      <div className="space-y-3 pt-1">
        {log.slice(0, 6).map((entry, idx) => (
          <div
            key={idx}
            className="relative rounded-xl border border-[#1E293B] bg-[#141B2D]/40 p-3 text-xs space-y-1"
          >
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="font-bold text-[#F1F5F9]">
                {entry.action} {entry.ticker || ''}
              </span>
              <span className="text-[#8B95A8] tabular-nums">
                {entry.created_at ? new Date(entry.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
              </span>
            </div>
            <p className="text-[#94A3B8] leading-relaxed text-[11px] line-clamp-2">
              {entry.reason}
            </p>
          </div>
        ))}

        {log.length === 0 && (
          <p className="rounded-lg border border-[#1E293B] bg-[#141B2D]/20 p-3 text-xs text-[#8B95A8] italic">
            No decisions logged yet. Each weekly run records its call here to benchmark stock picks against the ETF.
          </p>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-[#1E293B] bg-[#0A0F1A]/60 p-3 text-xs text-[#8B95A8]">
        <Scale size={14} className="mt-0.5 shrink-0 text-[#00D4AA]" />
        <p className="leading-relaxed text-[11px]">
          <span className="font-semibold text-[#CBD5E1]">Benchmark Invariant: </span>
          {benchmarkNote}
        </p>
      </div>
    </section>
  )
}
