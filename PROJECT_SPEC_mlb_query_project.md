# Statcast AI Query Engine — Full Project Specification

## Project Overview

Build a web application that allows users to query MLB Statcast data using plain English. The app uses AI to convert natural language into SQL, executes the query against a Supabase PostgreSQL database loaded with Baseball Savant pitch-level data, and dynamically generates appropriate visualizations (spray charts, strike zone heatmaps, bar charts, time series, etc.) based on the query results.

**Tech Stack:**
- **Database:** Supabase (PostgreSQL) — Free tier
- **Data Pipeline:** Python (pybaseball library)
- **Weekly Refresh:** GitHub Actions (cron schedule)
- **Frontend:** React (Vite) hosted on GitHub Pages
- **AI Layer:** Anthropic Claude API (for natural language → SQL and visualization selection)
- **Supabase Client:** @supabase/supabase-js

**Data Scope:** 2025 season (complete) + 2026 season (in progress, refreshed weekly)

---

## Environment Variables & .env Setup

This project uses `.env` files to manage Supabase keys and other secrets. **Create both `.env` files below during project setup.** The developer will paste in their actual keys — use placeholder values as shown.

### File: `.gitignore` (project root)

Create this file first to ensure keys are never committed.

```
# Environment variables
.env
data_pipeline/.env
frontend/.env

# Python
__pycache__/
*.pyc
.pybaseball/

# Node
node_modules/
dist/

# OS
.DS_Store
```

### File: `data_pipeline/.env`

This file holds the service role key used by the Python data pipeline. The service role key has full database access and must never be exposed in frontend code or committed to git.

```
SUPABASE_URL=your_supabase_project_url_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

**Update `data_pipeline/requirements.txt`** to include `python-dotenv`:

```
pybaseball>=2.0.0
supabase>=2.0.0
pandas>=2.0.0
python-dateutil>=2.8.0
python-dotenv>=1.0.0
```

**Update `data_pipeline/pull_statcast.py`** — add these lines at the very top of the file, before any other imports:

```python
from dotenv import load_dotenv
load_dotenv()
```

The existing `os.environ.get("SUPABASE_URL")` and `os.environ.get("SUPABASE_SERVICE_ROLE_KEY")` calls will then automatically read from the `.env` file.

### File: `frontend/.env`

This file holds the anon/public key used by the frontend React app. The anon key is designed for client-side use — Row Level Security (RLS) on Supabase protects the data.

```
VITE_SUPABASE_URL=your_supabase_project_url_here
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

Vite automatically loads `.env` files. All frontend environment variables **must** be prefixed with `VITE_` or Vite will not expose them. The frontend code accesses these via `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_ANON_KEY`.

### Where to Find Your Supabase Keys

After creating your Supabase project, go to **Settings → API** in the Supabase dashboard. You need three values:

| Value | Where It Goes | Example |
|-------|--------------|---------|
| Project URL | Both `.env` files as `SUPABASE_URL` / `VITE_SUPABASE_URL` | `https://abcdefg.supabase.co` |
| `anon` / `public` key | `frontend/.env` as `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIs...` |
| `service_role` key | `data_pipeline/.env` as `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIs...` |

Also add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as **GitHub repository secrets** (Settings → Secrets → Actions) for the GitHub Actions workflows.

---

## Phase 1: Database Schema (Supabase)

### Table: `pitches`

This is the core fact table. Each row represents a single pitch from a game. It contains pitching data, batting outcomes, game context, and baserunner state. Run the following SQL in the Supabase SQL Editor to create the table.

