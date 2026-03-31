# Riseloop Studio

Riseloop Studio is a personal systems app for people who want to run their day by windows, not by vague intention.

It is designed for habit-heavy lives where timing matters:
- health routines
- deep work blocks
- professional practice
- recovery habits
- repeated daily rituals

Instead of showing everything at once, Riseloop reveals the day window by window, lets you log progress quickly, and keeps your master system editable from the UI itself.

## What Makes It Different

Riseloop is built around a few core ideas:
- goals matter less than systems
- daily life works better when habits have a time context
- progress should be visible without becoming noisy
- the app should adapt to the user, not the other way around

That means the app is intentionally opinionated in a few places:
- future windows stay hidden until they start
- past and active windows remain visible
- habits can repeat across multiple windows while still sharing one underlying daily entry
- measurable habits can use a persistent focus timer
- the master habit list is editable and collapsible inside the app

## Current Product Shape

This repo currently contains a browser-first app with a Google Sheets backend and a local fallback mode.

The main experience is:
- a bright, calm daily board
- a Master Habit Studio for defining habits
- a Google Sheets-backed storage model
- window-based grouping for the daily flow
- focus timers for time-based measurable habits
- repeated appearances of the same habit across multiple windows
- a separate reports page for trends, analysis, and insights

The app title and UI are branded as `Riseloop Studio`.

## Core Features

### Daily Board
- Habits are grouped by time window.
- Windows are collapsible and start collapsed on refresh.
- Only active and past windows appear on the board for today.
- Future-day tracking is locked.
- Each window shows a summary directly on the collapsed window card.

Window summary includes:
- one merged habit-progress box showing total, done, and pending
- targeted time
- unplanned time
- time logged
- unlogged so far or unused after close
- elapsed time bar

### Master Habit Studio
- Create new habits from the UI.
- Edit existing habits from the UI.
- Change name, category, type, target, unit, active days, notes, window, and repetition windows.
- Repetition windows are chosen from valid existing windows in the system.
- The master list is collapsible so the daily board stays primary.

### Habit Types
- `Checkbox`: done or not done
- `Measurable`: supports numeric progress toward a target

Examples of measurable habits:
- minutes
- hours
- pages
- liters
- reps

### Repetition Windows
A single habit can appear in more than one window without becoming a different habit.

Example:
- `Afternoon recovery walk` in `1:00 PM - 2:00 PM`
- the same habit again in `7:01 PM - 10:00 PM`

Important behavior:
- the habit keeps one unique id
- score is shared
- the daily total is shared
- focus-timer progress is shared
- repeated appearances are labeled like `Rep 1 of 3`, `Rep 2 of 3`, `Rep 3 of 3`
- per-window logged allocations are now saved with each day entry

### Focus Timer
Time-based measurable habits can show a habit-level focus timer.

Current behavior:
- starts from `0`
- works like a persistent stopwatch, not a countdown
- every `Pause` adds the elapsed session to the habit's logged value
- survives refresh, browser close, app reopen, and system restart through local persistence
- pause/save writes the repeated-window allocation back into the day entry
- shows a small progress bar against the habit target

The timer is available for measurable habits with time units such as:
- `sec`, `second`, `seconds`
- `min`, `mins`, `minute`, `minutes`
- `hr`, `hrs`, `hour`, `hours`

### Progress and Score
Score is based on visible habits for the selected day context.

Current logic:
- checkbox habit marked done: full credit
- measurable habit at or above target: full credit
- measurable habit below target: partial credit proportional to target
- measurable habit at `0`: zero credit

Example:
- target = `30 min`
- logged = `20 min`
- score contribution = `20 / 30`

There is no skip concept in the current product direction.

### Visual State Design
The board uses soft color states to make the day easy to read:
- done
- not done and window over
- not done but window still active

This helps distinguish:
- completed work
- missed work
- still-open work

## Backend

### Google Sheets Backend
The current main backend uses Google Sheets.

It creates and uses these tabs:
- `StudioHabits`
- `StudioEntries`

`StudioHabits` stores:
- habit id
- name
- category
- type
- unit
- target
- primary window start
- primary window end
- active days
- notes
- createdAt
- updatedAt
- repeatWindows
- repeatWindowTargets

