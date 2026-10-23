'use client'

import Link from 'next/link'
import { ArrowUpRight, Database, FileText, Landmark, Newspaper, Video } from 'lucide-react'

export function DecisionDataSources() {
  return (
    <section
      aria-label="Where the data comes from"
      className="mt-14 border-t border-[#1E293B] pt-8 space-y-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-[#F1F5F9]">
            Data Sources & Fiduciary Provenance
          </h2>
          <p className="text-xs text-[#8B95A8]">
            Deterministic financial data combined with human governance. No black-box AI scores your money.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Source 1: Google Sheet */}
        <div className="rounded-xl border border-[#1E293B] bg-[#141B2D]/40 p-4 space-y-1.5">
          <p className="flex items-center gap-2 text-xs font-bold text-[#F1F5F9]">
            <Database size={15} className="text-[#00D4AA]" />
            <span>1. Your Portfolio</span>
          </p>
          <p className="text-xs text-[#94A3B8] leading-relaxed">
            Google Sheet (<span className="font-mono text-[#CBD5E1]">Global_Equities</span>), synced into Aura when you trigger Sync. Cost basis, weights, and returns originate there.
          </p>
        </div>

        {/* Source 2: Financial Fundamentals */}
        <div className="rounded-xl border border-[#1E293B] bg-[#141B2D]/40 p-4 space-y-1.5">
          <p className="flex items-center gap-2 text-xs font-bold text-[#F1F5F9]">
            <FileText size={15} className="text-[#00D4AA]" />
            <span>2. The 6-Check Scores</span>
          </p>
          <p className="text-xs text-[#94A3B8] leading-relaxed">
            Yahoo Finance SEC filings data (Rev/EPS growth, margins, ROE, debt, FCF, PEG, 50/200d averages). Cached for 6 hours; pure quantitative math.
          </p>
        </div>

        {/* Source 3: Aura Idea Feed */}
        <div className="rounded-xl border border-[#1E293B] bg-[#141B2D]/40 p-4 space-y-1.5">
          <p className="flex items-center gap-2 text-xs font-bold text-[#F1F5F9]">
            <Video size={15} className="text-[#00D4AA]" />
            <span>3. Aura Consensus Feed</span>
          </p>
          <p className="text-xs text-[#94A3B8] leading-relaxed">
            Aura&apos;s YouTube analyst conviction extracts candidate ideas and feeds the Why-Now momentum check. It can never approve an allocation on its own.
          </p>
        </div>

        {/* Source 4: Owner Authority */}
        <div className="rounded-xl border border-[#1E293B] bg-[#141B2D]/40 p-4 space-y-1.5">
          <p className="flex items-center gap-2 text-xs font-bold text-[#F1F5F9]">
            <Landmark size={15} className="text-[#00D4AA]" />
            <span>4. Owner Authority</span>
          </p>
          <p className="text-xs text-[#94A3B8] leading-relaxed">
            Never, Not-Now, and Approved ETF lists live in Supabase and strictly govern every run. Personal decision support only; you execute every trade.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-[#8B95A8] border-t border-[#1E293B]/60 pt-4">
        <Link
          href="/portfolio"
          className="inline-flex items-center gap-1.5 font-semibold text-[#00D4AA] hover:text-[#00FFD0] transition-colors"
        >
          <span>Holdings & Rebalancing on Portfolio</span>
          <ArrowUpRight size={13} />
        </Link>
        <span aria-hidden="true" className="text-[#2A364D]">·</span>
        <Link
          href="/today"
          className="inline-flex items-center gap-1.5 font-semibold text-[#8B95A8] hover:text-[#F1F5F9] transition-colors"
        >
          <Newspaper size={13} />
          <span>Analyst Sentiment Feed on Today</span>
        </Link>
      </div>
    </section>
  )
}
