'use client'

import { ChevronRight } from 'lucide-react'
import { TopAlphaPlay } from '@/lib/types'
import { normalizeAvgConviction100 } from '@/lib/utils'

interface TopAlphaRowProps {
  play: TopAlphaPlay
  onInspect: (play: TopAlphaPlay) => void
}

export default function TopAlphaRow({ play, onInspect }: TopAlphaRowProps) {
  const isTop1 = play.rank === 1
  const convictionVal = Math.round(normalizeAvgConviction100(play.avg_conviction))

  // B4: Score Lamp math (12 segments)
  const lampSegments = 12
  const litLampCount = Math.round((play.aura_score / 100) * lampSegments)

  // B1: Consensus Stack math & channel initials
  const distinctChannels = Array.from(
    new Set(play.catalysts?.map((c) => c.channel_name).filter(Boolean) || [])
  )
  const shownChannels = distinctChannels.slice(0, 4)
  const channelOverflow = play.analyst_count - shownChannels.length

  const totalSegments = Math.min(12, play.analyst_count)
  const alignedCount = Math.round((play.agreement_pct / 100) * totalSegments)
  const segmentOverflow = play.analyst_count > 12 ? play.analyst_count - 12 : 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onInspect(play)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onInspect(play)
        }
      }}
      className={`group/row relative flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-4 p-4 sm:p-5 rounded-2xl bg-[#0A0F1A]/75 border focus-visible:ring-2 focus-visible:ring-[#00D4AA]/70 outline-none transition-[border-color,background-color,color] duration-200 cursor-pointer overflow-hidden ${
        isTop1
          ? 'border-[#00D4AA]/45 shadow-[0_0_25px_rgba(0,212,170,0.14)] hover:border-[#00D4AA]/75 hover:shadow-[0_0_35px_rgba(0,212,170,0.22)]'
          : 'border-[#1E293B]/70 hover:border-[#00D4AA]/35 hover:bg-[#141B2D]/80'
      } hover:-translate-y-0.5 active:scale-[0.99]`}
    >
      {/* Top 1 Inline Anchor Highlight for Desktop */}
      {isTop1 && (
        <div className="hidden lg:block absolute top-0 right-0 px-3 py-0.5 rounded-bl-xl bg-[#00D4AA]/15 border-b border-l border-[#00D4AA]/30 text-[9px] font-black uppercase tracking-widest text-[#00D4AA] font-[family-name:var(--font-geist-mono)]">
          ★ #1 Conviction Anchor
        </div>
      )}

      {/* Left Identity Block: Rank + Ticker + Aura + Archetype + Name + Score Lamp */}
      <div className="flex items-start sm:items-center gap-3 sm:gap-3.5 min-w-0 md:min-w-[240px] lg:min-w-[280px]">
        {/* Oversized Geist Mono Rank */}
        <span
          className={`font-[family-name:var(--font-geist-mono)] text-2xl sm:text-3xl font-black tracking-tighter shrink-0 w-8 sm:w-10 ${
            isTop1 ? 'text-[#00FFD0]' : 'text-[#64748B]'
          }`}
        >
          {String(play.rank).padStart(2, '0')}
        </span>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <span className="font-[family-name:var(--font-geist-mono)] text-xl sm:text-2xl font-black text-[#F1F5F9] tracking-wide group-hover/row:text-[#00D4AA] transition-colors">
              {play.ticker}
            </span>

            {/* Aura Score Pill */}
            <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-md text-[10px] font-black font-[family-name:var(--font-geist-mono)] bg-[#00D4AA]/10 text-[#00D4AA] border border-[#00D4AA]/25 shrink-0">
              AURA {play.aura_score}
            </span>

            {/* Archetype Badge */}
            <span
              className={`text-[9px] font-bold px-1.5 sm:px-2 py-0.5 rounded-md uppercase font-[family-name:var(--font-geist-mono)] border shrink-0 ${
                play.archetype === 'core'
                  ? 'bg-[#00D4AA]/10 text-[#00D4AA] border-[#00D4AA]/20'
                  : play.archetype === 'growth'
                  ? 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20'
                  : 'bg-[#38BDF8]/10 text-[#38BDF8] border-[#38BDF8]/20'
              }`}
            >
              {play.archetype_label}
            </span>

            {/* Mobile #1 Indicator */}
            {isTop1 && (
              <span className="lg:hidden text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase font-[family-name:var(--font-geist-mono)] bg-[#00D4AA]/20 text-[#00FFD0] border border-[#00D4AA]/40">
                #1 Anchor
              </span>
            )}
          </div>

          {/* B4: Score Lamp (12-segment pre-attentive indicator) */}
          <div
            aria-hidden="true"
            className="grid grid-cols-12 gap-0.5 w-24 mt-1 motion-safe:opacity-90"
          >
            {Array.from({ length: lampSegments }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-[1px] transition-colors duration-200 ${
                  i < litLampCount ? 'bg-[#00D4AA]' : 'bg-[#1E293B]'
                }`}
              />
            ))}
          </div>

          <span className="text-xs text-[#8B95A8] font-medium truncate max-w-[220px] sm:max-w-[260px] mt-0.5">
            {play.stock_name}
          </span>
        </div>
      </div>

      {/* Center Block: Executive Thesis */}
      <div className="flex-1 md:px-2 min-w-0">
        <p className="text-xs sm:text-sm text-[#E2E8F0] font-normal leading-relaxed line-clamp-2 md:line-clamp-2">
          {play.executive_thesis}
        </p>
      </div>

      {/* Right Block: Fully Visible Metrics & Action Arrow (Fully Responsive Grid on Mobile) */}
      <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 shrink-0 font-[family-name:var(--font-geist-mono)] pt-2.5 md:pt-0 border-t md:border-t-0 border-[#1E293B]">
        <div className="grid grid-cols-3 sm:flex sm:items-center gap-2.5 sm:gap-4 w-full sm:w-auto text-left sm:text-right">
          {/* Metric 1: Agreement & Channels + B1 Consensus Stack */}
          <div
            className="flex flex-col sm:items-end"
            aria-label={`${play.agreement_pct}% · ${play.analyst_count} ${play.analyst_count === 1 ? 'channel' : 'channels'}`}
          >
            <span className="text-xs sm:text-sm font-black text-[#00D4AA]">
              {play.agreement_pct}%
            </span>
            <span className="text-[10px] text-[#8B95A8] truncate">
              {play.analyst_count} {play.analyst_count === 1 ? 'channel' : 'channels'}
            </span>

            {/* B1: Consensus Stack (channel initials + segmented agreement bar) */}
            <div
              aria-hidden="true"
              className="flex items-center gap-1.5 mt-1 motion-safe:opacity-95"
            >
              {shownChannels.length > 0 && (
                <div className="flex items-center -space-x-1.5">
                  {shownChannels.map((ch, i) => (
                    <span
                      key={i}
                      className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#141B2D] border border-[#1E293B] ring-2 ring-[#0A0F1A] text-[9px] sm:text-[10px] font-bold text-[#F1F5F9] flex items-center justify-center shrink-0"
                      title={ch}
                    >
                      {ch.trim().charAt(0).toUpperCase()}
                    </span>
                  ))}
                  {channelOverflow > 0 && (
                    <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#1E293B] ring-2 ring-[#0A0F1A] text-[8px] sm:text-[9px] font-bold text-[#8B95A8] flex items-center justify-center shrink-0">
                      +{channelOverflow}
                    </span>
                  )}
                </div>
              )}

              {/* Segmented Agreement Bar */}
              <div className="flex items-center gap-0.5">
                {Array.from({ length: totalSegments }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-3 w-1 rounded-full ${
                      i < alignedCount ? 'bg-[#00D4AA]' : 'bg-[#334155]'
                    }`}
                  />
                ))}
                {segmentOverflow > 0 && (
                  <span className="text-[8px] text-[#8B95A8] ml-0.5">
                    +{segmentOverflow}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Metric 2: Target Price (RESTORED ON ALL MOBILE SCREENS) */}
          <div className="flex flex-col sm:items-end pl-2 sm:pl-3 border-l border-[#1E293B]">
            <span className="text-xs sm:text-sm font-black text-[#F1F5F9]">
              {play.avg_target_price ? `$${Math.round(play.avg_target_price)}` : '—'}
            </span>
            <span className="text-[10px] text-[#38BDF8]">
              Target
            </span>
          </div>

          {/* Metric 3: Conviction (RESTORED ON ALL MOBILE SCREENS) */}
          <div className="flex flex-col sm:items-end pl-2 sm:pl-3 border-l border-[#1E293B]">
            <span className="text-xs sm:text-sm font-bold text-[#F1F5F9]">
              {convictionVal}/100
            </span>
            <span className="text-[10px] text-[#8B95A8]">
              Conviction
            </span>
          </div>
        </div>

        {/* Chevron Action Button (Clean 44px hit-area affordance) */}
        <div
          className="p-2 sm:p-2.5 rounded-xl bg-[#141B2D] border border-[#1E293B] text-[#8B95A8] group-hover/row:text-[#00D4AA] group-hover/row:border-[#00D4AA]/40 transition-[border-color,background-color,color] duration-200 shrink-0 flex items-center justify-center min-w-[38px] min-h-[38px]"
          title="Inspect video quotes and catalysts"
        >
          <ChevronRight className="w-4 h-4" />
        </div>
      </div>
    </div>
  )
}
