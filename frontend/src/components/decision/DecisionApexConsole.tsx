'use client'

import Link from 'next/link'
import { ArrowUpRight, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react'

interface ApexConsoleProps {
  thisWeek: {
    action: string
    ticker: string
    bucket: string
    reason: string
    tranche_note: string
  }
}

export function DecisionApexConsole({ thisWeek }: ApexConsoleProps) {
  const isEtf = thisWeek.action.toLowerCase().includes('etf')
  const isStart = thisWeek.action.toLowerCase().includes('start')

  return (
    <section
      aria-label="Where this week's money goes"
      className="relative overflow-hidden rounded-2xl border border-[#00D4AA]/30 bg-[#141B2D]/90 p-5 sm:p-7 shadow-[0_4px_30px_rgba(0,0,0,0.4)] backdrop-blur-md"
    >
      {/* Background ambient radial glow */}
      <div
        className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#00D4AA]/5 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-3 min-w-0 flex-1">
          {/* Action Badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold font-mono uppercase tracking-wider ${
                isEtf
                  ? 'bg-[#38BDF8]/10 text-[#38BDF8] border border-[#38BDF8]/25'
                  : isStart
                  ? 'bg-[#00D4AA]/15 text-[#00FFD0] border border-[#00D4AA]/35 shadow-[0_0_15px_rgba(0,212,170,0.15)]'
                  : 'bg-emerald-400/15 text-emerald-300 border border-emerald-400/30'
              }`}
            >
              {isEtf ? (
                <>
                  <ShieldCheck size={13} /> Systematic Shariah Allocation
                </>
              ) : (
                <>
                  <Sparkles size={13} /> Strict Alpha Buy Bar Passed
                </>
              )}
            </span>

            <span className="text-xs text-[#8B95A8] font-mono">Weekly Directive</span>
          </div>

          {/* Hero Ticker & Identity */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#F1F5F9] font-mono">
              <span className="text-[#8B95A8] font-medium mr-2">{thisWeek.action}</span>
              <span className="text-[#00FFD0]">{thisWeek.ticker}</span>
            </h2>
            <span className="text-sm font-semibold text-[#8B95A8] px-2.5 py-0.5 rounded-md bg-[#0A0F1A] border border-[#1E293B]">
              {thisWeek.bucket}
            </span>
          </div>

          {/* Rationale & Tranche Execution Guidance */}
          <p className="max-w-[72ch] text-sm sm:text-base leading-relaxed text-[#CBD5E1]">
            {thisWeek.reason}
          </p>

          <div className="flex items-start gap-2.5 rounded-xl border border-[#2A364D]/60 bg-[#0A0F1A]/60 px-4 py-3 text-xs sm:text-sm text-[#94A3B8]">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#00D4AA]" />
            <div className="space-y-0.5">
              <span className="font-semibold text-[#F1F5F9]">Execution Blueprint: </span>
              <span>{thisWeek.tranche_note}</span>
            </div>
          </div>
        </div>

        {/* Action Link & Terminal Deep Link */}
        <div className="shrink-0 flex flex-row md:flex-col items-center gap-2.5">
          <Link
            href={`/ticker?s=${thisWeek.ticker}`}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#00D4AA] px-4 py-2.5 text-xs sm:text-sm font-bold text-[#06251D] shadow-sm transition-all hover:bg-[#00FFD0] hover:shadow-[0_0_20px_rgba(0,212,170,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA] active:scale-[0.98]"
          >
            <span>Inspect {thisWeek.ticker}</span>
            <ArrowUpRight size={15} />
          </Link>
          <Link
            href="/portfolio"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#2A364D] bg-[#0A0F1A] px-3 py-2 text-xs font-semibold text-[#8B95A8] transition-colors hover:border-[#8B95A8] hover:text-[#F1F5F9]"
          >
            <span>View Holdings</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
