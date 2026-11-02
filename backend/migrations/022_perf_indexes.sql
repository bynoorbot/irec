-- 022_perf_indexes.sql
-- Performance indexes for the hot read paths. No schema or data change:
-- existing queries return identical results, only faster.
--
-- Postgres does NOT auto-index the referencing side of a foreign key, so
-- recommendations.video_id (used by every video/channel join and every
-- .in('video_id', ...) lookup) previously had no index at all.
-- Apply in the Supabase SQL Editor. On a larger table, prefer
-- CREATE INDEX CONCURRENTLY to avoid a brief write lock.

CREATE INDEX IF NOT EXISTS idx_recommendations_video_id
    ON recommendations (video_id);

-- /channel dossier and Consensus-style per-channel windows:
-- videos for one channel, newest first.
CREATE INDEX IF NOT EXISTS idx_videos_channel_published
    ON videos (channel_id, published_at DESC);

-- /videos and home "latest videos": all videos, newest first.
CREATE INDEX IF NOT EXISTS idx_videos_published_at
    ON videos (published_at DESC);

-- get_latest_extraction_time() runs on every cached API request
-- (ORDER BY extracted_at DESC LIMIT 1).
CREATE INDEX IF NOT EXISTS idx_videos_extracted_at
    ON videos (extracted_at DESC);

-- GET /api/v1/radars/ticker/{symbol} looks radar_tickers up by ticker;
-- the (radar_id, ticker) PK only covers radar_id-first lookups.
CREATE INDEX IF NOT EXISTS idx_radar_tickers_ticker
    ON radar_tickers (ticker);
