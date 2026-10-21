# Daily Task Tracker

A minimal, fast daily task tracker: plan each day, start a timer on a task, tick it off, and see how long it actually took versus the estimate. Data syncs across devices via Supabase (Auth, Postgres, Realtime).

**Stack:** Vite · React 18 · TypeScript · @supabase/supabase-js v2 · plain CSS (claymorphism, monochrome light/dark)

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Pick a name/region and save the database password.
3. Open **Project Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **Publishable/anon key** → `SUPABASE_ANON_KEY`

Never use the `service_role` key in this app (or any client code). Never commit it or any SMTP credentials — the only secrets file is `.env`, which is gitignored.

## 2. Enable Email auth

1. **Authentication → Providers → Email**: enable it and keep **Confirm email** switched ON. Email confirmation is required before the first sign-in.

## 3. Configure Gmail SMTP (custom email sender)

Supabase’s built-in email service is rate-limited and lands in spam. For this app, use a dedicated Gmail account with an **App Password**:

1. On the Gmail account, enable **2-Step Verification** (myaccount.google.com → Security), then create a 16-character **App Password** at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). *Never use the normal Google password.*
2. In Supabase: **Authentication → Emails → SMTP Settings**:
   - Host: `smtp.gmail.com`
   - Port: `465` (SSL) or `587` (STARTTLS)
   - Username: the full Gmail address
   - Password: the 16-character App Password
   - Sender email: the same Gmail address
   - Sender name: `Daily Task Tracker`
3. Customise the **confirmation**, **magic link** and **reset password** email templates (Authentication → Emails → Email Templates) with short, plain wording and one clear button.

**Limits:** Gmail SMTP allows roughly 500 emails/day and may land in spam — fine for testing and small apps. For production on a business domain, use Resend, Brevo or Postmark with SPF + DKIM configured.

**If the App Password is ever exposed:** revoke it at the App Passwords page and create a new one, then update the Supabase SMTP settings.

## 4. Redirect URLs

**Authentication → URL Configuration**:

- **Site URL**: your production URL (e.g. `https://your-app.vercel.app`)
- **Redirect URLs**: add `http://localhost:5173` (local dev) and your production URL

The app sets `emailRedirectTo` to `window.location.origin`, so verification/reset links always return to the environment that requested them.

## 5. Run the database migration

Open **SQL Editor** in Supabase and run the contents of [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql). It creates:

- `public.tasks` table (with the exact schema, indexes and RLS policies)
- `set_updated_at` trigger
- realtime publication for `tasks`
- atomic timer RPCs: `start_timer`, `pause_timer`, `complete_task` (security invoker — caller’s RLS applies)

Or with the Supabase CLI: `supabase link --project-ref <ref> && supabase db push`.

## 6. Environment variables

```bash
cp .env.example .env
```

Fill `.env` with your project’s values (only these two):

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

## 7. Local development

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
npm run lint
```

## 8. Deploy to Vercel

1. Push the repo to GitHub.
2. In Vercel: **Add New Project** → import the repo (Vite is auto-detected).
3. Add the same two env vars (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) under **Settings → Environment Variables**.
4. Deploy, then add the production URL to Supabase **Redirect URLs** and set it as the **Site URL**.

Netlify works the same way (build command `npm run build`, publish directory `dist`).

## 9. GitHub pull request integration

Each user can connect their own GitHub **fine-grained personal access token** and see their pull
requests (authored, review requested, reviewed, assigned) inside the app. Tokens are handled like
passwords:

- The browser sends the token **once**, over HTTPS, to a Supabase Edge Function. It is never
  stored in localStorage/cookies/URLs and **never returned to the browser** — the client only ever
  sees the GitHub username, the last 4 characters, the expiry and the connection status.
- Edge Functions encrypt it with **AES-256-GCM** (random 12-byte IV per token) using the
  `GITHUB_TOKEN_ENC_KEY` secret and store only the ciphertext in `github_secrets`, which has RLS
  enabled with **no client policies** (service role only).
- Every GitHub API call happens **inside Edge Functions**. All functions verify the caller's
  Supabase JWT and derive `user_id` from it, never from the request body. CORS is restricted to
  your app origins via `APP_ORIGINS`.
- **Disconnect** (and deleting the auth user — everything cascades from `auth.users`) removes the
  encrypted token and all cached PR data immediately.

### 9.1 Create a fine-grained token

1. GitHub → **Settings → Developer settings → Fine-grained tokens → Create new token**:
   https://github.com/settings/personal-access-tokens/new
2. Grant **read-only** access to: **Pull requests: Read** and **Metadata: Read**.
   Do **not** grant write or admin permissions.
3. Choose only the repositories you want to see (a fine-grained token covers one owner — your
   account or a single organization). Organizations may require an owner to approve the token.
4. Only tokens starting with `github_pat_` are accepted; classic tokens (`ghp_…`) are rejected
   with a clear message.

### 9.2 Deploy the Edge Functions

```bash
supabase functions deploy github-connect github-sync github-disconnect
openssl rand -base64 32   # generate the encryption key…
supabase secrets set GITHUB_TOKEN_ENC_KEY=<32-byte base64 key>
```

Optional but recommended — restrict browser origins (comma-separated; wildcards like
`https://*.vercel.app` are supported). Defaults to localhost:5173/4173 plus `https://*.vercel.app`:

```bash
supabase secrets set APP_ORIGINS=https://your-app.vercel.app,http://localhost:5173
```

Run [`supabase/migrations/002_github.sql`](supabase/migrations/002_github.sql) (SQL editor or
`supabase db push`) before using the feature.

### 9.3 How sync works (and the 1000-result limit)

