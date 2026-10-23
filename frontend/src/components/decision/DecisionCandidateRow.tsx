'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Ban, ChevronDown, ChevronUp, Loader2, Sparkles, Video, AlertCircle } from 'lucide-react'

type Check = { key: string; label: string; score: number; evidence: string }
export type Idea = {
  ticker: string
  stock_name?: string | null
  bucket: string
  held: boolean
  weight_pct: number
  price?: number | null
  score: number
  checks: Check[]
  passes_strict: boolean
  verdict: string
  is_etf?: boolean
  aura: {
    sentiment?: number | null
    conviction?: number | null
    mentions_30d: number
    analyst_count: number
    source?: string | null
  }
  evidence_source: string
}

interface CandidateRowProps {
  candidate: Idea
  isBusy: boolean
  onDismiss: (ticker: string, kind: 'never' | 'not_now') => void
}

const scoreTextColor = (s: number) => {
  if (s >= 10) return 'text-[#00FFD0]'
  if (s >= 8) return 'text-amber-300'
  return 'text-[#FF8FA3]'
}

const factorPill = (score: number) => {
  if (score === 2) return 'bg-[#00D4AA]/10 text-[#00D4AA] border-[#00D4AA]/30'
  if (score === 1) return 'bg-amber-400/10 text-amber-300 border-amber-400/30'
  return 'bg-[#FF4D6A]/10 text-[#FF8FA3] border-[#FF4D6A]/30'
}