```sql
-- ============================================
-- STATCAST PITCHES TABLE
-- Core fact table: one row per pitch
-- ============================================

CREATE TABLE pitches (
    -- Primary identifier
    id BIGSERIAL PRIMARY KEY,

    -- ---- GAME CONTEXT ----
    game_pk INTEGER NOT NULL,              -- Unique game ID
    game_date DATE NOT NULL,               -- Date of game
    game_year INTEGER NOT NULL,            -- Year of game
    game_type VARCHAR(2),                  -- R=Regular, F=Wild Card, D=Division, L=LCS, W=WS, S=Spring, E=Exhibition
    home_team VARCHAR(5),                  -- Home team abbreviation
    away_team VARCHAR(5),                  -- Away team abbreviation
    inning INTEGER,                        -- Inning number
    inning_topbot VARCHAR(3),              -- 'Top' or 'Bot'
    at_bat_number INTEGER,                 -- Plate appearance number in game
    pitch_number INTEGER,                  -- Pitch number within the plate appearance

    -- ---- PITCHER INFO ----
    pitcher INTEGER NOT NULL,              -- MLB Player ID of pitcher
    p_throws VARCHAR(1),                   -- Pitcher handedness: R or L

    -- ---- BATTER INFO ----
    batter INTEGER NOT NULL,               -- MLB Player ID of batter
    stand VARCHAR(1),                      -- Batter side: R or L
    player_name VARCHAR(100),              -- Player name tied to the event

    -- ---- PITCH CHARACTERISTICS ----
    pitch_type VARCHAR(5),                 -- Pitch type code (FF, SL, CU, CH, SI, FC, etc.)
    pitch_name VARCHAR(50),                -- Full pitch name (4-Seam Fastball, Slider, etc.)
    release_speed NUMERIC(5,1),            -- Pitch velocity (mph)
    effective_speed NUMERIC(5,1),          -- Effective speed based on extension
    release_spin NUMERIC(7,1),             -- Spin rate (rpm)
    spin_axis NUMERIC(6,1),               -- Spin axis in degrees (0-360)
    release_pos_x NUMERIC(6,3),           -- Horizontal release position (feet)
    release_pos_y NUMERIC(6,3),           -- Release position depth (feet)
    release_pos_z NUMERIC(6,3),           -- Vertical release position (feet)
    release_extension NUMERIC(5,2),        -- Extension from rubber (feet)

    -- ---- PITCH MOVEMENT ----
    pfx_x NUMERIC(6,2),                   -- Horizontal movement (feet, catcher perspective)
    pfx_z NUMERIC(6,2),                   -- Vertical movement (feet, catcher perspective)

    -- ---- PITCH LOCATION (at plate) ----
    plate_x NUMERIC(6,3),                 -- Horizontal position at plate (feet)
    plate_z NUMERIC(6,3),                 -- Vertical position at plate (feet)
    zone INTEGER,                          -- Strike zone region (1-14)
    sz_top NUMERIC(5,2),                  -- Top of batter's strike zone
    sz_bot NUMERIC(5,2),                  -- Bottom of batter's strike zone

    -- ---- PITCH TRAJECTORY (at y=50 feet) ----
    vx0 NUMERIC(8,3),                     -- Velocity in x-dimension (ft/s)
    vy0 NUMERIC(8,3),                     -- Velocity in y-dimension (ft/s)
    vz0 NUMERIC(8,3),                     -- Velocity in z-dimension (ft/s)
    ax NUMERIC(8,3),                      -- Acceleration in x-dimension (ft/s²)
    ay NUMERIC(8,3),                      -- Acceleration in y-dimension (ft/s²)
    az NUMERIC(8,3),                      -- Acceleration in z-dimension (ft/s²)

    -- ---- PITCH RESULT ----
    type VARCHAR(1),                       -- B=ball, S=strike, X=in play
    description TEXT,                      -- Pitch result description (called_strike, swinging_strike, hit_into_play, ball, foul, etc.)
    des TEXT,                              -- Full plate appearance text description from Gameday
    events VARCHAR(50),                    -- PA outcome (single, double, home_run, strikeout, field_out, walk, etc.) — only populated on final pitch of PA

    -- ---- BATTED BALL DATA (only when ball is put in play) ----
    launch_speed NUMERIC(5,1),            -- Exit velocity (mph)
    launch_angle NUMERIC(5,1),            -- Launch angle (degrees)
    hit_distance NUMERIC(6,1),            -- Projected hit distance (feet)
    launch_speed_angle INTEGER,            -- Contact quality zone (1=Weak, 2=Topped, 3=Under, 4=Flare, 5=Solid, 6=Barrel)
    hc_x NUMERIC(7,2),                   -- Hit coordinate X (for spray chart plotting)
    hc_y NUMERIC(7,2),                   -- Hit coordinate Y (for spray chart plotting)
    hit_location INTEGER,                  -- Fielding position of first fielder to touch ball (1-9)
    bb_type VARCHAR(20),                   -- ground_ball, line_drive, fly_ball, popup

    -- ---- EXPECTED STATS ----
    estimated_ba_using_speedangle NUMERIC(5,3),    -- xBA based on exit velo and launch angle
    estimated_woba_using_speedangle NUMERIC(5,3),  -- xwOBA based on exit velo and launch angle
    woba_value NUMERIC(5,3),                       -- Actual wOBA value of the play
    woba_denom NUMERIC(5,3),                       -- wOBA denominator
    babip_value NUMERIC(5,3),                      -- BABIP value of the play
    iso_value NUMERIC(5,3),                        -- ISO value of the play

    -- ---- GAME SITUATION ----
    balls INTEGER,                         -- Pre-pitch ball count
    strikes INTEGER,                       -- Pre-pitch strike count
    outs_when_up INTEGER,                  -- Pre-pitch out count
    on_1b INTEGER,                         -- MLB Player ID of runner on 1B (NULL if empty)
    on_2b INTEGER,                         -- MLB Player ID of runner on 2B (NULL if empty)
    on_3b INTEGER,                         -- MLB Player ID of runner on 3B (NULL if empty)

    -- ---- SCORING ----
    home_score INTEGER,                    -- Pre-pitch home score
    away_score INTEGER,                    -- Pre-pitch away score
    bat_score INTEGER,                     -- Pre-pitch batting team score
    fld_score INTEGER,                     -- Pre-pitch fielding team score
    post_home_score INTEGER,               -- Post-pitch home score
    post_away_score INTEGER,               -- Post-pitch away score
    post_bat_score INTEGER,                -- Post-pitch batting team score
    -- NOTE: RBIs can be derived as (post_bat_score - bat_score) on event pitches

    -- ---- FIELDING ALIGNMENT ----
    if_fielding_alignment VARCHAR(50),     -- Infield alignment
    of_fielding_alignment VARCHAR(50),     -- Outfield alignment

    -- ---- FIELDER IDs ----
    fielder_2 INTEGER,                     -- Catcher
    fielder_3 INTEGER,                     -- 1B
    fielder_4 INTEGER,                     -- 2B
    fielder_5 INTEGER,                     -- 3B
    fielder_6 INTEGER,                     -- SS
    fielder_7 INTEGER,                     -- LF
    fielder_8 INTEGER,                     -- CF
    fielder_9 INTEGER,                     -- RF

    -- ---- WIN/RUN EXPECTANCY ----
    delta_home_win_exp NUMERIC(6,4),       -- Change in win expectancy
    delta_run_exp NUMERIC(6,4),            -- Change in run expectancy

    -- ---- METADATA ----
    sv_id VARCHAR(50),                     -- Non-unique play event ID per game

    -- ---- DEDUPLICATION ----
    UNIQUE(game_pk, at_bat_number, pitch_number)
);

-- ============================================
-- INDEXES for common query patterns
-- ============================================

-- Game lookups
CREATE INDEX idx_pitches_game_date ON pitches(game_date);
CREATE INDEX idx_pitches_game_year ON pitches(game_year);
CREATE INDEX idx_pitches_game_pk ON pitches(game_pk);

-- Player lookups
CREATE INDEX idx_pitches_pitcher ON pitches(pitcher);
CREATE INDEX idx_pitches_batter ON pitches(batter);
CREATE INDEX idx_pitches_player_name ON pitches(player_name);

-- Pitch type analysis
CREATE INDEX idx_pitches_pitch_type ON pitches(pitch_type);

-- Batted ball analysis
CREATE INDEX idx_pitches_events ON pitches(events);
CREATE INDEX idx_pitches_launch_speed ON pitches(launch_speed);
CREATE INDEX idx_pitches_launch_angle ON pitches(launch_angle);
CREATE INDEX idx_pitches_bb_type ON pitches(bb_type);

-- Team lookups
CREATE INDEX idx_pitches_home_team ON pitches(home_team);
CREATE INDEX idx_pitches_away_team ON pitches(away_team);

-- Composite index for common filtered queries
CREATE INDEX idx_pitches_pitcher_date ON pitches(pitcher, game_date);
CREATE INDEX idx_pitches_batter_date ON pitches(batter, game_date);
CREATE INDEX idx_pitches_year_team ON pitches(game_year, home_team);
```