- A **full sync** runs right after connecting (with a live progress indicator), fetching the four
  roles (`author:`, `review-requested:`, `reviewed-by:`, `assignee:`) via the GitHub Search API.
- The Search API caps each query at **1000 results**. For full syncs, queries that exceed the cap
  are split into `created:` date windows by recursive bisection until every window returns ≤1000
  results, so even very large histories are fetched completely. Search results don't include
  merged state, so closed PRs are re-fetched individually (5 at a time) to read `merged_at`.
- An **incremental sync** (`updated:>=last_synced_at`, with a 2-day buffer) runs automatically
  every 10 minutes while the app is open, plus on demand via **Sync now**. Results are upserted by
  `(user_id, gh_pr_id, role)`, so re-running a sync never creates duplicates.
- The Search API allows ~30 requests/minute: calls are throttled (~2.2s apart), and 403/429
  responses back off and surface "GitHub is rate limiting requests, retry at HH:MM" while the
  connection is marked `rate_limited`. A 401 marks it `invalid`; an expired token marks it
  `expired` — both prompt a reconnect with a fresh token.

### 9.4 Troubleshooting

- **Empty PR list**: run a Sync now; check the token's repository selection includes the repos you
  expect; confirm the connection status isn't expired/invalid.
- **403 / "Resource not accessible"**: the token may need organization approval, or it may not
  include the selected repositories. Ask an org owner to approve it, or narrow/re-create the token.
- **"Token expired"**: fine-grained tokens have an expiry — create a new one and reconnect
  (Settings → GitHub → Disconnect, then connect again).
- **Rate limited**: wait until the shown retry time and press Sync now.
- **Functions fail with 400 "Missing encryption key" style errors**: set
  `GITHUB_TOKEN_ENC_KEY` (see 9.2) and redeploy the functions.


---

## How it works

- **Auth**: email+password sign up/in, magic link, resend verification (30s cooldown), forgot/reset password. The session is handled via `onAuthStateChange` (no polling). All data is behind auth + Postgres RLS.
- **Dates**: `task_date` is a local calendar date (`YYYY-MM-DD`); timers use UTC timestamps (`timer_started_at`), so elapsed time is `spent_seconds + (now − timer_started_at)`.
- **Timers**: start/pause/complete go through Postgres RPCs so only one timer can run per user (enforced by a unique partial index). The clock is recomputed from `timer_started_at` every second — it survives reloads and works across devices.
- **Realtime**: changes to `public.tasks` stream to every signed-in device via Supabase Realtime.
- **Optimistic UI**: mutations update the list instantly, roll back with a visible error toast on failure, then reconcile with the server.

### Keyboard shortcuts

- `N` — focus the add-task input
- `Space` — start/pause the focused task's timer button (native button behaviour)

---

## Test checklist

### Auth
- [ ] Sign up with a new email → "Check your email" screen shows the address
- [ ] Confirmation email arrives → click the link → "Email verified" screen → lands signed in
- [ ] Sign in **before** verifying is blocked, with a clear message and a working **Resend** button
- [ ] Resend button disables with a visible 30-second countdown
- [ ] Clicking the verification link a second time (or an expired link) shows "expired or already used"
- [ ] Wrong password shows a clear error (not a stack trace)
- [ ] Signing up with an existing email is reported as already registered
- [ ] Spamming resend/sign-up shows "Too many emails requested. Try again in a minute."
- [ ] Forgot password → reset email → set-new-password screen → sign in with the new password

### Tasks & timers
- [ ] Add a task with Enter; estimate is optional
- [ ] Timer keeps running after a full page reload
- [ ] Starting a timer on task B pauses task A and banks its elapsed time
- [ ] Completing a task stops its timer and keeps the spent time
- [ ] "Over estimate" chip and progress bar appear once elapsed > estimate
- [ ] Day summary shows "N of M done", total tracked and total estimated
- [ ] Delete shows an undo toast; Undo restores the task
- [ ] "Move unfinished to tomorrow" moves undone tasks and switches to tomorrow

### Multi-user & sync
- [ ] RLS: user A cannot read or modify user B's tasks (try a REST call with A's token against B's task id → empty/denied)
- [ ] Realtime: two tabs (or two devices) show adds/edits/completions without refresh
- [ ] Only one timer runs across devices (unique index holds)

### UI
- [ ] Week strip fill level matches completion percentage per day
- [ ] Prev/next day arrows and "Jump to today" work
- [ ] Dark mode toggle persists (localStorage) and follows system by default
- [ ] Layout works down to 360px width; keyboard focus ring is visible everywhere

### GitHub integration
- [ ] Invalid token shows "does not look valid"; classic `ghp_…` tokens are rejected with a clear message
- [ ] Expired token (or a token that expires mid-connection) shows the correct reconnect message
- [ ] After submitting, the token never appears in network responses, localStorage, sessionStorage, cookies or console logs — only username, last 4, expiry and status are visible
- [ ] RLS: user A cannot read user B's connections or PRs; no client can read `github_secrets`
- [ ] A user with more than 1000 PRs still gets a full history (date-window splitting)
- [ ] Rate-limit handling shows "retry at HH:MM" and the connection is marked rate limited; Sync now retries it
- [ ] Disconnect removes the encrypted token and all cached PRs (PR list empties; tasks added from PRs remain)
- [ ] "Add to today" creates a task titled `repo#123 title` with a PR link icon; the timer works on it
- [ ] Full sync runs automatically after connecting and shows live progress ("Fetched N pull requests…")
- [ ] Incremental sync runs every ~10 minutes while the app is open; "Last synced …" label updates
- [ ] Realtime: PRs synced on one device appear on another without a refresh
- [ ] GitHub activity section on a date lists PRs created/merged/updated that day with "Add as task"
