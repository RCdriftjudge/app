# RC Drift Judge

Web app for running RC drift competitions: driver registration, judged qualifying, tandem battles and a live display. It's built for phones at the track.

## Stack
- Vite + plain JavaScript. It's a PWA and the app shell works offline.
- Supabase: anonymous auth, Postgres with RLS, Realtime.
- Deployed to GitHub Pages by `.github/workflows/deploy-pages.yml`.

## How an event runs
1. **Director** creates the event (2 or 3 judges) and gets a judge code/QR, a driver registration code/QR, and a recovery PIN.
2. **Judges** scan the judge QR and are seated in join order. The same code joins a **Live Display**.
3. **Drivers** scan the registration QR. One phone can register several drivers. The director approves or rejects them, or adds walk-ups by hand.
4. **Qualifying:** the director steps through each driver's run 1, then each run 2. Every judge scores line, angle and style. A run counts once all judges have scored it. Drivers are ranked by their best run.
5. **Tandem:** the director builds a Top 2/4/8/16/32 bracket (1 v N, 2 v N-1 ...). Each battle is two runs, then the judges vote blind (A / B / One More Time).
   - A driver needs a strict majority of the panel to win: 2 of 3 judges, or both of 2. Anything else is an OMT.
   - The director can overrule a result until the next battle for those drivers has started.
6. The winner goes through, and the higher qualifier leads run 1. Every screen updates live.

Anyone can get back in on a new phone from **Rejoin**. Drivers and judges use their 2-character rejoin code; the director uses the PIN.

**Assumptions to check against SDC 2026 Rev. 10.4:**
- Score ranges are line 0-35, angle 0-30 and style 0-35 (`SCORE_LIMITS` in `src/views.js` and `submit_qualifying_score`).
- The majority rule for battles.
- No 3rd-place battle.

## Database
The schema lives in `supabase/migrations/`, and every write goes through the RPCs defined there.
- `20260927000000_base_schema.sql` is the original schema.
- `20260927010000_competition_flow.sql` does three things:
  - brings the repo in line with objects that had been created by hand in the dashboard
  - fixes the RLS issues
  - adds the qualifying, bracket and battle logic

**Deploying to the hosted project:** apply the migrations *before* the frontend deploys.

```bash
npx supabase link --project-ref qixvqudfrajdodkaazmm
npx supabase db push
```

`db push` records migration history. If the hosted database was built by pasting SQL, mark the base schema as already applied first: `npx supabase migration repair --status applied 20260927000000`.

The hosted project needs two dashboard settings:
- **Authentication → Sign In / Providers → Allow anonymous sign-ins** turned on.
- **Authentication → Rate Limits → anonymous sign-ins** raised well above the default 30/hour per IP. Every phone on the venue wifi shares one IP.

## Local development
Needs Node 20.19+ (`nvm use`) and Docker.

```bash
npm install
npm run db:start      # local Supabase in Docker
npm run env:local     # writes .env.local for the local stack
npm run dev
```

## Tests
- `npm run test:e2e` runs the UI tests with a mocked backend.
- `npm run test:db` runs a whole competition through the RPCs against local Supabase, including seats, blind judging, OMT, overrides, bracket seeding, rejoin and rate limiting.
- `npm run walkthrough` runs a recorded six-device end-to-end event against local Supabase. It writes `test-results/walkthrough/walkthrough.mp4` and needs ffmpeg.
- `npm run storybook` shows every screen in every state.

## Security
- `.env.local` is excluded from Git.
- Only the Supabase URL and the publishable key go in the frontend. Never commit a secret or service-role key.