### Table: `players`

Dimension table mapping player IDs to names, teams, and positions.

```sql
CREATE TABLE players (
    player_id INTEGER PRIMARY KEY,         -- MLB Player ID (MLBAM)
    player_name VARCHAR(100) NOT NULL,
    team VARCHAR(5),                       -- Current team abbreviation
    position VARCHAR(5),                   -- Primary position
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_players_name ON players(player_name);
CREATE INDEX idx_players_team ON players(team);
```

### Table: `data_refresh_log`

Tracks when data was last refreshed (used by the GitHub Action to know where to pick up).

```sql
CREATE TABLE data_refresh_log (
    id SERIAL PRIMARY KEY,
    refresh_date TIMESTAMP DEFAULT NOW(),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    rows_inserted INTEGER,
    status VARCHAR(20) DEFAULT 'success',
    error_message TEXT
);
```

---

## Phase 2: Data Pipeline (Python)

### File: `data_pipeline/pull_statcast.py`

This script pulls Statcast data from Baseball Savant using pybaseball and loads it into Supabase.

```python
"""
Statcast Data Pipeline
Pulls pitch-level data from Baseball Savant and loads into Supabase.
Usage:
    # Initial historical load (run once)
    python pull_statcast.py --mode historical --start 2025-03-20 --end 2025-11-01

    # Weekly refresh (run by GitHub Actions)
    python pull_statcast.py --mode refresh
"""

import os
import sys
import argparse
import logging
from datetime import datetime, timedelta

from dotenv import load_dotenv
load_dotenv()

import pandas as pd
from pybaseball import statcast, cache
from supabase import create_client, Client

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Supabase connection
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Column mapping: pybaseball DataFrame columns → database columns
# pybaseball returns columns matching the Savant CSV export.
# Most map 1:1 by name. Only include columns that exist in our schema.
SCHEMA_COLUMNS = [
    "game_pk", "game_date", "game_year", "game_type", "home_team", "away_team",
    "inning", "inning_topbot", "at_bat_number", "pitch_number",
    "pitcher", "p_throws", "batter", "stand", "player_name",
    "pitch_type", "pitch_name", "release_speed", "effective_speed",
    "release_spin_rate", "spin_axis",
    "release_pos_x", "release_pos_y", "release_pos_z", "release_extension",
    "pfx_x", "pfx_z", "plate_x", "plate_z", "zone", "sz_top", "sz_bot",
    "vx0", "vy0", "vz0", "ax", "ay", "az",
    "type", "description", "des", "events",
    "launch_speed", "launch_angle", "hit_distance_sc", "launch_speed_angle",
    "hc_x", "hc_y", "hit_location", "bb_type",
    "estimated_ba_using_speedangle", "estimated_woba_using_speedangle",
    "woba_value", "woba_denom", "babip_value", "iso_value",
    "balls", "strikes", "outs_when_up", "on_1b", "on_2b", "on_3b",
    "home_score", "away_score", "bat_score", "fld_score",
    "post_home_score", "post_away_score", "post_bat_score",
    "if_fielding_alignment", "of_fielding_alignment",
    "fielder_2", "fielder_3", "fielder_4", "fielder_5",
    "fielder_6", "fielder_7", "fielder_8", "fielder_9",
    "delta_home_win_exp", "delta_run_exp", "sv_id"
]

# Columns that need renaming from pybaseball names to our schema names
COLUMN_RENAMES = {
    "release_spin_rate": "release_spin",
    "hit_distance_sc": "hit_distance",
}


def get_supabase_client() -> Client:
    """Initialize and return Supabase client."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as environment variables."
        )
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def pull_statcast_data(start_date: str, end_date: str) -> pd.DataFrame:
    """
    Pull Statcast data for a date range using pybaseball.
    Returns a cleaned DataFrame ready for database insertion.
    """
    logger.info(f"Pulling Statcast data from {start_date} to {end_date}...")

    # Enable caching to avoid re-downloading on failures
    cache.enable()

    df = statcast(start_dt=start_date, end_dt=end_date)

    if df is None or df.empty:
        logger.warning(f"No data returned for {start_date} to {end_date}")
        return pd.DataFrame()

    logger.info(f"Pulled {len(df)} pitches")
    return df


def clean_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    Clean and prepare the DataFrame for database insertion.
    - Select only columns in our schema
    - Rename columns where pybaseball names differ
    - Handle NaN values
    - Ensure correct data types
    """
    if df.empty:
        return df

    # Only keep columns that exist in both the dataframe and our schema
    available_cols = [col for col in SCHEMA_COLUMNS if col in df.columns]
    df = df[available_cols].copy()

    # Rename columns to match database schema
    df = df.rename(columns=COLUMN_RENAMES)

    # Convert game_date to proper date format
    if "game_date" in df.columns:
        df["game_date"] = pd.to_datetime(df["game_date"]).dt.date

    # Add game_year if not present
    if "game_year" not in df.columns and "game_date" in df.columns:
        df["game_year"] = pd.to_datetime(df["game_date"]).dt.year

    # Replace NaN with None for proper NULL handling in PostgreSQL
    df = df.where(pd.notnull(df), None)

    # Convert numpy types to native Python types for JSON serialization
    for col in df.columns:
        df[col] = df[col].apply(
            lambda x: int(x) if isinstance(x, (pd.core.arrays.integer.IntegerDtype,)) 
            else float(x) if isinstance(x, float) and x == x
            else x
        )

    logger.info(f"Cleaned data: {len(df)} rows, {len(df.columns)} columns")
    return df


def load_to_supabase(df: pd.DataFrame, supabase: Client, batch_size: int = 500):
    """
    Load DataFrame into Supabase pitches table in batches.
    Uses upsert to handle duplicates gracefully.
    """
    if df.empty:
        logger.warning("No data to load.")
        return 0

    total_rows = len(df)
    loaded = 0

    # Convert DataFrame to list of dicts
    records = df.to_dict(orient="records")

    # Clean up records: convert date objects to strings, handle NaN
    for record in records:
        for key, value in record.items():
            if isinstance(value, pd.Timestamp):
                record[key] = value.isoformat()
            elif isinstance(value, float) and pd.isna(value):
                record[key] = None
            elif hasattr(value, 'item'):  # numpy types
                record[key] = value.item()

    for i in range(0, total_rows, batch_size):
        batch = records[i:i + batch_size]
        try:
            supabase.table("pitches").upsert(
                batch,
                on_conflict="game_pk,at_bat_number,pitch_number"
            ).execute()
            loaded += len(batch)
            logger.info(f"Loaded {loaded}/{total_rows} rows")
        except Exception as e:
            logger.error(f"Error loading batch starting at row {i}: {e}")
            # Continue with next batch rather than failing entirely
            continue

    return loaded


def update_players_table(df: pd.DataFrame, supabase: Client):
    """
    Extract unique players from pitch data and upsert into players table.
    """
    if df.empty:
        return

    # Collect unique batter entries
    batters = df[["batter", "player_name"]].drop_duplicates(subset=["batter"])
    batters = batters.rename(columns={"batter": "player_id"})

    # Collect unique pitcher entries
    pitchers = df[["pitcher", "player_name"]].drop_duplicates(subset=["pitcher"])
    # Note: player_name in Savant data is tied to the search context.
    # For a more complete solution, you could use pybaseball.playerid_reverse_lookup

    # Combine and deduplicate
    players = pd.concat([batters, pitchers]).drop_duplicates(subset=["player_id"])
    players = players.where(pd.notnull(players), None)

    records = players.to_dict(orient="records")

    try:
        supabase.table("players").upsert(
            records,
            on_conflict="player_id"
        ).execute()
        logger.info(f"Updated {len(records)} players")
    except Exception as e:
        logger.error(f"Error updating players table: {e}")


def log_refresh(supabase: Client, start_date: str, end_date: str,
                rows_inserted: int, status: str = "success", error_msg: str = None):
    """Log the refresh event to the data_refresh_log table."""
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
    """Get the most recent end_date from refresh log."""
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


def run_historical_load(start_date: str, end_date: str):
    """
    Run the initial historical data load.
    Breaks the date range into weekly chunks to avoid overwhelming the API.
    """
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
    """
    Run the weekly data refresh.
    Picks up where the last successful refresh left off.
    """
    supabase = get_supabase_client()

    # Determine start date
    last_date = get_last_refresh_date(supabase)
    if last_date:
        start_date = (datetime.strptime(last_date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    else:
        # If no previous refresh, start from beginning of current season
        start_date = f"{datetime.now().year}-03-20"

    end_date = datetime.now().strftime("%Y-%m-%d")

    if start_date >= end_date:
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
    parser.add_argument("--mode", choices=["historical", "refresh"], required=True,
                        help="'historical' for initial load, 'refresh' for weekly update")
    parser.add_argument("--start", type=str, help="Start date for historical load (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, help="End date for historical load (YYYY-MM-DD)")

    args = parser.parse_args()

    if args.mode == "historical":
        if not args.start or not args.end:
            print("--start and --end are required for historical mode")
            sys.exit(1)
        run_historical_load(args.start, args.end)
    elif args.mode == "refresh":
        run_weekly_refresh()
```

