"""
Statcast Data Pipeline
Pulls pitch-level data from Baseball Savant and loads into Supabase.

Retention (enforced at the start of each weekly refresh):
    - Current season: every pitch.
    - Previous season: only outcome pitches (events IS NOT NULL).
    - Older seasons: deleted.

Usage:
    # Full-season load (current season)
    python pull_statcast.py --mode historical --start 2026-03-10 --end 2026-07-28

    # Previous-season load, outcome pitches only
    python pull_statcast.py --mode historical --start 2025-03-18 --end 2025-11-02 --events-only

    # Weekly refresh (run by GitHub Actions)
    python pull_statcast.py --mode refresh
"""

import os
import sys
import math
import time
import argparse
import logging
from datetime import datetime, date, timedelta

from dotenv import load_dotenv
load_dotenv()

import pandas as pd
from httpx import Client as HttpxClient
from httpx import Timeout
from pybaseball import statcast, cache, chadwick_register
from supabase import Client, ClientOptions, create_client
from supabase_auth import SyncMemoryStorage

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Only columns the app's AI query generator knows about (frontend schemaContext.js),
# plus the upsert conflict key. Statcast's release-point/physics/fielder columns are
# intentionally excluded — they cost ~26% of the table and nothing can query them.
SCHEMA_COLUMNS = [
    "game_pk", "game_date", "game_year", "game_type", "home_team", "away_team",
    "inning", "inning_topbot", "at_bat_number", "pitch_number",
    "pitcher", "p_throws", "batter", "stand", "player_name",
    "pitch_type", "pitch_name", "release_speed", "effective_speed",
    "release_spin_rate", "spin_axis", "release_extension",
    "pfx_x", "pfx_z", "plate_x", "plate_z", "zone", "sz_top", "sz_bot",
    "type", "description", "des", "events",
    "launch_speed", "launch_angle", "hit_distance_sc", "launch_speed_angle",
    "hc_x", "hc_y", "hit_location", "bb_type",
    "estimated_ba_using_speedangle", "estimated_woba_using_speedangle",
    "woba_value", "babip_value", "iso_value",
    "balls", "strikes", "outs_when_up", "on_1b", "on_2b", "on_3b",
    "home_score", "away_score", "bat_score", "post_bat_score",
    "if_fielding_alignment", "of_fielding_alignment",
    "delta_home_win_exp", "delta_run_exp",
]

COLUMN_RENAMES = {
    "release_spin_rate": "release_spin",
    "hit_distance_sc": "hit_distance",
}

# Must match INTEGER columns in Supabase `pitches` (Postgres rejects JSON floats like 123.0).
_CHADWICK_DF = None


def get_chadwick_register_df() -> pd.DataFrame:
    """Load Chadwick once per process; used for batter names on pitches and for players upserts."""
    global _CHADWICK_DF
    if _CHADWICK_DF is None:
        logger.info("Loading Chadwick register (cached for this process)...")
        _CHADWICK_DF = chadwick_register()
    return _CHADWICK_DF


def build_chadwick_id_to_name(player_ids: set) -> dict:
    """Map MLBAM integer id -> 'First Last'. Missing ids are omitted."""
    out = {}
    if not player_ids:
        return out
    reg = get_chadwick_register_df()
    if reg is None or reg.empty:
        return out
    reg = reg[reg["key_mlbam"].notna()].copy()
    reg["key_mlbam"] = reg["key_mlbam"].map(_coerce_integer)
    reg = reg.dropna(subset=["key_mlbam"])
    reg["key_mlbam"] = reg["key_mlbam"].astype(int)
    reg = reg.drop_duplicates(subset=["key_mlbam"], keep="first")
    sub = reg[reg["key_mlbam"].isin(player_ids)]
    for _, row in sub.iterrows():
        pid = int(row["key_mlbam"])
        first = row.get("name_first") or ""
        last = row.get("name_last") or ""
        if not isinstance(first, str):
            first = str(first)
        if not isinstance(last, str):
            last = str(last)
        name = f"{first.strip()} {last.strip()}".strip()
        out[pid] = name or "Unknown"
    return out


def _is_transient_network_error(exc: BaseException) -> bool:
    """True for flaky TLS/TCP — not Postgres statement_timeout (retrying those makes it worse)."""
    msg = str(exc).lower()
    if "57014" in msg or "statement timeout" in msg or "canceling statement due to" in msg:
        return False
    return any(
        s in msg
        for s in (
            "ssl",
            "bad_record",
            "connection",
            "readtimeout",
            "read timed out",
            "eof occurred",
            "violation of protocol",
            "remoteprotocolerror",
            "broken pipe",
            "reset by peer",
        )
    )