`StudioEntries` stores:
- entry id
- habit id
- date key
- status
- value
- note
- updatedAt
- windowAllocations for repeated measurable habits

### Local Fallback
If Google Sheets is not connected, the app can still work from local browser storage.

Local storage is also used for:
- timer persistence
- temporary migration fallback for older repeated-window allocations that have not been re-saved yet

### Important Delete Behavior
Deleting a habit removes:
- the habit itself
- all day entries linked to that habit id

This is intentional right now.

So:
- edit a habit if you want to preserve its history
- create a new habit if you want a clean break

## Editing vs Replacing Habits

### Safe Edits
These are safe and keep the same habit id:
- name
- category
- notes
- active days
- target tuning
- primary window
- repetition windows

### When a New Habit Is Better
Create a new habit instead of editing the old one when the meaning changes substantially.

Examples:
- changing a checkbox habit into a measurable habit
- changing the unit from `minutes` to something unrelated
- repurposing a habit into a completely different behavior

The app can technically handle some of these changes, but the history may stop making intuitive sense.

## Who This App Is For

Riseloop can already be personalized for many types of users, not just one lifestyle.

Examples:
- doctors
- actors
- lawyers
- founders
- students
- writers
- athletes
- creators
- anyone who wants a timed daily operating system

You can personalize:
- habit names
- categories
- targets
- units
- active days
- windows
- repeated appearances

So yes, it is already generic enough to be adapted for very different professions and routines.

What it is not yet:
- multi-user
- team collaboration
- role-based permissions
- domain-specific workflows like patient management, case tracking, or rehearsal scheduling

It is best understood today as a flexible personal systems platform.

## How the Day View Works

For the currently selected day:
- the app loads all habits active for that day
- groups them by window
- hides future windows for today
- shows all windows for past days
- locks future dates

This keeps the day view focused and prevents the user from being overloaded by everything at once.

## How to Run Locally

From the project folder:

```powershell
cd C:\SpaceS\Riseloop
py -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html
```

If `py` does not work on your machine, try:

```powershell
python -m http.server 8000
```

Keep the terminal open while using the app.

## First 10 Minutes Setup

If you found this repo on GitHub and want to get to a working app quickly, use this path:

### 1. Download or Clone
Get the repo onto your machine and open the project folder.

### 2. Create Your Local Config
Copy:

`system_habits_config.example.js`

to:

`system_habits_config.local.js`

Then fill in your own Google values:
- `apiKey`
- `spreadsheetId`
- `clientId`
- `scopes`

### 3. Prepare Google Sheets
Create or choose a Google Sheet for your own system.

The app will create these tabs when you connect:
- `StudioHabits`
- `StudioEntries`

### 4. Prepare Google Cloud
In Google Cloud:
- enable the Google Sheets API
- configure the OAuth consent screen
- create an OAuth Web Client
- create an API key
- add `http://localhost:8000` as an authorized JavaScript origin

### 5. Run the App Locally
From the project folder:

```powershell
cd C:\SpaceS\Riseloop
py -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html
```

### 6. Connect Google Sheets
Inside the app:
- click `Connect Google Sheets`
- allow Google authorization
- click `Sync now` if needed

### 7. Build Your First System
In Master Habit Studio, add:
- a few categories
- a few time windows
- 3 to 5 starter habits
- measurable targets where needed

### 8. Log a Real Day
Use the daily board to:
- mark checkbox habits done
- log measurable habits
- try the focus timer for time-based habits
- open `Reports` after a few days of data

If something does not connect on the first try, the most common cause is opening the app from `file://` instead of `http://localhost`.

## Why `http://localhost` Matters

Google OAuth does not work correctly from `file://` mode.

Use `http://localhost` when you want:
- Google sign-in
- Google Sheets sync
- a stable browser origin for the app

If you open the HTML file directly from disk, some local data behaviors may differ because browser storage origins are different.

## Google Sheets Setup

### 1. Create a Google Cloud Project
- enable the Google Sheets API
- configure the OAuth consent screen
- create an OAuth 2.0 Web Client
- create an API key

### 2. Add Authorized Origins
For local development, add:

```text
http://localhost:8000
```

If you use a different local port, add that instead.

### 3. Add Local Config
Copy:

`system_habits_config.example.js`

to:

`system_habits_config.local.js`

