# Riseloop Reports Handbook

This handbook explains the `Reports` page in Riseloop from top to bottom.

It is written for real usage, not just for developers. The goal is simple:

- help you understand what each report means
- help you interpret the numbers correctly
- help you know what the reports can and cannot tell you

---

## What The Reports Page Reads

The reports page reads the same live backend as the daily board:

- `StudioHabits`
- `StudioEntries`

That means the reports are built from your current master habit list plus your saved daily entries.

If you change habits, categories, targets, days, windows, or repetitions, the reports rebuild from that live state.

---

## Period Buttons

At the top of the reports page, you can switch between:

- `Daily`
- `Weekly`
- `Monthly`
- `Yearly`

These buttons affect:

- the category habit charts
- the window trend charts

Current report windows:

- `Daily`: last 14 days
- `Weekly`: last 12 weeks
- `Monthly`: last 12 months
- `Yearly`: last 5 years

Important:

- `Daily` does not mean “all daily history”
- it means the most recent 14 daily points

---

## 1. Overview

This section is the quickest snapshot of your current system.

### Master habits

How many habits currently exist in your master list.

If you delete a habit, this number drops.

### Categories

How many unique categories exist in the current master list.

Examples:

- `Wellness`
- `Self care`
- `Knowledge Acquisition`
- `Profession`

### Tracked days

How many unique dates have at least one saved entry in `StudioEntries`.

This is not the same as “days you fully completed.”

It simply means there is at least one saved record for that date.

### 30-day score

Average daily execution quality over the last 30 days.

At a high level:

- each active or relevant habit contributes progress between `0` and `1`
- checkbox habits are either `0` or `1`
- measurable habits can contribute partial progress like `0.4`, `0.7`, `1.0`

The daily score is the average of those habit progress values.

### Primary windows

How many unique primary habit windows exist in the current master list.

Important:

- this counts only the main window defined on each habit
- it does not count repetition windows here

### Logged time

Total time captured from time-based measurable habits over the last 30 days.

This includes units like:

- `seconds` / `sec`
- `minutes` / `min`
- `hours` / `hr`

It does not include non-time measurable units like:

- `count`
- `pages`
- `ml`

---

## 2. Insights

This section turns the raw data into plain-language signals.

These cards are summaries, not strict judgments.

### Momentum

Compares your last 14 days against the 14 days before that.

Interpretation:

- positive: recent execution improved
- negative: recent execution softened

### Reliability

Finds the most dependable habit over the last 30 days.

This is based on average progress and active-day coverage.

### Growth Pocket

Finds the habit whose recent 14-day progress improved the most compared with the previous 14 days.

This is useful for spotting habits that are gaining traction.

### Best Rhythm

Finds the weekday that tends to produce your strongest average score.

This uses the last 90 days of daily scores, giving it more data than the other insight cards.

Example:

- if Thursdays consistently score well, this card may show `Thursday`

### Strongest Category

Finds the category with the highest average execution over the last 30 days.

This helps answer:

- where is my system strongest right now?

### Tradeoff Watch

Shows the strongest negative habit-vs-habit relationship found in the correlation engine.

This is a clue that two habits may be competing for:

- time
- energy
- focus

Do not treat it as proof of causation.

---

## 3. Positive Correlations

This section shows habit pairs that tend to rise together over the last 90 days of available activity.

In plain terms:

- when one goes well, the other also tends to go well

This can reveal:

- mutually reinforcing habits
- good daily sequences
- habits that thrive on the same kind of day

Important:

- correlation is not causation
- it is a signal, not a conclusion

---

## 4. Tradeoff Watch

This section shows habit pairs that tend to move in opposite directions.

In plain terms:

- when one goes up, the other often goes down

This can suggest:

- time conflicts
- poor sequencing
- energy drain
- habit overload on certain days

Sometimes this is a real tradeoff.

Sometimes it simply means the habits belong to different kinds of days.

---

## 5. Window Intelligence