def supabase_execute_with_retry(description: str, fn, max_attempts: int = 7):
    """Re-run Supabase/httpx calls that fail with flaky TLS or connection errors."""
    last_exc = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as e:
            last_exc = e
            if _is_transient_network_error(e) and attempt < max_attempts - 1:
                wait = min(45, 2 ** attempt)
                logger.warning(
                    "%s: transient error (attempt %s/%s): %s — retrying in %ss",
                    description,
                    attempt + 1,
                    max_attempts,
                    e,
                    wait,
                )
                time.sleep(wait)
                continue
            raise
    raise last_exc


INTEGER_COLUMNS = frozenset({
    "game_pk", "game_year", "inning", "at_bat_number", "pitch_number",
    "pitcher", "batter", "zone", "hit_location", "launch_speed_angle",
    "balls", "strikes", "outs_when_up",
    "on_1b", "on_2b", "on_3b",
    "home_score", "away_score", "bat_score", "post_bat_score",
})


def _unwrap_scalar(value):
    if value is None:
        return None
    if hasattr(value, "item") and not isinstance(value, (bytes, str)):
        try:
            return value.item()
        except (ValueError, AttributeError):
            pass
    return value


def _coerce_integer(value):
    if value is None:
        return None
    v = _unwrap_scalar(value)
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def sanitize_pitch_record(record: dict) -> dict:
    """JSON/Postgres-safe dict: ints are native int (not 123.0), dates ISO, NaN -> None."""
    out = {}
    for key, raw in record.items():
        v = _unwrap_scalar(raw)
        if v is None:
            out[key] = None
            continue
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            out[key] = None
            continue
        if key in INTEGER_COLUMNS:
            out[key] = _coerce_integer(v)
            continue
        if isinstance(v, (pd.Timestamp, datetime)):
            out[key] = v.isoformat()
        elif isinstance(v, date):
            out[key] = v.isoformat()
        else:
            out[key] = v
    return out


def get_supabase_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as environment variables."
        )
    # supabase-py defaults to HTTP/2; large JSON upserts sometimes hit TLS errors like
    # SSLV3_ALERT_BAD_RECORD_MAC on some networks. HTTP/1.1 is slower but more stable.
    timeout = Timeout(120.0, connect=45.0)
    httpx_sync = HttpxClient(
        timeout=timeout,
        follow_redirects=True,
        http2=False,
    )
    options = ClientOptions(
        storage=SyncMemoryStorage(),
        httpx_client=httpx_sync,
        postgrest_client_timeout=timeout,
    )
    return create_client(SUPABASE_URL, SUPABASE_KEY, options=options)


def _week_windows(year: int):
    """7-day (start, end) ISO date windows spanning a season; keeps deletes small
    enough to stay under Supabase statement timeouts."""
    cur = date(year, 2, 1)
    season_end = date(year, 12, 31)
    while cur <= season_end:
        nxt = cur + timedelta(days=7)
        yield cur.isoformat(), nxt.isoformat()
        cur = nxt