### File: `data_pipeline/requirements.txt`

```
pybaseball>=2.0.0
supabase>=2.0.0
pandas>=2.0.0
python-dateutil>=2.8.0
python-dotenv>=1.0.0
```

---

## Phase 3: GitHub Actions Weekly Refresh

### File: `.github/workflows/weekly_refresh.yml`

```yaml
name: Weekly Statcast Data Refresh

on:
  schedule:
    # Runs every Monday at 8:00 AM UTC during baseball season (March-November)
    - cron: '0 8 * * 1'
  workflow_dispatch:  # Allows manual trigger from GitHub UI

jobs:
  refresh:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          cd data_pipeline
          pip install -r requirements.txt

      - name: Run weekly refresh
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          cd data_pipeline
          python pull_statcast.py --mode refresh
```

---

## Phase 4: Frontend Application

### Architecture

```
frontend/
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── components/
│   │   ├── QueryInput.jsx          # Natural language input box
│   │   ├── SQLDisplay.jsx          # Shows generated SQL query
│   │   ├── ResultsTable.jsx        # Data table of query results
│   │   ├── VisualizationEngine.jsx # Dynamic chart/viz renderer
│   │   ├── SprayChart.jsx          # Baseball diamond spray chart
│   │   ├── StrikeZone.jsx          # Strike zone heatmap
│   │   ├── GenericChart.jsx        # Bar, line, scatter charts (use Recharts)
│   │   └── LoadingSpinner.jsx
│   ├── lib/
│   │   ├── supabase.js             # Supabase client init
│   │   ├── aiQueryEngine.js        # Claude API integration
│   │   └── schemaContext.js        # Schema definition sent to AI
│   └── styles/
│       └── app.css
```