This section is about windows, not categories.

Each card summarizes one primary time window over the last 30 days.

Examples:

- `06:30 - 09:30`
- `13:00 - 14:00`
- `19:01 - 22:30`

Important design rule:

- this section uses each habit’s `primary window only`
- repeated reminders are intentionally not double-counted here

That makes this section conservative and stable.

### Planned

Total targeted time inside that primary window across the last 30 days.

### Logged

Total actually logged time inside that primary window across the last 30 days.

### Unlogged

The gap between planned and logged time.

At a high level:

- `Unlogged = Planned - Logged`

### Target Hit Rate

How much of the planned time was actually achieved.

At a high level:

- `Hit rate = Logged / Planned`

### Planned Versus Window Capacity

Shows how much of the available window time was planned.

At a high level:

- `Capacity pressure = Planned / Window capacity`

This helps answer:

- is this window overloaded?
- is this window under-planned?

### Spare Window Time Left

How much total window capacity remained after logged time is subtracted.

This is useful for seeing where the day still had room.

---

## 6. Window Trend Reports

This section is the deeper window analytics layer.

Unlike the simpler `Window Intelligence` cards, this section treats windows as time-series objects and shows trends over time.

It includes:

- insight cards
- rankings
- charts for each window

### Important repeated-habit rule

This section uses saved `windowAllocations` when available.

That means repeated measurable habits can contribute time to the exact window where the time was actually logged.

If older repeated history does not have saved `windowAllocations`, the system falls back to the primary window.

So:

- newer repeated-window history is more accurate
- older repeated-window history may be more conservative

### What the four time series mean

Every window chart can show:

- `Planned`
- `Logged`
- `Unused`
- `Unplanned`

#### Planned

The total targeted time assigned to habits inside that window.

#### Logged

The total actual time logged in that window.

#### Unused

The part of the window that remained unused after the window closed.

At a high level:

- `Unused = Window duration - Logged`

#### Unplanned

The part of the window that was intentionally left unallocated.

At a high level:

- `Unplanned = Window duration - Planned`

This is not failure.

It is spare capacity by design.

### Window Trend Insight Cards

#### Execution

Shows the window that converted planned time into logged time most effectively over the last 30 days.

Use it to answer:

- where do I actually follow through well?

#### Utilization

Shows the window using the highest share of its total available capacity.

Use it to answer:

- which window is densest?

#### Leakage

Shows the window with the greatest unused time after the window closes.

Use it to answer:

- where is time leaking away?

#### Unplanned Reserve

Shows the window that kept the largest share of open capacity unplanned.

Use it to answer:

- where do I still have intentional room?

#### Recovery

Shows the window whose recent 14-day execution improved the most versus the previous 14 days.

Use it to answer:

- which window is getting healthier?

### Rankings

#### Best Windows Over Time

These are windows that best convert planned time into actual logged time.

They are ranked using:

- execution efficiency
- utilization

#### Leakage Watch

These are windows that lose the most time after the window closes.

They are ranked using:

- leakage ratio
- total unused minutes

### Each Window Trend Chart

Every chart card shows:

- window label
- number of time-based habits in that window
- window duration
- period label
- total planned, logged, unused, and unplanned time for that selected period
- active day count
- execution, leakage, and planning-pressure summary
- line chart with all four series

Use this section to answer:

- which windows are improving?
- which windows are overloaded?
- where do I have spare capacity?
- where am I repeatedly leaving time unused?

---

## 7. Category Reports

This section is organized by category.

Inside each category, each habit gets its own report card.

Examples:

- `Wellness`
- `Self care`
- `Knowledge Acquisition`
- `Profession`

### What each habit card shows

#### Actual

What you actually did in the selected period.

For checkbox habits:

- completed count

For measurable habits:

- total logged amount

#### Target

What the system expected in the selected period.

For checkbox habits:

- number of active or historically relevant days in that period

For measurable habits:

- daily target multiplied by the number of relevant days in that period

#### Hit Rate

