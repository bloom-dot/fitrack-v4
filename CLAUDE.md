# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Single-file PWA: **`index.html`** (~5000 lines) contains all HTML, CSS (inline `<style>`), and JS (inline `<script>`). No framework, no bundler. The `js/` and `css/` directories are empty — everything is inlined.

**Backend:** Vercel serverless functions in `api/` + Supabase PostgreSQL with RLS.

**Key components inside index.html:**
- `DB.g(key, default)` / `DB.s(key, val)` — localStorage wrapper, prefix `ft3_`
- `EX_DB[]` — exercise library array, each entry has `{name, muscle, cat, level, equip, ...}`
- `sessions[]`, `prs{}` — workout history and personal records (localStorage + Supabase sync)
- Screen navigation via `goTo('screenId')` toggling `.screen` divs
- Exercise blocks: `addExBlock(name, muscle, sugWeight, sugReps, nbSets, cat)` — `cat:'Cardio'` triggers different input fields (min/km vs kg/reps)

**API endpoints (`api/`):**
- `chat.js` — Mistral AI proxy (Bearer auth + daily quota via `ai_usage` table)
- `cron-weighing.js` — daily 7am UTC push reminder (Vercel cron)
- `push-subscribe.js` / `send-push.js` — Web Push notifications
- `delete-account.js` — GDPR account deletion
- `challenges.js` — weekly challenge management

## Deploy

```bash
# Deploy to Vercel production (project: myfitrack/fitrack)
cd C:\Users\ferna\Downloads\fitrack
vercel --prod --yes
```

Production URL: `https://fitrack-swart.vercel.app`

A PostToolUse hook in `.claude/settings.json` auto-deploys on Edit/Write to fitrack files (async).

## Validation

```bash
# Validate JS syntax after editing index.html
node -e "var fs=require('fs');var src=fs.readFileSync('index.html','utf8');var m=src.match(/<script>([\s\S]*?)<\/script>/g);var js=m?m.map(function(s){return s.replace(/<\/?script>/g,'');}).join('\n'):'';new Function(js);console.log('OK');"
```

No test suite, no linter. Always run the syntax check above after editing index.html.

## Environment Variables (Vercel)

`MISTRAL_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`

Client-side Supabase anon key and VAPID public key are intentionally in `index.html` (protected by RLS / public by design).

## Conventions

- **Language:** All UI text, variable names in UI strings, and comments are in French.
- **CSS:** All styles are in `<style>` blocks at the top of index.html. CSS variables defined on `:root` (`--bg`, `--acc`, `--s1`, `--s2`, `--border`, `--text`, `--t2`, `--r`, `--r-sm`, `--nav`, `--safe`).
- **JS style:** `var` declarations (no `let`/`const`), function declarations, no arrow functions — ES5 compatibility for older mobile browsers.
- **iOS compatibility:** No `inset:0` (use `top:0;right:0;bottom:0;left:0`), no `screen.orientation.lock()` (use matchMedia overlay instead), speechSynthesis requires user gesture unlock.
- **Global CSS classes:** `.btn-primary` and `.btn-outline` have `width:100%` — override inline with `width:auto` or use plain inline styles in flex contexts to avoid overflow on mobile.

## Database (Supabase)

Schema in `supabase/schema.sql`. Key tables: `profiles`, `sessions`, `personal_records`, `weigh_ins`, `ai_usage`, `push_subscriptions`. All tables use RLS tied to `auth.uid()`.

## PWA

`manifest.json` + `sw.js` (service worker with offline caching). Orientation locked to portrait via matchMedia overlay (iOS) + `screen.orientation.lock()` (Android).