### File: `frontend/src/lib/schemaContext.js`

This is the critical file that provides the AI with database context so it can generate accurate SQL. This is what makes the natural-language-to-SQL actually work reliably.

```javascript
/**
 * Schema context sent to the AI model so it knows the database structure,
 * column meanings, and can generate accurate SQL queries.
 * 
 * IMPORTANT: Keep this in sync with the actual database schema.
 * The quality of generated SQL depends heavily on the clarity of these descriptions.
 */

export const SCHEMA_CONTEXT = `
You are a SQL query generator for a baseball analytics database.
The database is PostgreSQL (Supabase) and contains MLB Statcast pitch-level data.

## DATABASE SCHEMA

### Table: pitches
One row per pitch thrown in an MLB game. Contains pitch data, batting outcomes, and game context.
Data covers the 2025 and 2026 MLB seasons.

KEY COLUMNS AND THEIR MEANINGS:

-- Identifiers
game_pk (INTEGER): Unique game ID
game_date (DATE): Date of the game
game_year (INTEGER): Year (2025 or 2026)
game_type (VARCHAR): R=Regular Season, F=Wild Card, D=Division Series, L=LCS, W=World Series

-- Players
pitcher (INTEGER): MLB Player ID of the pitcher
batter (INTEGER): MLB Player ID of the batter
player_name (VARCHAR): Name of the player tied to the search event
stand (VARCHAR): Batter handedness — 'R' (right) or 'L' (left)
p_throws (VARCHAR): Pitcher handedness — 'R' (right) or 'L' (left)

-- Teams
home_team (VARCHAR): Home team abbreviation (e.g. 'NYY', 'LAD', 'BOS')
away_team (VARCHAR): Away team abbreviation

-- Pitch Info
pitch_type (VARCHAR): Pitch type code — FF=4-Seam Fastball, SL=Slider, CU=Curveball, CH=Changeup, SI=Sinker, FC=Cutter, FS=Splitter, KC=Knuckle Curve, ST=Sweeper, SV=Screwball
pitch_name (VARCHAR): Full name of pitch type (e.g. '4-Seam Fastball')
release_speed (NUMERIC): Pitch velocity in MPH
release_spin (NUMERIC): Spin rate in RPM
spin_axis (NUMERIC): Spin axis in degrees (0-360)
release_extension (NUMERIC): How far in front of the rubber the pitcher releases (feet)
effective_speed (NUMERIC): Perceived speed based on extension