How much of the target was achieved.

For measurable habits:

- `Actual / Target`

For checkbox habits:

- completion rate over relevant days

### How to read the chart itself

The chart uses:

- bars for `Actual`
- a line for `Target`

This lets you compare:

- output
- expectation

across the selected period.

### Checkbox vs Measurable habits

Checkbox habit example:

- if a checkbox habit was relevant on 5 days in a weekly bucket
- and you completed it on 3 of those days
- then `Actual = 3`, `Target = 5`

Measurable habit example:

- if a habit targets `20 minutes` per relevant day
- and was relevant on 5 days
- then `Target = 100 minutes`

---

## Historical Behavior In Reports

Riseloop reports are built from:

- the current master habit definitions
- the saved entry history

### What is preserved well

If a real saved entry exists for a date, reports can still show that historical activity even if you later changed:

- active days
- category
- window
- repetition setup

This is especially important for older saved progress.

### What is not perfectly reconstructible

If a past day had no saved entry at all, and you later changed the habit definition, the system cannot always prove whether that day used to be:

- planned but not done
- not scheduled at all

So saved history is preserved best.
Unsaved historical misses are less certain after later habit edits.

### Checkbox compatibility note

Some older checkbox entries may have been saved historically as:

- `status = logged`
- `value = 1`

Riseloop now treats those as successful checkbox completions in reports.

---

## Repeated Habits In Reports

Repeated habits are supported, but different sections treat them differently.

### Window Intelligence

- primary window only
- conservative by design
- avoids double-counting repeated reminders

### Window Trend Reports

- uses saved `windowAllocations` when available
- better for true repeated-window analysis

### Category Reports

- habit-level totals remain shared at the habit level
- reports use the habit’s total saved entry for the day

---

## Deletion And Reports

This is important.

If you delete a habit:

- the habit is removed
- its entries are removed
- past reports will also lose that habit’s historical contribution

So delete is destructive for analytics.

That is why a future `archive` mode would be safer:

- remove the habit from the active daily board
- keep the old history in reports

---

## How To Interpret Empty Or Missing Data

If a report looks empty, check these possibilities:

### 1. Wrong period

Example:

- `Daily` only shows the last 14 days

Older data may still appear in:

- `Weekly`
- `Monthly`
- `Yearly`

### 2. No saved entries

If you never actually saved a row for that date, reports cannot invent it.

### 3. Deleted habit

If the habit was deleted, its entries were deleted too.

### 4. Non-time units in window reports

Window reports only work for measurable habits with time units like:

- `sec` / `secs` / `second` / `seconds`
- `min` / `mins` / `minute` / `minutes`
- `hr` / `hrs` / `hour` / `hours`

### 5. Repeated-window legacy history

If an old repeated measurable entry does not have `windowAllocations`, the reports may fall back to the primary window.

---

## Best Ways To Use The Reports Page

Use `Overview` when you want:

- a quick health check
- system size
- recent score

Use `Insights` when you want:

- direction
- reliability
- growth

Use `Positive Correlations` and `Tradeoff Watch` when you want:

- relationships between habits
- reinforcement patterns
- conflicts

Use `Window Intelligence` when you want:

- a simple 30-day window snapshot

Use `Window Trend Reports` when you want:

- leakage analysis
- efficiency trends
- capacity planning
- best and worst windows

Use `Category Reports` when you want:

- habit-by-habit performance inside each life domain

---

## Recommended Reading Order

If you are new to the reports page, use this order:

1. `Overview`
2. `Insights`
3. `Window Intelligence`
4. `Window Trend Reports`
5. `Category Reports`
6. `Correlations`

That order usually gives the clearest narrative:

- overall health
- what is changing
- where time is working
- where time is leaking
- which habits are driving it
- what relationships sit underneath it

---

## In One Sentence

The reports page is Riseloop’s operating dashboard: it shows not just whether you did your habits, but how your system behaves across time, categories, windows, and relationships between habits.
