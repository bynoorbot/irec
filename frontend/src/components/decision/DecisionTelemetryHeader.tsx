'use client'

import { AlertTriangle, Clock, Database, RefreshCw, Shield, Sparkles } from 'lucide-react'

interface TelemetryHeaderProps {
  totalValue: number
  allocation: {
    etf_pct: number
    stocks_pct: number
    etf_target: string
    cash_target: string
  }
  generatedAt: string
  servedFromCache?: boolean
  marketProvisional: boolean
  sheetAsof?: string | null
  refreshing: boolean
  onRefresh: () => void
  holdingsCount: number
}

export function DecisionTelemetryHeader({
  totalValue,
  allocation,
  generatedAt,
  servedFromCache,
  marketProvisional,
  sheetAsof,
  refreshing,
  onRefresh,
  holdingsCount,
}: TelemetryHeaderProps) {
  const generatedTime = new Date(generatedAt).getTime()
  const staleDays = sheetAsof
    ? Math.floor((generatedTime - new Date(sheetAsof).getTime()) / 86400000)
    : null

  const isEtfTargetHealthy = allocation.etf_pct >= 20 && allocation.etf_pct <= 35
  const isEtfBelowFloor = allocation.etf_pct < 20

  return (
    <header className="space-y-4">
      {/* Top Identity & Action Row */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider bg-[#00D4AA]/10 text-[#00D4AA] border border-[#00D4AA]/25">
              <Shield size={11} /> Fiduciary Capital Engine
            </span>
            <span className="text-xs text-[#8B95A8] font-mono">Jordan (UTC+3)</span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-[#F1F5F9] font-[family-name:var(--font-geist-sans)]">
            This Week&apos;s Decision
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-[#8B95A8]">
            Numbers-first capital allocation · Strict 6-check buy bar or Shariah ETF default
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh weekly decision on demand"
          className="flex items-center gap-2 rounded-lg border border-[#2A364D] bg-[#141B2D] px-4 py-2.5 text-xs sm:text-sm font-semibold text-[#F1F5F9] transition-all hover:border-[#00D4AA]/60 hover:bg-[#1E293B] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA] active:scale-[0.98]"
        >
          <RefreshCw
            size={14}
            className={`transition-transform duration-700 ${refreshing ? 'animate-spin text-[#00D4AA]' : ''}`}
          />
          <span>{refreshing ? 'Refreshing Fundamentals…' : 'Refresh on Demand'}</span>
        </button>
      </div>

      {/* Audit & Cycle Metadata Status Pills */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[#8B95A8] font-mono">
        <span className="flex items-center gap-1.5">
          <Clock size={12} className="text-[#8B95A8]" />
          Generated {new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span aria-hidden="true" className="text-[#2A364D]">·</span>
        {servedFromCache ? (
          <span className="text-[#00D4AA] font-medium flex items-center gap-1">
            <Sparkles size={11} /> Cached Snapshot
          </span>
        ) : (
          <span className="text-[#7EF0D4]">Live Recalculation</span>
        )}
        <span aria-hidden="true" className="text-[#2A364D]">·</span>
        <span className={`px-1.5 py-0.5 rounded text-[11px] ${
          marketProvisional ? 'bg-amber-400/10 text-amber-300 border border-amber-400/20' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
        }`}>
          {marketProvisional ? 'Intraday · Provisional' : 'Official After-Close'}
        </span>
        <span aria-hidden="true" className="text-[#2A364D]">·</span>
        <span className="flex items-center gap-1">
          <Database size={11} className="text-[#8B95A8]" />
          Sheet {sheetAsof ? new Date(sheetAsof).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Unknown'}
        </span>
        {staleDays !== null && staleDays > 10 && (
          <>
            <span aria-hidden="true" className="text-[#2A364D]">·</span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[#FF4D6A]/10 text-[#FF8FA3] border border-[#FF4D6A]/30">
              <AlertTriangle size={12} /> Sheet Stale ({staleDays}d) — sync before trading
            </span>
          </>
        )}
      </div>

      {/* High-Density Bloomberg Telemetry Strip */}
      <div className="rounded-xl border border-[#1E293B] bg-[#141B2D]/70 p-3 sm:p-4 backdrop-blur-md">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:divide-x sm:divide-[#1E293B]">
          {/* 1. Portfolio Value */}
          <div className="sm:px-3 first:pl-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A8]">
              Portfolio Total
            </p>
            <p className="mt-1 font-mono text-lg sm:text-xl font-bold tabular-nums text-[#F1F5F9]">
              ${Number(totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[11px] text-[#64748B]">Google Sheet Synced</p>
          </div>

          {/* 2. ETF Base Allocation */}
          <div className="sm:px-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A8]">
                ETF Foundation
              </p>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${isEtfTargetHealthy ? 'bg-[#00D4AA]' : isEtfBelowFloor ? 'bg-amber-400' : 'bg-[#38BDF8]'}`} />
            </div>
            <p className="mt-1 font-mono text-lg sm:text-xl font-bold tabular-nums text-[#F1F5F9]">
              {allocation.etf_pct}%
            </p>
            <p className={`text-[11px] font-mono ${isEtfBelowFloor ? 'text-amber-300 font-medium' : 'text-[#8B95A8]'}`}>
              Target: {allocation.etf_target} {isEtfBelowFloor ? '(Underweight)' : '✓'}
            </p>
          </div>

          {/* 3. Single Stock Equity */}
          <div className="sm:px-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A8]">
              Stock Conviction
            </p>
            <p className="mt-1 font-mono text-lg sm:text-xl font-bold tabular-nums text-[#F1F5F9]">
              {allocation.stocks_pct}%
            </p>
            <p className="text-[11px] text-[#8B95A8] font-mono">
              {holdingsCount} Active {holdingsCount === 1 ? 'Holding' : 'Holdings'}
            </p>
          </div>

          {/* 4. Cash Target Buffer */}
          <div className="sm:px-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A8]">
              Cash Reserve
            </p>
            <p className="mt-1 font-mono text-lg sm:text-xl font-bold tabular-nums text-[#00FFD0]">
              5–10% Target
            </p>
            <p className="text-[11px] text-[#64748B]">Kept Outside Sheet</p>
          </div>
        </div>
      </div>
    </header>
  )
}
