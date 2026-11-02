"""Shared full-table scan helpers.

Several endpoints (Today's Plays, stocks directory, home pulse, radars)
each used to paginate the entire recommendations table independently —
up to 20 sequential PostgREST round-trips per endpoint per cache miss.
This module fetches the superset of columns they all read, in parallel
pages, and shares one in-process copy per extraction epoch (keyed by the
latest videos.extracted_at, the same freshness signal the api_cache
handlers already use). Scoring logic stays in the endpoint modules and
is unchanged; only the row fetching is shared.
"""

import logging
from concurrent.futures import ThreadPoolExecutor

from app.database import _get_client, get_latest_extraction_time

logger = logging.getLogger(__name__)

PAGE_SIZE = 1000
MAX_PAGES = 20  # same 20k-row ceiling the per-endpoint scans used

# Superset of the columns read by today_routes, stocks_routes and
# radars_routes. channels is inner-joined everywhere it matters: every
# video's channel_id FK guarantees the parent row exists.
RECOMMENDATION_COLS = (
    "ticker, stock_name, sentiment, sentiment_score, conviction_level, "
    "conviction_score, target_price, catalyst_notes, "
    "videos!inner(youtube_video_id, channel_id, published_at, "
    "channels!inner(channel_name, trust_weight))"
)

_shared_cache: dict = {"epoch": None, "rows": None}


def fetch_paginated(client, table: str, cols: str, order_col: str, ascending: bool = True) -> list:
    """Fetch up to MAX_PAGES pages of a table, remaining pages in parallel.

    Row order is deterministic (ordered by order_col), and pages are
    concatenated in page order, so callers see the same rows the old
    sequential loops returned.
    """

    def _page(start: int, with_count: bool = False):
        query = client.table(table).select(cols, count="exact" if with_count else None)
        query = query.order(order_col, desc=not ascending)
        return query.range(start, start + PAGE_SIZE - 1).execute()

    first = _page(0, with_count=True)
    rows = list(first.data or [])
    if len(rows) < PAGE_SIZE:
        return rows

    total = first.count
    if not total or total <= PAGE_SIZE:
        # No reliable count: fall back to sequential paging until a short page.
        start = PAGE_SIZE
        while len(rows) < MAX_PAGES * PAGE_SIZE:
            page = _page(start)
            page_rows = page.data or []
            rows.extend(page_rows)
            if len(page_rows) < PAGE_SIZE:
                break
            start += PAGE_SIZE
        return rows

    starts = list(range(PAGE_SIZE, min(total, MAX_PAGES * PAGE_SIZE), PAGE_SIZE))
    if starts:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for page in pool.map(_page, starts):
                rows.extend(page.data or [])
    return rows


def fetch_all_recommendations(client) -> list:
    """One shared superset scan of recommendations (see module docstring)."""
    return fetch_paginated(client, "recommendations", RECOMMENDATION_COLS, "id")


async def get_shared_recommendations() -> list:
    """Recommendations rows shared across endpoints for one extraction epoch.

    Refetches when the latest extraction timestamp changes (new ingest or
    re-extract bumps videos.extracted_at). When the timestamp cannot be
    read, always fetches fresh rather than risk serving stale rows.
    """
    latest = await get_latest_extraction_time()
    if latest is not None and _shared_cache["epoch"] == latest and _shared_cache["rows"] is not None:
        return _shared_cache["rows"]

    rows = fetch_all_recommendations(_get_client())
    if latest is not None:
        _shared_cache["epoch"] = latest
        _shared_cache["rows"] = rows
    return rows
