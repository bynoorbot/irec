"""Server-aggregated catalog endpoints for the /channels and /videos pages.

These return exactly the structures the frontend used to compute in the
browser from full-table downloads (channel profiles, enriched videos),
using the same api_cache freshness pattern as /today and /stocks:
serve the cached payload while it is newer than the latest extraction,
otherwise recompute once and cache it.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Response

from app.database import _get_client, get_cache, set_cache, get_latest_extraction_time
from app.recs_scan import fetch_paginated
from app.today_routes import parse_iso_datetime

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1",
    tags=["catalog"],
)


def _conviction100(rec: dict) -> float:
    """Mirror of frontend conviction100(): score, else level * 10, else 50."""
    if rec.get("conviction_score") is not None:
        return float(rec["conviction_score"])
    if rec.get("conviction_level") is not None:
        return float(rec["conviction_level"]) * 10.0
    return 50.0


async def _serve_cached(cache_key: str, request: Request, response: Response, compute):
    cached_data = await get_cache(cache_key)
    latest_extraction = await get_latest_extraction_time()

    if cached_data and latest_extraction:
        cache_updated = parse_iso_datetime(cached_data.get("last_updated"))
        latest_ext_dt = parse_iso_datetime(latest_extraction)
        if cache_updated >= latest_ext_dt:
            payload = cached_data["payload"]
            etag = f'W/"{payload.get("generated_at")}"'
            if request.headers.get("if-none-match") == etag:
                return Response(status_code=304)
            response.headers["ETag"] = etag
            return payload

    payload = await compute()
    await set_cache(cache_key, payload)
    response.headers["ETag"] = f'W/"{payload["generated_at"]}"'
    return payload


@router.get("/channels/profiles")
async def get_channel_profiles(request: Request, response: Response):
    """Channel profiles previously computed client-side by buildProfiles()."""
    try:
        return await _serve_cached(
            "channels_profiles_v1", request, response, _compute_channel_profiles
        )
    except Exception as e:
        logger.error(f"Error computing channel profiles: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal Server Error")


async def _compute_channel_profiles() -> dict:
    client = _get_client()

    channels = (
        client.table("channels")
        .select("channel_id, channel_name, trust_weight, created_at, channel_thumbnail_url, youtube_channel_id")
        .execute()
        .data
        or []
    )
    videos = fetch_paginated(
        client, "videos", "video_id, channel_id, youtube_video_id, published_at", "published_at", ascending=False
    )
    recs = fetch_paginated(
        client,
        "recommendations",
        "ticker, sentiment, conviction_level, conviction_score, video_id",
        "video_id",
    )

    videos_by_channel: dict = {}
    video_to_channel: dict = {}
    for v in videos:
        videos_by_channel.setdefault(v["channel_id"], []).append(v)
        video_to_channel[v["video_id"]] = v["channel_id"]

    recs_by_channel: dict = {}
    for r in recs:
        channel_id = video_to_channel.get(r["video_id"])
        if not channel_id:
            continue
        recs_by_channel.setdefault(channel_id, []).append(r)

    now_ms = datetime.now(timezone.utc).timestamp() * 1000

    profiles = []
    for ch in channels:
        ch_videos = videos_by_channel.get(ch["channel_id"], [])
        ch_recs = recs_by_channel.get(ch["channel_id"], [])

        avg_sentiment = (
            sum(r["sentiment"] for r in ch_recs) / len(ch_recs) if ch_recs else 0.0
        )
        avg_conviction = (
            sum(_conviction100(r) for r in ch_recs) / len(ch_recs) if ch_recs else 0.0
        )

        bullish = sum(1 for r in ch_recs if r["sentiment"] >= 1)
        bearish = sum(1 for r in ch_recs if r["sentiment"] <= -1)
        total = len(ch_recs) or 1

        ticker_count: dict = {}
        all_covered: set = set()
        for r in ch_recs:
            all_covered.add(r["ticker"].upper())
            ticker_count[r["ticker"]] = ticker_count.get(r["ticker"], 0) + 1
        top_tickers = [
            t for t, _ in sorted(ticker_count.items(), key=lambda kv: -kv[1])[:5]
        ]

        # Videos arrive newest-first from fetch_paginated.
        latest_video = ch_videos[0] if ch_videos else None

        latest_ms = 0.0
        if latest_video:
            latest_ms = parse_iso_datetime(latest_video["published_at"]).timestamp() * 1000
        days_since_latest = (now_ms - latest_ms) / 86400000.0 if latest_ms else 999.0
        if days_since_latest <= 7:
            recency_score = 1.0
        elif days_since_latest <= 30:
            recency_score = 0.7
        elif days_since_latest <= 90:
            recency_score = 0.4
        else:
            recency_score = 0.1

        importance_score = (
            len(ch_recs) * 0.4
            + (ch["trust_weight"] * 10 * 0.3)
            + (recency_score * 10 * 0.3)
        )

        profiles.append({
            "channel_id": ch["channel_id"],
            "channel_name": ch["channel_name"],
            "trust_weight": ch["trust_weight"],
            "channel_thumbnail_url": ch.get("channel_thumbnail_url"),
            "youtube_channel_id": ch.get("youtube_channel_id"),
            "total_videos": len(ch_videos),
            "total_recommendations": len(ch_recs),
            "avg_sentiment": avg_sentiment,
            "avg_conviction": avg_conviction,
            "top_tickers": top_tickers,
            "all_covered_tickers": sorted(all_covered),
            "latest_video_date": latest_video["published_at"] if latest_video else None,
            "latest_video_youtube_id": latest_video["youtube_video_id"] if latest_video else None,
            "bullish_pct": (bullish / total) * 100,
            "bearish_pct": (bearish / total) * 100,
            "importance_score": importance_score,
        })

    profiles.sort(key=lambda p: -p["importance_score"])
    return {"profiles": profiles, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/videos/feed")
async def get_videos_feed(request: Request, response: Response):
    """Enriched videos previously computed client-side by enrichVideos()."""
    try:
        return await _serve_cached(
            "videos_feed_v1", request, response, _compute_videos_feed
        )
    except Exception as e:
        logger.error(f"Error computing videos feed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal Server Error")


async def _compute_videos_feed() -> dict:
    client = _get_client()

    videos = fetch_paginated(
        client,
        "videos",
        "video_id, video_url, youtube_video_id, published_at, extracted_at, video_summary, title, duration, channel_id, channels!inner(channel_name, trust_weight)",
        "published_at",
        ascending=False,
    )
    recs = fetch_paginated(
        client,
        "recommendations",
        "id, video_id, ticker, stock_name, sentiment, target_price, conviction_level, conviction_score",
        "id",
    )

    recs_by_video: dict = {}
    for r in recs:
        recs_by_video.setdefault(r["video_id"], []).append(r)

    enriched = []
    for v in videos:
        v_recs = recs_by_video.get(v["video_id"], [])
        channel = v.get("channels") or {}
        enriched.append({
            "video_id": v["video_id"],
            "video_url": v["video_url"],
            "youtube_video_id": v["youtube_video_id"],
            "published_at": v["published_at"],
            "extracted_at": v["extracted_at"],
            "video_summary": v.get("video_summary"),
            "title": v.get("title"),
            "duration": v.get("duration"),
            "channel_id": v["channel_id"],
            "channel_name": channel.get("channel_name"),
            "trust_weight": channel.get("trust_weight"),
            "recommendations": v_recs,
            "avg_sentiment": (
                sum(r["sentiment"] for r in v_recs) / len(v_recs) if v_recs else 0.0
            ),
            "avg_conviction": (
                sum(_conviction100(r) for r in v_recs) / len(v_recs) if v_recs else 0.0
            ),
            "pick_count": len(v_recs),
        })

    return {"videos": enriched, "generated_at": datetime.now(timezone.utc).isoformat()}