-- Pitch Location (from catcher's perspective)
plate_x (NUMERIC): Horizontal location at the plate in feet. 0 = center, negative = inside to RHB
plate_z (NUMERIC): Vertical location at the plate in feet
zone (INTEGER): Strike zone region. 1-9 = in the zone, 11-14 = out of zone
sz_top (NUMERIC): Top of batter's strike zone
sz_bot (NUMERIC): Bottom of batter's strike zone

-- Pitch Movement
pfx_x (NUMERIC): Horizontal movement in feet
pfx_z (NUMERIC): Vertical movement (rise/drop) in feet

-- Pitch Outcome
type (VARCHAR): B=ball, S=strike, X=in play
description (VARCHAR): Detailed result — 'called_strike', 'swinging_strike', 'ball', 'foul', 'hit_into_play', 'hit_into_play_score', etc.
events (VARCHAR): Plate appearance outcome — ONLY populated on the FINAL pitch of a PA. Values include: 'single', 'double', 'triple', 'home_run', 'strikeout', 'walk', 'field_out', 'grounded_into_double_play', 'force_out', 'sac_fly', 'hit_by_pitch', 'fielders_choice', etc.
des (TEXT): Full text description from Gameday (e.g. "Aaron Judge homers (15) on a fly ball to left center field. 2 runs score.")

-- Batted Ball Data (only populated when type='X', i.e. ball was put in play)
launch_speed (NUMERIC): Exit velocity in MPH
launch_angle (NUMERIC): Launch angle in degrees. Negative=groundball, 10-25=line drive, 25-50=fly ball
hit_distance (NUMERIC): Projected distance in feet
bb_type (VARCHAR): 'ground_ball', 'line_drive', 'fly_ball', 'popup'
hc_x (NUMERIC): Hit coordinate X — for plotting spray charts on a baseball diamond
hc_y (NUMERIC): Hit coordinate Y — for plotting spray charts on a baseball diamond
hit_location (INTEGER): Fielding position that first fielded the ball (1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF)
launch_speed_angle (INTEGER): Contact quality — 1=Weak, 2=Topped, 3=Under, 4=Flare/Burner, 5=Solid Contact, 6=Barrel

-- Expected Stats (based on exit velo + launch angle)
estimated_ba_using_speedangle (NUMERIC): Expected batting average (xBA)
estimated_woba_using_speedangle (NUMERIC): Expected weighted on-base average (xwOBA)
woba_value (NUMERIC): Actual wOBA value of the play
babip_value (NUMERIC): BABIP value of the play
iso_value (NUMERIC): ISO value of the play

-- Game Situation
balls (INTEGER): Ball count before this pitch (0-3)
strikes (INTEGER): Strike count before this pitch (0-2)
outs_when_up (INTEGER): Outs before this pitch (0-2)
inning (INTEGER): Inning number
inning_topbot (VARCHAR): 'Top' or 'Bot'
on_1b (INTEGER): Player ID of runner on 1st (NULL if empty)
on_2b (INTEGER): Player ID of runner on 2nd (NULL if empty)
on_3b (INTEGER): Player ID of runner on 3rd (NULL if empty)

-- Scoring
home_score (INTEGER): Home team score before pitch
away_score (INTEGER): Away team score before pitch
bat_score (INTEGER): Batting team score before pitch
post_bat_score (INTEGER): Batting team score after pitch
-- TO CALCULATE RUNS SCORED ON A PLAY: (post_bat_score - bat_score) on pitches where events IS NOT NULL

-- Win Expectancy
delta_home_win_exp (NUMERIC): Change in win expectancy from this play
delta_run_exp (NUMERIC): Change in run expectancy from this pitch

-- Fielding
if_fielding_alignment (VARCHAR): Infield alignment
of_fielding_alignment (VARCHAR): Outfield alignment

### Table: players
player_id (INTEGER PRIMARY KEY): MLB Player ID
player_name (VARCHAR): Player full name
team (VARCHAR): Current team abbreviation
position (VARCHAR): Primary position

## IMPORTANT QUERY RULES

1. When filtering by player name, use ILIKE for case-insensitive matching:
   WHERE player_name ILIKE '%judge%'
   Or join to the players table for more reliable lookups.

2. For batting stats, filter to pitches where events IS NOT NULL to get only plate appearance outcomes.

3. For counting home runs: WHERE events = 'home_run'
   For strikeouts: WHERE events = 'strikeout'
   For hits: WHERE events IN ('single', 'double', 'triple', 'home_run')

4. For pitching analysis (pitch movement, velocity), use ALL pitches (not just PA outcomes).

5. RBIs are not a direct column. Calculate as: SUM(post_bat_score - bat_score) on event pitches.

6. Stolen bases appear in the description field, e.g., description ILIKE '%stolen%'

7. Common team abbreviations: NYY, NYM, BOS, LAD, LAA, SF, CHC, CWS, HOU, ATL, PHI, SD, SEA, MIN, TB, TOR, BAL, DET, CLE, KC, MIL, STL, CIN, PIT, COL, ARI, TEX, OAK, MIA, WSH

8. Always limit results to a reasonable number (e.g., LIMIT 50) unless the user specifically asks for all data.

9. Return columns that are useful for visualization. For spray charts, always include hc_x and hc_y. For strike zone plots, include plate_x and plate_z.

10. When asked about "barrels" or "barreled balls", use launch_speed_angle = 6.

11. Always use descriptive column aliases for readability.

Return ONLY the SQL query. Do not include any explanation or markdown formatting.
`;
```

### File: `frontend/src/lib/aiQueryEngine.js`

```javascript
/**
 * AI Query Engine
 * Handles two AI calls:
 * 1. Natural language → SQL query generation
 * 2. Query results → visualization type selection + config
 */

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

/**
 * Convert a natural language question into a SQL query.
 * @param {string} userQuestion - The plain English question from the user
 * @param {string} apiKey - Claude API key
 * @param {string} schemaContext - Database schema context
 * @returns {string} Generated SQL query
 */
export async function generateSQL(userQuestion, apiKey, schemaContext) {
    const response = await fetch(CLAUDE_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            system: schemaContext,
            messages: [
                {
                    role: "user",
                    content: `Generate a PostgreSQL query for the following question. Return ONLY the SQL query, no explanation:\n\n${userQuestion}`
                }
            ]
        })
    });

    const data = await response.json();
    let sql = data.content[0].text.trim();

    // Strip markdown code fences if present
    sql = sql.replace(/```sql\n?/gi, "").replace(/```\n?/g, "").trim();

    return sql;
}


/**
 * Determine the best visualization type and configuration for query results.
 * @param {string} userQuestion - Original question
 * @param {string} sqlQuery - The SQL that was executed
 * @param {Array} columns - Column names in the result set
 * @param {Array} sampleRows - First few rows of results (for context)
 * @param {string} apiKey - Claude API key
 * @returns {Object} Visualization config
 */
export async function determineVisualization(userQuestion, sqlQuery, columns, sampleRows, apiKey) {
    const response = await fetch(CLAUDE_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            system: `You are a data visualization advisor for a baseball analytics app.
Given a user's question, the SQL query that was run, and the result columns/sample data,
determine the best visualization type.

Available visualization types:
- "spray_chart": For batted ball locations on a baseball diamond. Requires hc_x and hc_y columns.
- "strike_zone": For pitch location heatmaps. Requires plate_x and plate_z columns.
- "bar_chart": For comparing categories (e.g., pitch type counts, player rankings).
- "line_chart": For trends over time (e.g., velocity over the season).
- "scatter_plot": For correlating two numeric values (e.g., exit velo vs launch angle).
- "histogram": For distribution of a single numeric value.
- "table_only": When a table is the best representation (e.g., detailed game logs).

Respond with ONLY a JSON object (no markdown, no explanation):
{
    "type": "chart_type",
    "title": "Chart Title",
    "xAxis": "column_name_for_x",
    "yAxis": "column_name_for_y",
    "colorBy": "optional_column_for_color_coding",
    "description": "One sentence explaining what the visualization shows"
}`,
            messages: [
                {
                    role: "user",
                    content: `Question: ${userQuestion}\n\nSQL Query: ${sqlQuery}\n\nResult Columns: ${JSON.stringify(columns)}\n\nSample Data (first 3 rows): ${JSON.stringify(sampleRows.slice(0, 3))}`
                }
            ]
        })
    });

    const data = await response.json();
    let text = data.content[0].text.trim();
    text = text.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();

    return JSON.parse(text);
}
```

### File: `frontend/src/lib/supabase.js`

```javascript
import { createClient } from "@supabase/supabase-js";

// These are public (anon) keys — safe to expose in frontend code.
// Row Level Security (RLS) on Supabase controls access.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Execute a raw SQL query against Supabase using the rpc function.
 * Requires a database function to be created in Supabase (see below).
 */
export async function executeQuery(sql) {
    const { data, error } = await supabase.rpc("execute_sql", {
        query_text: sql
    });

    if (error) throw error;
    return data;
}
```

### Supabase Database Function for Raw SQL Execution

You need to create this function in Supabase's SQL Editor so the frontend can execute AI-generated queries safely. This is a read-only function to prevent any data modification from the frontend.

```sql
-- This function allows the frontend to execute read-only SQL queries.
-- It only permits SELECT statements for safety.
CREATE OR REPLACE FUNCTION execute_sql(query_text TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSON;
BEGIN
    -- Safety check: only allow SELECT statements
    IF NOT (LOWER(TRIM(query_text)) LIKE 'select%') THEN
        RAISE EXCEPTION 'Only SELECT queries are allowed';
    END IF;

    -- Additional safety: block dangerous keywords
    IF query_text ILIKE '%insert%' OR
       query_text ILIKE '%update%' OR
       query_text ILIKE '%delete%' OR
       query_text ILIKE '%drop%' OR
       query_text ILIKE '%alter%' OR
       query_text ILIKE '%create%' OR
       query_text ILIKE '%truncate%' THEN
        RAISE EXCEPTION 'Query contains forbidden keywords';
    END IF;

    EXECUTE 'SELECT json_agg(row_to_json(t)) FROM (' || query_text || ') t'
    INTO result;

    RETURN COALESCE(result, '[]'::json);
END;
$$;
```

### File: `frontend/src/App.jsx`

```jsx
/**
 * Main App Component
 * 
 * Flow:
 * 1. User types a natural language question
 * 2. AI generates SQL from the question
 * 3. SQL is executed against Supabase
 * 4. AI determines the best visualization type
 * 5. Results are displayed as a table + dynamic visualization
 * 
 * Build out each component in the components/ folder.
 * This file shows the overall data flow and state management.
 */

import { useState } from "react";
import { executeQuery } from "./lib/supabase";
import { generateSQL, determineVisualization } from "./lib/aiQueryEngine";
import { SCHEMA_CONTEXT } from "./lib/schemaContext";

// Import your components
// import QueryInput from "./components/QueryInput";
// import SQLDisplay from "./components/SQLDisplay";
// import ResultsTable from "./components/ResultsTable";
// import VisualizationEngine from "./components/VisualizationEngine";

export default function App() {
    const [query, setQuery] = useState("");
    const [sqlQuery, setSqlQuery] = useState("");
    const [results, setResults] = useState(null);
    const [vizConfig, setVizConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // User provides their own API key (stored in state, never sent to your server)
    const [apiKey, setApiKey] = useState("");

    async function handleSubmit(userQuestion) {
        setLoading(true);
        setError(null);
        setSqlQuery("");
        setResults(null);
        setVizConfig(null);

        try {
            // Step 1: Generate SQL from natural language
            const sql = await generateSQL(userQuestion, apiKey, SCHEMA_CONTEXT);
            setSqlQuery(sql);

            // Step 2: Execute the SQL query against Supabase
            const data = await executeQuery(sql);
            setResults(data);

            // Step 3: Determine best visualization
            if (data && data.length > 0) {
                const columns = Object.keys(data[0]);
                const viz = await determineVisualization(
                    userQuestion, sql, columns, data, apiKey
                );
                setVizConfig(viz);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="app">
            <h1>Statcast AI Query Engine</h1>
            <p>Ask any question about MLB pitch data in plain English.</p>

            {/* API Key input — user brings their own key */}
            {/* <ApiKeyInput value={apiKey} onChange={setApiKey} /> */}

            {/* Natural language query input */}
            {/* <QueryInput onSubmit={handleSubmit} loading={loading} /> */}

            {/* Show the generated SQL */}
            {/* {sqlQuery && <SQLDisplay sql={sqlQuery} />} */}

            {/* Error display */}
            {/* {error && <ErrorDisplay message={error} />} */}

            {/* Results table */}
            {/* {results && <ResultsTable data={results} />} */}

            {/* Dynamic visualization */}
            {/* {vizConfig && results && <VisualizationEngine config={vizConfig} data={results} />} */}

            {/*
                TODO: Build out each component above.
                The VisualizationEngine should switch on vizConfig.type:
                - "spray_chart" → render SprayChart component (SVG baseball diamond + plotted points)
                - "strike_zone" → render StrikeZone component (heatmap over zone grid)
                - "bar_chart" → render using Recharts BarChart
                - "line_chart" → render using Recharts LineChart
                - "scatter_plot" → render using Recharts ScatterChart
                - "histogram" → render using Recharts BarChart with binned data
                - "table_only" → render just the ResultsTable
            */}
        </div>
    );
}
```

---

## Phase 5: GitHub Pages Deployment

### File: `vite.config.js`

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    base: "/statcast-ai/",  // Replace with your repo name
    root: "frontend",
    build: {
        outDir: "../dist"
    }
});
```

### File: `.github/workflows/deploy.yml`

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          cd frontend
          npm install

      - name: Build
        run: |
          cd frontend
          npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

      - name: Deploy to GitHub Pages
        uses: actions/deploy-pages@v4
```

