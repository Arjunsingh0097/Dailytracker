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
