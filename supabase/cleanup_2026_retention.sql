-- One-time cleanup (July 2026): shrink the database to fit Supabase's free tier
-- and switch to the rolling two-season retention model:
--   current season  = every pitch
--   previous season = outcome pitches only (events IS NOT NULL)
--   older seasons   = deleted (enforced weekly by pull_statcast.py prune_old_seasons)
--
-- Run this whole file in the Supabase SQL Editor, then reload the data locally:
--   cd data_pipeline
--   python pull_statcast.py --mode historical --start 2025-03-18 --end 2025-11-02 --events-only
--   python pull_statcast.py --mode historical --start 2026-03-10 --end <today>
--
-- TRUNCATE (unlike DELETE) returns disk to the OS immediately, which matters here
-- because the disk is currently full; the pitches data is fully reloadable from
-- Baseball Savant. The players table is kept — it is small and still valid.

-- The project is in read-only mode (over free-tier limits). These two lines
-- override it for this session/transaction so the space-freeing commands below
-- can run; Supabase lifts read-only mode once usage drops back under the limit.
SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE;
SET TRANSACTION READ WRITE;

TRUNCATE pitches;
TRUNCATE data_refresh_log;

-- Redundant or low-value indexes (~133 MB at July 2026 sizes):
DROP INDEX IF EXISTS idx_pitches_game_pk;       -- covered by unique (game_pk, at_bat_number, pitch_number)
DROP INDEX IF EXISTS idx_pitches_batter;        -- covered by idx_pitches_batter_date
DROP INDEX IF EXISTS idx_pitches_pitcher;       -- covered by idx_pitches_pitcher_date
DROP INDEX IF EXISTS idx_pitches_launch_speed;  -- 32 MB for occasional top-N queries; seq scan fits the 60s cap
DROP INDEX IF EXISTS idx_pitches_launch_angle;  -- same
DROP INDEX IF EXISTS idx_pitches_bb_type;       -- low cardinality, rarely selective
DROP INDEX IF EXISTS idx_pitches_year_team;     -- covered by idx_pitches_game_year + idx_pitches_home_team

-- Columns the app's AI query generator has never been told about (schemaContext.js),
-- ~26% of the table. The pipeline no longer pulls them.
ALTER TABLE pitches
  DROP COLUMN IF EXISTS release_pos_x,
  DROP COLUMN IF EXISTS release_pos_y,
  DROP COLUMN IF EXISTS release_pos_z,
  DROP COLUMN IF EXISTS vx0,
  DROP COLUMN IF EXISTS vy0,
  DROP COLUMN IF EXISTS vz0,
  DROP COLUMN IF EXISTS ax,
  DROP COLUMN IF EXISTS ay,
  DROP COLUMN IF EXISTS az,
  DROP COLUMN IF EXISTS fielder_2,
  DROP COLUMN IF EXISTS fielder_3,
  DROP COLUMN IF EXISTS fielder_4,
  DROP COLUMN IF EXISTS fielder_5,
  DROP COLUMN IF EXISTS fielder_6,
  DROP COLUMN IF EXISTS fielder_7,
  DROP COLUMN IF EXISTS fielder_8,
  DROP COLUMN IF EXISTS fielder_9,
  DROP COLUMN IF EXISTS fld_score,
  DROP COLUMN IF EXISTS post_home_score,
  DROP COLUMN IF EXISTS post_away_score,
  DROP COLUMN IF EXISTS woba_denom,
  DROP COLUMN IF EXISTS sv_id;