---

## Supabase Setup Checklist

Complete these steps in order in the Supabase dashboard:

1. **Create a project** at https://supabase.com — choose Free tier, pick a region close to you, set a strong database password.
2. **Go to SQL Editor** (left sidebar) and run the `CREATE TABLE` statements from Phase 1 above (pitches, players, data_refresh_log).
3. **Run the `execute_sql` function** from Phase 4 in the SQL Editor.
4. **Get your keys** from Settings → API:
   - `Project URL` → this is your SUPABASE_URL
   - `anon/public` key → this is your SUPABASE_ANON_KEY (safe for frontend)
   - `service_role` key → this is your SUPABASE_SERVICE_ROLE_KEY (for the Python pipeline only — NEVER expose in frontend)
5. **Configure Row Level Security (RLS):** Go to Authentication → Policies and enable RLS on the pitches table. Add a policy that allows anonymous SELECT access:

```sql
-- Enable RLS
ALTER TABLE pitches ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_refresh_log ENABLE ROW LEVEL SECURITY;

-- Allow public read access (anyone can query, nobody can modify from frontend)
CREATE POLICY "Allow public read access on pitches"
    ON pitches FOR SELECT
    USING (true);

CREATE POLICY "Allow public read access on players"
    ON players FOR SELECT
    USING (true);

CREATE POLICY "Allow public read access on data_refresh_log"
    ON data_refresh_log FOR SELECT
    USING (true);
```