Then fill:
- `apiKey`
- `spreadsheetId`
- `clientId`
- `scopes`

Example:

```js
window.SystemHabitsConfig = {
  apiKey: "YOUR_GOOGLE_API_KEY",
  spreadsheetId: "YOUR_GOOGLE_SHEET_ID",
  clientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID",
  scopes: "https://www.googleapis.com/auth/spreadsheets"
};
```

### 4. Connect the App
- start the app locally
- click `Connect Google Sheets`
- allow authorization
- click `Sync now` if needed

The app will create the required tabs if they do not exist.

## Personalizing the App

### Basic Personalization
Use Master Habit Studio to define:
- your categories
- your windows
- your measurable units
- your daily targets
- your active days
- your repetitions

### Good Personalization Patterns

For health:
- `Morning walk`
- `Post meal walk`
- `Guided breathing`
- `Leg mobility drill`

For professional practice:
- `Case law reading`
- `Scene study`
- `Patient follow-up review`
- `Skill practice`

For recovery and self-regulation:
- `News catch-up`
- `Meditation`
- `Stretching`
- `Hydration`

### Repetition Strategy
Use repetitions when:
- the same habit needs to appear more than once in the day
- you want the same score and logged value to follow the habit

Do not create separate habits if they are truly the same underlying behavior.

## Project Structure

```text
index.html
reports.html
system_habits_app.js
system_habits_backend.google.js
system_habits_backend.local.js
system_habits_config.example.js
system_habits_config.local.js
system_habits_reports.js
system_habits_shared.js
```

### Main Files
- `index.html`: main product UI and navigation to reports
- `reports.html`: the dedicated analytics and insights page
- `system_habits_app.js`: board rendering, timers, editor, scoring, daily behavior
- `system_habits_backend.google.js`: Google Sheets backend
- `system_habits_backend.local.js`: local fallback backend
- `system_habits_reports.js`: reports engine for charts, trends, correlations, and window intelligence
- `system_habits_shared.js`: shared config and older parsing helpers

## Reports Page

`reports.html` is now a first-class part of the product, backed by the same live data model as the daily board.

What is there now:
- daily, weekly, monthly, and yearly habit charts grouped by category
- overview cards for habits, categories, tracked days, 30-day score, windows, and logged time
- insight cards for momentum, reliability, growth pocket, best day rhythm, strongest category, and tradeoff watch
- positive correlations and negative or tradeoff correlations between habits
- window intelligence showing planned time, logged time, unlogged time, spare capacity, and target-hit behavior across the last 30 days

Important design choice:
- window intelligence still uses each habit's primary window only, so repeated appearances do not yet produce full per-window historical analytics
- correlations use recent daily progress patterns as signals, not proof of causation

This means:
- the reports page and the daily board stay aligned because they read the same `StudioHabits` and `StudioEntries` backend
- repeated-window allocations are now stored in day entries, but the reports layer still uses conservative primary-window analytics for window intelligence

## Privacy and Security Notes

This app is frontend-first, so the browser still receives the Google client configuration at runtime.

That means:
- do not commit real secrets carelessly
- keep `system_habits_config.local.js` out of version control
- restrict your Google API key by origin and API where possible

The repo already uses a local config pattern so public sharing is cleaner.

## Current Design Decisions

Some behaviors are intentional and product-driven:
- future windows are hidden
- windows are the main unit of the daily view
- the master list stays collapsible
- measurable habits default to `0`
- repeated appearances share one habit id and one daily entry
- repeated measurable habits persist their per-window allocations inside the entry data
- window cards summarize their own time and progress

## Roadmap Ideas

Possible next improvements:
- add better export or backup tools
- add non-destructive archive mode instead of hard delete
- add richer analytics for repeated habits
- add category filters and saved report views
- add custom ordering or priority within windows
- add deploy instructions for hosted use
- add multi-user support

## Public Repo Notes

If you publish this repo:
- include `system_habits_config.example.js`
- exclude `system_habits_config.local.js`
- document the Google setup clearly
- make it clear that the main supported page is `index.html`

## Philosophy

Riseloop is built around a simple belief:

You do not rise to the level of your goals. You fall to the level of your systems.

This app is meant to help people build those systems in a way that feels calm, visible, and personal.