def prune_old_seasons(supabase: Client):
    """Enforce the rolling retention window:
    current season = all pitches, previous season = outcome pitches only,
    anything older = deleted. No-ops quickly when there is nothing to prune."""
    current_year = datetime.now().year
    prev_year = current_year - 1

    def oldest_year():
        res = supabase_execute_with_retry(
            "prune: find oldest season",
            lambda: supabase.table("pitches")
            .select("game_year")
            .order("game_year", desc=False)
            .limit(1)
            .execute(),
        )
        return res.data[0]["game_year"] if res.data else None

    year = oldest_year()
    while year is not None and year < prev_year:
        logger.info("Pruning season %s (retention keeps %s and %s only)...",
                    year, prev_year, current_year)
        for win_start, win_end in _week_windows(year):
            supabase_execute_with_retry(
                f"prune {year} week of {win_start}",
                lambda y=year, s=win_start, e=win_end: supabase.table("pitches")
                .delete(returning="minimal")
                .eq("game_year", y)
                .gte("game_date", s)
                .lt("game_date", e)
                .execute(),
            )
        supabase_execute_with_retry(
            f"prune {year} remainder",
            lambda y=year: supabase.table("pitches")
            .delete(returning="minimal")
            .eq("game_year", y)
            .execute(),
        )
        logger.info("Season %s pruned.", year)
        year = oldest_year()

    # A "have we already stripped prev_year?" scan of the pitches table times out
    # once the season is clean (it reads every row before concluding no match), so
    # completion is recorded as a marker row in data_refresh_log instead.
    strip_marker_start = f"{prev_year}-01-01"

    def strip_marker_exists():
        res = supabase_execute_with_retry(
            "prune: check season_pruned marker",
            lambda: supabase.table("data_refresh_log")
            .select("start_date")
            .eq("status", "season_pruned")
            .eq("start_date", strip_marker_start)
            .limit(1)
            .execute(),
        )
        return bool(res.data)

    if not strip_marker_exists():
        logger.info("Stripping season %s to outcome pitches only...", prev_year)
        for win_start, win_end in _week_windows(prev_year):
            supabase_execute_with_retry(
                f"strip {prev_year} week of {win_start}",
                lambda s=win_start, e=win_end: supabase.table("pitches")
                .delete(returning="minimal")
                .eq("game_year", prev_year)
                .is_("events", "null")
                .gte("game_date", s)
                .lt("game_date", e)
                .execute(),
            )
        supabase_execute_with_retry(
            "prune: record season_pruned marker",
            lambda: supabase.table("data_refresh_log").insert({
                "start_date": strip_marker_start,
                "end_date": f"{prev_year}-12-31",
                "rows_inserted": 0,
                "status": "season_pruned",
                "error_message": None,
            }).execute(),
        )
        logger.info("Season %s stripped to outcome pitches.", prev_year)


def pull_statcast_data(start_date: str, end_date: str) -> pd.DataFrame:
    logger.info(f"Pulling Statcast data from {start_date} to {end_date}...")
    cache.enable()
    df = statcast(start_dt=start_date, end_dt=end_date)

    if df is None or df.empty:
        logger.warning(f"No data returned for {start_date} to {end_date}")
        return pd.DataFrame()

    logger.info(f"Pulled {len(df)} pitches")
    return df