export function DecisionCandidateRow({ candidate: c, isBusy, onDismiss }: CandidateRowProps) {
  const [expanded, setExpanded] = useState(false)

  const whyNowScore = c.checks.find((ch) => ch.key === 'whynow')?.score ?? 1
  const valScore = c.checks.find((ch) => ch.key === 'valuation')?.score ?? 1

  // Gating bottleneck identification
  let bottleneck = ''
  if (!c.passes_strict) {
    if (whyNowScore !== 2) bottleneck = 'Why-Now Catalyst < 2'
    else if (valScore === 0) bottleneck = 'Valuation Multiple Red'
    else if (c.score < 10) bottleneck = `Score ${c.score}/12 (Needs ≥10)`
    else bottleneck = c.verdict
  }

  return (
    <article
      className={`rounded-xl border transition-all duration-200 ${
        c.passes_strict
          ? 'border-[#00D4AA]/40 bg-[#141B2D]/90 shadow-[0_0_20px_rgba(0,212,170,0.08)]'
          : 'border-[#1E293B] bg-[#141B2D]/50 hover:border-[#2A364D]'
      }`}
    >
      <div className="p-4 sm:p-5 space-y-3">
        {/* Top Header: Identity, Score & Strict Status */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/ticker?s=${c.ticker}`}
                className="font-mono text-xl sm:text-2xl font-black text-[#F1F5F9] transition-colors hover:text-[#00FFD0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA] rounded"
              >
                {c.ticker}
              </Link>

              {c.stock_name && (
                <span className="text-sm font-medium text-[#94A3B8] truncate max-w-[200px] sm:max-w-[300px]">
                  {c.stock_name}
                </span>
              )}

              {c.passes_strict && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[#00D4AA]/15 px-2 py-0.5 text-[10px] font-bold font-mono uppercase text-[#00FFD0] border border-[#00D4AA]/30">
                  <Sparkles size={11} /> Passes Strict Buy Bar
                </span>
              )}
            </div>

            <p className="mt-0.5 text-xs text-[#8B95A8] font-mono">
              {c.bucket}
              {c.held ? ` · Held: ${c.weight_pct}%` : ' · New Position'}
              {c.price ? ` · $${Number(c.price).toFixed(2)}` : ''}
              {c.aura.mentions_30d > 0 && ` · ${c.aura.mentions_30d} video mentions (30d)`}
            </p>
          </div>

          {/* Right Score Block */}
          <div className="text-right shrink-0">
            <p className={`font-mono text-2xl font-bold tabular-nums ${scoreTextColor(c.score)}`}>
              {c.score}
              <span className="text-sm text-[#8B95A8]">/12</span>
            </p>
            {c.passes_strict ? (
              <span className="text-xs font-semibold text-[#00D4AA]">Buyable Tranche</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#94A3B8]">
                <AlertCircle size={11} className="text-amber-400" />
                {bottleneck}
              </span>
            )}
          </div>
        </div>

        {/* 12-Segment Progress Bar */}
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-[#1E293B]"
          role="progressbar"
          aria-valuenow={c.score}
          aria-valuemin={0}
          aria-valuemax={12}
          aria-label={`Score ${c.score} of 12`}
        >
          <div
            className={`h-full transition-all duration-500 ${
              c.score >= 10 ? 'bg-[#00D4AA]' : c.score >= 8 ? 'bg-amber-400' : 'bg-[#FF4D6A]'
            }`}
            style={{ width: `${(c.score / 12) * 100}%` }}
          />
        </div>

        {/* Dense 6-Factor Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1">
          {c.checks.map((ch) => {
            const isGatingFail =
              (ch.key === 'whynow' && ch.score !== 2) || (ch.key === 'valuation' && ch.score === 0)

            return (
              <div
                key={ch.key}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${factorPill(ch.score)} ${
                  isGatingFail ? 'ring-1 ring-amber-400/30' : ''
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="font-semibold">{ch.label.split('/')[0].split('&')[0].trim()}</span>
                  <span className="tabular-nums font-bold">{ch.score}/2</span>
                </div>
                <p className="mt-0.5 truncate text-[10px] text-[#CBD5E1] opacity-90" title={ch.evidence}>
                  {ch.evidence}
                </p>
              </div>
            )
          })}
        </div>

        {/* Accordion Toggle & Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#1E293B]/70">
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8B95A8] hover:text-[#F1F5F9] transition-colors focus-visible:outline-none focus-visible:underline"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{expanded ? 'Hide Diagnostic Evidence' : 'Show Diagnostic Evidence & Citations'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              disabled={isBusy}
              onClick={() => onDismiss(c.ticker, 'never')}
              title="Add to Never for me blacklist"
              className="inline-flex items-center gap-1 rounded-md border border-[#FF4D6A]/40 bg-[#FF4D6A]/5 px-2.5 py-1.5 text-xs font-medium text-[#FF8FA3] transition-colors hover:bg-[#FF4D6A]/15 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4D6A]"
            >
              {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
              <span>Never for me</span>
            </button>

            <button
              disabled={isBusy}
              onClick={() => onDismiss(c.ticker, 'not_now')}
              title="Park in Not now list until fundamentals or price changes"
              className="inline-flex items-center gap-1 rounded-md border border-[#2A364D] bg-[#0A0F1A] px-2.5 py-1.5 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#8B95A8] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA]"
            >
              <span>Not now</span>
            </button>
          </div>
        </div>
      </div>

      {/* Expanded Accordion: Detailed Evidence & Aura Consensus */}
      {expanded && (
        <div className="border-t border-[#1E293B] bg-[#0A0F1A]/50 p-4 sm:p-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {c.checks.map((ch) => (
              <div key={ch.key} className="rounded-lg border border-[#1E293B] bg-[#141B2D]/60 p-3 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-[#F1F5F9]">{ch.label}</span>
                  <span className={`font-mono tabular-nums px-1.5 py-0.5 rounded text-[10px] ${factorPill(ch.score)}`}>
                    {ch.score}/2
                  </span>
                </div>
                <p className="text-xs text-[#94A3B8] leading-relaxed">{ch.evidence}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-[#8B95A8] border-t border-[#1E293B]/70 font-mono">
            <span className="flex items-center gap-1.5">
              <Video size={13} className="text-[#00D4AA]" />
              Aura Idea Consensus: {c.aura.mentions_30d} video mentions across {c.aura.analyst_count} analysts
            </span>
            <span className="text-[11px] text-[#64748B]">Evidence: Yahoo Finance SEC Filings</span>
          </div>
        </div>
      )}
    </article>
  )
}
