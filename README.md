# MLB Statcast AI Query Engine

Natural-language queries over Statcast pitch data in Supabase, with charts and tables in the browser.

## Live site (GitHub Pages)

After deployment: **https://angelozorn.github.io/mlb_query_project/**

### One-time GitHub setup

1. **Enable Pages**  
   Repo → **Settings** → **Pages** → **Build and deployment** → Source: **GitHub Actions**  
   (If this is not set, the deploy workflow’s `deploy` job fails even when the build succeeds.)

2. **Actions secrets** (Settings → Secrets and variables → Actions)  
   | Secret | Value |
   |--------|--------|
   | `SUPABASE_URL` | Project URL from Supabase |
   | `SUPABASE_ANON_KEY` | **anon / public** key only |

   Do **not** add `SUPABASE_SERVICE_ROLE_KEY` here. That key is for the Python pipeline only and must never be baked into the static site.

3. **Deploy**  
   Push to `main`, or run **Actions** → **Deploy to GitHub Pages** → **Run workflow**.

The built site embeds only the **anon** Supabase key (expected for a public client). Protect data with Supabase **RLS**. Users enter their own **Claude API key** in the UI (stored in browser `localStorage`, not in the repo).

### Local development

```bash
cd frontend
cp .env.example .env   # fill in VITE_* values; never commit .env
npm install
npm run dev
```

Open **http://localhost:5173/** (local base path is `/`, not the GitHub Pages subpath).

## Data pipeline

See `data_pipeline/` and `data_pipeline/.env` (gitignored). Use `SUPABASE_SERVICE_ROLE_KEY` only in that `.env` file, never in the frontend or GitHub Pages secrets.