6. **Add secrets to GitHub repo:** Go to your GitHub repo → Settings → Secrets and variables → Actions. Add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

---

## Build Order (What to Do in Cursor)

Follow this order for the most efficient build:

1. **Set up the repo structure** — create folders: `data_pipeline/`, `frontend/`, `.github/workflows/`
2. **Set up Supabase** — create project, run all SQL (tables + function + RLS policies)
3. **Build and test the data pipeline** — install pybaseball, run the historical load locally first for a small date range (e.g., one week) to verify data flows correctly
4. **Run the full 2025 historical load** — this will take a while, let it run
5. **Run a refresh for 2026 data** — test the refresh mode
6. **Set up the GitHub Action** for weekly refresh
7. **Build the frontend** — start with QueryInput + SQL generation, then add ResultsTable, then build visualization components one at a time
8. **Deploy to GitHub Pages**

---

## Example Queries the App Should Handle

Test your app with these natural language questions:

- "Show me all home runs hit by Aaron Judge in 2025"
- "What is the average exit velocity by pitch type for the Yankees?"
- "Show me Shohei Ohtani's spray chart for the 2025 season"
- "Which pitchers throw the hardest fastballs?"
- "Plot the strike zone for all called strikes against left-handed batters"
- "What's the average launch angle for home runs vs fly outs?"
- "Show me barrel rate by team in 2025"
- "How has Gerrit Cole's fastball velocity trended over the 2025 season?"
- "Which batters have the most batted balls over 110 mph?"
- "Show me the pitch mix breakdown for Spencer Strider"