def clean_data(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    available_cols = [col for col in SCHEMA_COLUMNS if col in df.columns]
    df = df[available_cols].copy()

    df = df.rename(columns=COLUMN_RENAMES)

    if "game_date" in df.columns:
        df["game_date"] = pd.to_datetime(df["game_date"]).dt.date

    if "game_year" not in df.columns and "game_date" in df.columns:
        df["game_year"] = pd.to_datetime(df["game_date"]).dt.year

    df = df.where(pd.notnull(df), None)

    for col in df.columns:
        df[col] = df[col].apply(lambda x: x.item() if hasattr(x, 'item') else x)

    logger.info(f"Cleaned data: {len(df)} rows, {len(df.columns)} columns")
    return df


def load_to_supabase(df: pd.DataFrame, supabase: Client, batch_size: int = 250):
    if df.empty:
        logger.warning("No data to load.")
        return 0

    total_rows = len(df)
    loaded = 0

    records = [sanitize_pitch_record(r) for r in df.to_dict(orient="records")]

    id_chunk = set()
    for r in records:
        b = _coerce_integer(r.get("batter"))
        p = _coerce_integer(r.get("pitcher"))
        if b is not None:
            id_chunk.add(b)
        if p is not None:
            id_chunk.add(p)
    chadwick_names = build_chadwick_id_to_name(id_chunk)
    for r in records:
        bid = _coerce_integer(r.get("batter"))
        if bid is not None and bid in chadwick_names:
            r["player_name"] = chadwick_names[bid]

    for i in range(0, total_rows, batch_size):
        batch = records[i:i + batch_size]

        def upsert_batch(b=batch):
            supabase.table("pitches").upsert(
                b,
                on_conflict="game_pk,at_bat_number,pitch_number",
            ).execute()

        try:
            supabase_execute_with_retry(f"pitches upsert starting row {i}", upsert_batch)
            loaded += len(batch)
            logger.info(f"Loaded {loaded}/{total_rows} rows")
        except Exception as e:
            logger.error("Error loading batch starting at row %s: %s", i, e)
            raise RuntimeError(
                f"pitches load failed at batch starting row {i} "
                f"({loaded}/{total_rows} rows loaded)"
            ) from e

    return loaded


def update_players_for_ids(all_ids: set, supabase: Client) -> None:
    """Resolve MLB IDs to names using Chadwick."""
    if not all_ids:
        return

    try:
        name_by_id = build_chadwick_id_to_name(all_ids)
    except Exception as e:
        raise RuntimeError(f"Chadwick lookup failed; players table not updated: {e}") from e

    records = []
    for pid in all_ids:
        name = name_by_id.get(pid)
        records.append({"player_id": pid, "player_name": name or "Unknown"})

    batch_size = 500
    try:
        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            supabase.table("players").upsert(batch, on_conflict="player_id").execute()
        logger.info("Updated %s player rows from Chadwick", len(records))
    except Exception as e:
        raise RuntimeError(f"players table update failed: {e}") from e


def update_players_table(df: pd.DataFrame, supabase: Client):
    if df.empty:
        return
    batter_ids = {_coerce_integer(x) for x in df["batter"].dropna().unique()}
    pitcher_ids = {_coerce_integer(x) for x in df["pitcher"].dropna().unique()}
    all_ids = {i for i in (batter_ids | pitcher_ids) if i is not None}
    update_players_for_ids(all_ids, supabase)


def run_rebuild_players_from_pitches():
    """Scan all pitches rows and refresh players from Chadwick (fixes bad names from old pipeline)."""
    supabase = get_supabase_client()
    all_ids = set()
    page_size = 5000
    last_id = None
    logger.info("Scanning pitches for distinct batter/pitcher IDs (keyset on id)...")
    while True:

        def fetch_ids():
            q = (
                supabase.table("pitches")
                .select("batter,pitcher,id")
                .order("id", desc=False)
            )
            if last_id is not None:
                q = q.gt("id", last_id)
            return q.limit(page_size).execute()

        res = supabase_execute_with_retry(
            f"rebuild-players scan id>{last_id!r}", fetch_ids
        )
        rows = res.data or []
        for row in rows:
            b = _coerce_integer(row.get("batter"))
            p = _coerce_integer(row.get("pitcher"))
            if b is not None:
                all_ids.add(b)
            if p is not None:
                all_ids.add(p)
        if not rows:
            break
        if "id" not in rows[-1]:
            raise RuntimeError(
                "pitches.id is required for rebuild-players pagination. "
                "Add a bigint/bigserial primary key `id` on pitches if missing."
            )
        last_id = rows[-1]["id"]
        if len(rows) < page_size:
            break
    logger.info("Found %s distinct player IDs", len(all_ids))
    update_players_for_ids(all_ids, supabase)


def run_backfill_pitch_batter_names(page_size: int = 200):
    """
    Rewrite pitches.player_name from Chadwick using p.batter for every row.
    Fixes wrong labels when the players table was stale or Statcast names were misleading.
    Uses upsert with full rows from select('*').

    Pages by pitches.id (keyset), not OFFSET — large OFFSET scans hit statement_timeout on Supabase.
    Retries on flaky TLS only (not Postgres statement timeouts).
    """
    supabase = get_supabase_client()
    last_id = None
    total_updated = 0
    pages = 0
    logger.info(
        "Backfilling pitches.player_name from Chadwick (page_size=%s, keyset on id)...",
        page_size,
    )
    while True:

        def fetch_page():
            q = (
                supabase.table("pitches")
                .select("*")
                .order("id", desc=False)
            )
            if last_id is not None:
                q = q.gt("id", last_id)
            return q.limit(page_size).execute()

        res = supabase_execute_with_retry(
            f"backfill fetch id>{last_id!r}", fetch_page
        )
        rows = res.data or []
        if not rows:
            break
        if "id" not in rows[0]:
            raise RuntimeError(
                "pitches.id is required for backfill pagination. "
                "Add a bigint/bigserial primary key `id` on pitches if missing."
            )
        batter_ids = {_coerce_integer(r.get("batter")) for r in rows}
        batter_ids.discard(None)
        name_map = build_chadwick_id_to_name(batter_ids)
        fixed_rows = []
        for r in rows:
            bid = _coerce_integer(r.get("batter"))
            if bid is None or bid not in name_map:
                continue
            canon = name_map[bid]
            if r.get("player_name") != canon:
                row = dict(r)
                row.pop("id", None)
                row["player_name"] = canon
                fixed_rows.append(row)
        if fixed_rows:

            def upsert_fixed(rows_arg=fixed_rows):
                supabase.table("pitches").upsert(
                    rows_arg,
                    on_conflict="game_pk,at_bat_number,pitch_number",
                ).execute()

            supabase_execute_with_retry(
                f"backfill upsert id>{last_id!r}", upsert_fixed
            )
            total_updated += len(fixed_rows)
        pages += 1
        if pages % 50 == 0:
            logger.info("Backfill progress: %s pages, %s rows rewritten so far", pages, total_updated)
        last_id = rows[-1]["id"]
        if len(rows) < page_size:
            break
    logger.info("Backfill complete: %s pitch rows updated across %s pages", total_updated, pages)


def log_refresh(supabase: Client, start_date: str, end_date: str,
                rows_inserted: int, status: str = "success", error_msg: str = None):
    try:
        supabase.table("data_refresh_log").insert({
            "start_date": start_date,
            "end_date": end_date,
            "rows_inserted": rows_inserted,
            "status": status,
            "error_message": error_msg
        }).execute()
    except Exception as e:
        logger.error(f"Error logging refresh: {e}")


def get_last_refresh_date(supabase: Client) -> str:
    try:
        result = supabase.table("data_refresh_log") \
            .select("end_date") \
            .eq("status", "success") \
            .order("end_date", desc=True) \
            .limit(1) \
            .execute()

        if result.data:
            return result.data[0]["end_date"]
    except Exception as e:
        logger.error(f"Error getting last refresh date: {e}")

    return None


def run_historical_load(start_date: str, end_date: str, events_only: bool = False):
    supabase = get_supabase_client()

    current_start = datetime.strptime(start_date, "%Y-%m-%d")
    final_end = datetime.strptime(end_date, "%Y-%m-%d")
    total_loaded = 0

    while current_start < final_end:
        current_end = min(current_start + timedelta(days=6), final_end)

        start_str = current_start.strftime("%Y-%m-%d")
        end_str = current_end.strftime("%Y-%m-%d")

        try:
            df = pull_statcast_data(start_str, end_str)
            df = clean_data(df)
            if events_only and not df.empty:
                df = df[df["events"].notna() & (df["events"] != "")]
                logger.info(f"Outcome pitches only: {len(df)} rows kept")
            rows = load_to_supabase(df, supabase)
            update_players_table(df, supabase)
            log_refresh(supabase, start_str, end_str, rows)
            total_loaded += rows
        except Exception as e:
            logger.error(f"Error processing {start_str} to {end_str}: {e}")
            log_refresh(supabase, start_str, end_str, 0, "error", str(e))

        current_start = current_end + timedelta(days=1)

    logger.info(f"Historical load complete. Total rows loaded: {total_loaded}")


def run_weekly_refresh():
    supabase = get_supabase_client()

    try:
        prune_old_seasons(supabase)
    except Exception as e:
        # Retention failures shouldn't block loading new data; if the database is
        # actually full, the load below fails loudly on its own.
        logger.warning("Season pruning failed (continuing with refresh): %s", e)

    last_date = get_last_refresh_date(supabase)
    if last_date:
        start_date = (datetime.strptime(last_date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    else:
        start_date = f"{datetime.now().year}-03-20"

    # Pull only through yesterday: today's games are unplayed or in progress when
    # the job runs, and logging success through today would skip them forever.
    end_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    if start_date > end_date:
        logger.info("No new data to refresh.")
        return

    logger.info(f"Refreshing data from {start_date} to {end_date}")

    try:
        df = pull_statcast_data(start_date, end_date)
        df = clean_data(df)
        rows = load_to_supabase(df, supabase)
        update_players_table(df, supabase)
        log_refresh(supabase, start_date, end_date, rows)
        logger.info(f"Refresh complete. {rows} rows loaded.")
    except Exception as e:
        logger.error(f"Refresh failed: {e}")
        log_refresh(supabase, start_date, end_date, 0, "error", str(e))
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Statcast Data Pipeline")
    parser.add_argument(
        "--mode",
        choices=["historical", "refresh", "rebuild-players", "backfill-pitch-names"],
        required=True,
        help="'historical' for initial load, 'refresh' for weekly update, "
        "'rebuild-players' to refresh players from Chadwick, "
        "'backfill-pitch-names' to set pitches.player_name from Chadwick(batter) for all rows",
    )
    parser.add_argument("--start", type=str, help="Start date for historical load (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, help="End date for historical load (YYYY-MM-DD)")
    parser.add_argument(
        "--events-only",
        action="store_true",
        help="Historical mode: keep only pitches with a plate-appearance outcome "
        "(events IS NOT NULL). Used to load the previous season under the "
        "rolling retention policy.",
    )

    args = parser.parse_args()

    if args.mode == "historical":
        if not args.start or not args.end:
            print("--start and --end are required for historical mode")
            sys.exit(1)
        run_historical_load(args.start, args.end, events_only=args.events_only)
    elif args.mode == "refresh":
        run_weekly_refresh()
    elif args.mode == "rebuild-players":
        run_rebuild_players_from_pitches()
    elif args.mode == "backfill-pitch-names":
        run_backfill_pitch_batter_names()
