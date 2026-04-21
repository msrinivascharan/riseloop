(function (window, document) {
  "use strict";

  // ── Config — update LM_STUDIO_MODEL to match the identifier shown in
  //   LM Studio's Local Server tab after loading the model. ─────────────────
  const LM_STUDIO_BASE    = "http://127.0.0.1:1234/v1";
  const LM_STUDIO_MODEL   = "google/gemma-3-1b";
  const LM_STUDIO_CHAT    = LM_STUDIO_BASE + "/chat/completions";
  const LM_STUDIO_MODELS  = LM_STUDIO_BASE + "/models";

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  const backend = window.SystemHabitsBackend;
  if (!backend) throw new Error("SystemHabitsBackend must load before system_habits_ai.js");

  const DOW_MAP = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const DOW_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

  const appState = {
    signedIn: false,
    lmReady: false,
    loading: { daily: false, weekly: false, monthly: false }
  };

  const els = {
    pageDate:      document.getElementById("pageDate"),
    backendStatus: document.getElementById("backendStatus"),
    backendMeta:   document.getElementById("backendMeta"),
    connectButton: document.getElementById("connectButton"),
    syncButton:    document.getElementById("syncButton"),
    signOutButton: document.getElementById("signOutButton"),
    lmStatus:      document.getElementById("lmStatus"),
    lmStatusText:  document.getElementById("lmStatusText"),
    lmCheckButton: document.getElementById("lmCheckButton"),
    dailyButton:   document.getElementById("dailyButton"),
    dailyResult:   document.getElementById("dailyResult"),
    dailyCopy:     document.getElementById("dailyCopy"),
    weeklyButton:  document.getElementById("weeklyButton"),
    weeklyResult:  document.getElementById("weeklyResult"),
    weeklyCopy:    document.getElementById("weeklyCopy"),
    monthlyButton: document.getElementById("monthlyButton"),
    monthlyResult: document.getElementById("monthlyResult"),
    monthlyCopy:   document.getElementById("monthlyCopy")
  };

  // ── Date helpers ──────────────────────────────────────────────────────────
  function dateKeyFor(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return backend.formatDateKey(d);
  }

  function dowFor(dateKey) {
    return DOW_MAP[new Date(dateKey + "T12:00:00").getDay()];
  }

  function longDate(dateKey) {
    return new Date(dateKey + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
  }

  function dayName(dateKey) {
    return new Date(dateKey + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
  }

  // ── Data builders ─────────────────────────────────────────────────────────
  function buildDailyContext() {
    const today = dateKeyFor(0);
    const habits = backend.listHabitsForDate(today);
    const entries = backend.listEntriesForDate(today);
    const entryMap = new Map(entries.map(function (e) { return [e.habitId, e]; }));

    const habitLines = habits.map(function (h) {
      const progress = backend.getHabitProgress(h, entryMap.get(h.id));
      let line = h.name + " — " + progress.label;
      if (h.type === "measurable" && progress.value !== "") {
        line += " (" + progress.value + " / " + h.target + " " + (h.unit || "") + ")";
      }
      return line;
    });

    const summary = backend.getDailySummary(today);

    const weekRows = [];
    for (let i = 6; i >= 0; i--) {
      const dk = dateKeyFor(i);
      const s = backend.getDailySummary(dk);
      const label = i === 0 ? dayName(dk) + " (today)" : dayName(dk);
      weekRows.push(label + ": " + s.progressPercent + "% (" + s.completed + "/" + s.total + " done)");
    }

    // Per-habit consistency across last 7 days
    const snapshot = backend.getStateSnapshot();
    const allEntries = snapshot.entries;
    const consistencyRows = habits.map(function (h) {
      let done = 0, active = 0;
      for (let i = 0; i < 7; i++) {
        const dk = dateKeyFor(i);
        if (!(h.activeDays || []).includes(dowFor(dk))) continue;
        active++;
        const entry = allEntries.find(function (e) { return e.habitId === h.id && e.dateKey === dk; });
        if (backend.getHabitProgress(h, entry).statusTone === "done") done++;
      }
      return active > 0 ? { name: h.name, done: done, active: active } : null;
    }).filter(Boolean).sort(function (a, b) { return (b.done / b.active) - (a.done / a.active); });

    const strongest = consistencyRows[0];
    const weakest   = consistencyRows[consistencyRows.length - 1];

    const lines = [
      "DATE: " + longDate(today),
      "",
      "TODAY'S HABITS:",
      habitLines.length ? habitLines.join("\n") : "(no habits scheduled today)",
      "",
      "TODAY'S SCORE: " + summary.progressPercent + "% — " +
        summary.completed + " done, " + summary.inProgress + " in progress, " +
        summary.notDone + " not done, " + summary.total + " total",
      "",
      "LAST 7 DAYS:",
      weekRows.join("\n")
    ];

    if (strongest) {
      lines.push("", "STRONGEST HABIT THIS WEEK: " + strongest.name +
        " (" + strongest.done + "/" + strongest.active + " days)");
    }
    if (weakest && weakest !== strongest) {
      lines.push("BIGGEST STRUGGLE THIS WEEK: " + weakest.name +
        " (" + weakest.done + "/" + weakest.active + " days)");
    }

    return lines.join("\n");
  }

  function buildWeeklyContext() {
    const snapshot   = backend.getStateSnapshot();
    const allHabits  = snapshot.habits;
    const allEntries = snapshot.entries;

    const dayRows = [];
    for (let i = 6; i >= 0; i--) {
      const dk = dateKeyFor(i);
      const s  = backend.getDailySummary(dk);
      const label = i === 0 ? dayName(dk) + " (today)" : dayName(dk);
      dayRows.push(label + ": " + s.progressPercent + "% — " +
        s.completed + " done, " + s.inProgress + " in progress, " +
        s.notDone + " not done of " + s.total + " scheduled");
    }

    const habitStats = allHabits.map(function (h) {
      let done = 0, active = 0, totalValue = 0;
      for (let i = 0; i < 7; i++) {
        const dk = dateKeyFor(i);
        if (!(h.activeDays || []).includes(dowFor(dk))) continue;
        active++;
        const entry   = allEntries.find(function (e) { return e.habitId === h.id && e.dateKey === dk; });
        const progress = backend.getHabitProgress(h, entry);
        if (progress.statusTone === "done") done++;
        if (typeof progress.value === "number") totalValue += progress.value;
      }
      return active > 0 ? { name: h.name, category: h.category, type: h.type, unit: h.unit, done: done, active: active, totalValue: totalValue } : null;
    }).filter(Boolean).sort(function (a, b) { return (b.done / b.active) - (a.done / a.active); });

    const habitLines = habitStats.map(function (h) {
      let line = h.name + " (" + (h.category || "—") + "): " +
        h.done + "/" + h.active + " days (" + Math.round((h.done / h.active) * 100) + "%)";
      if (h.type === "measurable" && h.totalValue > 0) {
        line += " — " + h.totalValue + " " + (h.unit || "units") + " logged";
      }
      return line;
    });

    const catMap = {};
    habitStats.forEach(function (h) {
      const cat = h.category || "Uncategorised";
      if (!catMap[cat]) catMap[cat] = { done: 0, active: 0 };
      catMap[cat].done   += h.done;
      catMap[cat].active += h.active;
    });
    const catLines = Object.keys(catMap).map(function (cat) {
      return cat + ": " + Math.round((catMap[cat].done / catMap[cat].active) * 100) + "%";
    });

    const overallPct = habitStats.length
      ? Math.round(habitStats.reduce(function (s, h) { return s + (h.done / h.active); }, 0) / habitStats.length * 100)
      : 0;

    return [
      "WEEKLY ANALYSIS — Last 7 days",
      "",
      "DAILY BREAKDOWN:",
      dayRows.join("\n"),
      "",
      "OVERALL WEEKLY AVERAGE: " + overallPct + "%",
      "",
      "PER-HABIT COMPLETION (best to worst):",
      habitLines.join("\n"),
      "",
      "BY CATEGORY:",
      catLines.join("\n")
    ].join("\n");
  }

  function buildMonthlyContext() {
    const snapshot   = backend.getStateSnapshot();
    const allHabits  = snapshot.habits;
    const allEntries = snapshot.entries;

    const habitStats = allHabits.map(function (h) {
      let done = 0, active = 0, totalValue = 0;
      let tempStreak = 0, longestStreak = 0, currentStreak = 0;
      const dowDone   = {};
      const dowActive = {};

      for (let i = 29; i >= 0; i--) {
        const dk = dateKeyFor(i);
        const dow = dowFor(dk);
        if (!(h.activeDays || []).includes(dow)) continue;
        active++;
        dowActive[dow] = (dowActive[dow] || 0) + 1;

        const entry    = allEntries.find(function (e) { return e.habitId === h.id && e.dateKey === dk; });
        const progress = backend.getHabitProgress(h, entry);

        if (progress.statusTone === "done") {
          done++;
          dowDone[dow] = (dowDone[dow] || 0) + 1;
          tempStreak++;
          if (tempStreak > longestStreak) longestStreak = tempStreak;
          if (i === 0) currentStreak = tempStreak;
        } else {
          if (i === 0) currentStreak = 0;
          tempStreak = 0;
        }
        if (typeof progress.value === "number") totalValue += progress.value;
      }

      const dowRates = Object.keys(dowActive)
        .map(function (dow) { return { dow: dow, rate: (dowDone[dow] || 0) / dowActive[dow] }; })
        .sort(function (a, b) { return b.rate - a.rate; });

      return active > 0 ? {
        name: h.name, category: h.category, type: h.type, unit: h.unit,
        done: done, active: active, totalValue: totalValue,
        currentStreak: currentStreak, longestStreak: longestStreak,
        bestDow:  dowRates.length ? dowRates[0].dow : null,
        worstDow: dowRates.length > 1 ? dowRates[dowRates.length - 1].dow : null
      } : null;
    }).filter(Boolean).sort(function (a, b) { return (b.done / b.active) - (a.done / a.active); });

    const habitLines = habitStats.map(function (h) {
      let line = h.name + " (" + (h.category || "—") + "): " +
        h.done + "/" + h.active + " active days (" + Math.round((h.done / h.active) * 100) + "%)";
      if (h.currentStreak > 1)  line += " — current streak: " + h.currentStreak + " days";
      if (h.longestStreak > 1)  line += ", longest streak: " + h.longestStreak + " days";
      if (h.type === "measurable" && h.totalValue > 0) {
        line += " — " + h.totalValue + " " + (h.unit || "units") + " total";
      }
      if (h.bestDow && h.worstDow && h.bestDow !== h.worstDow) {
        line += " — best: " + (DOW_LABELS[h.bestDow] || h.bestDow) +
          ", weakest: " + (DOW_LABELS[h.worstDow] || h.worstDow);
      }
      return line;
    });

    // Trend: compare first 15 days vs most recent 15 days
    let earlyTotal = 0, earlyCount = 0, recentTotal = 0, recentCount = 0;
    for (let i = 0; i < 30; i++) {
      const s = backend.getDailySummary(dateKeyFor(i));
      if (s.total === 0) continue;
      if (i < 15) { recentTotal += s.progressPercent; recentCount++; }
      else         { earlyTotal  += s.progressPercent; earlyCount++;  }
    }
    const earlyAvg  = earlyCount  ? Math.round(earlyTotal  / earlyCount)  : 0;
    const recentAvg = recentCount ? Math.round(recentTotal / recentCount) : 0;
    const trend = recentAvg > earlyAvg + 5 ? "improving" :
                  recentAvg < earlyAvg - 5 ? "declining" : "stable";

    return [
      "MONTHLY ANALYSIS — Last 30 days",
      "",
      "TREND: " + trend + " (days 16-30 avg: " + earlyAvg + "%, last 15 days avg: " + recentAvg + "%)",
      "",
      "PER-HABIT STATS (best completion rate first):",
      habitLines.join("\n")
    ].join("\n");
  }

  // ── Prompts ───────────────────────────────────────────────────────────────
  const SYSTEM_PROMPT =
    "You are a personal habit coach. Analyse the habit data and respond in plain text only — " +
    "no markdown, no asterisks, no hashes. Be warm, specific to the numbers, and concise.";

  function dailyPrompt() {
    return {
      system: SYSTEM_PROMPT + " Max 200 words.",
      user: buildDailyContext() +
        "\n\nPlease give me:\n" +
        "1. A brief summary of today (2-3 sentences)\n" +
        "2. One specific insight from this week's pattern\n" +
        "3. One concrete thing to try tomorrow"
    };
  }

  function weeklyPrompt() {
    return {
      system: SYSTEM_PROMPT + " Max 250 words.",
      user: buildWeeklyContext() +
        "\n\nPlease give me:\n" +
        "1. An overall assessment of this week (2-3 sentences)\n" +
        "2. The most important pattern you notice\n" +
        "3. One habit to prioritise and one strategy to try next week"
    };
  }

  function monthlyPrompt() {
    return {
      system: SYSTEM_PROMPT + " Max 320 words.",
      user: buildMonthlyContext() +
        "\n\nPlease give me:\n" +
        "1. An overall monthly assessment (2-3 sentences)\n" +
        "2. Your top observation about the trajectory or pattern\n" +
        "3. The habit most worth reinforcing and why\n" +
        "4. One specific thing to change or try next month"
    };
  }

  // ── LM Studio API ─────────────────────────────────────────────────────────
  async function checkLmStudio() {
    try {
      const res = await fetch(LM_STUDIO_MODELS, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  async function callLmStudio(systemPrompt, userPrompt) {
    const res = await fetch(LM_STUDIO_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LM_STUDIO_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   }
        ],
        temperature: 0.7,
        max_tokens: 700,
        stream: false
      }),
      signal: AbortSignal.timeout(180000)
    });

    if (!res.ok) {
      const text = await res.text().catch(function () { return ""; });
      throw new Error("LM Studio returned " + res.status + ": " + text.slice(0, 200));
    }

    const data    = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error("LM Studio returned an empty response.");
    return content.trim();
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  function setLmStatus(ready) {
    appState.lmReady = ready;
    if (ready) {
      els.lmStatus.className = "lm-status lm-ready";
      els.lmStatusText.textContent = "LM Studio connected — Gemma 3 1B ready";
    } else {
      els.lmStatus.className = "lm-status lm-offline";
      els.lmStatusText.textContent = "LM Studio not detected — open LM Studio, load Gemma 3 1B (Q4_K_M), and start the local server";
    }
    syncButtons();
  }

  function syncButtons() {
    const canRun = appState.signedIn && appState.lmReady;
    els.dailyButton.disabled  = !canRun || appState.loading.daily;
    els.weeklyButton.disabled = !canRun || appState.loading.weekly;
    els.monthlyButton.disabled= !canRun || appState.loading.monthly;
    els.dailyCopy.hidden  = !els.dailyResult.textContent.trim()  || appState.loading.daily;
    els.weeklyCopy.hidden = !els.weeklyResult.textContent.trim() || appState.loading.weekly;
    els.monthlyCopy.hidden= !els.monthlyResult.textContent.trim()|| appState.loading.monthly;
  }

  const BUTTON_LABELS = {
    daily:   "Generate Daily Analysis",
    weekly:  "Generate Weekly Analysis",
    monthly: "Generate Monthly Analysis"
  };

  function setLoading(type, loading) {
    appState.loading[type] = loading;
    const btn = els[type + "Button"];
    const res = els[type + "Result"];
    if (loading) {
      btn.textContent = "Gemma is thinking…";
      res.className   = "ai-result ai-loading";
      res.textContent = "Analysing your habit data — this takes around 30 – 90 seconds on CPU.";
    } else {
      btn.textContent = BUTTON_LABELS[type];
    }
    syncButtons();
  }

  function setResult(type, text, isError) {
    const res   = els[type + "Result"];
    res.className   = "ai-result" + (isError ? " ai-error" : " ai-done");
    res.textContent = text;
    syncButtons();
  }

  async function runAnalysis(type, promptFn) {
    if (appState.loading[type]) return;
    setLoading(type, true);
    try {
      const p    = promptFn();
      const text = await callLmStudio(p.system, p.user);
      setResult(type, text, false);
    } catch (err) {
      setResult(type, "Error: " + err.message, true);
    } finally {
      setLoading(type, false);
    }
  }

  // ── Backend subscription ──────────────────────────────────────────────────
  backend.subscribe(function () {
    const meta   = backend.getMeta();
    const status = backend.getStatus();

    appState.signedIn = status.signedIn;
    syncButtons();

    if (!status.ready) {
      els.backendStatus.textContent = "Preparing Google Sheets";
      els.connectButton.hidden = true;
      els.syncButton.hidden    = true;
      els.signOutButton.hidden = true;
      return;
    }

    if (status.signedIn) {
      els.backendStatus.textContent = "Google Sheets connected";
      els.connectButton.hidden = true;
      els.syncButton.hidden    = false;
      els.signOutButton.hidden = false;
      const when = meta.lastSyncedAt
        ? new Date(meta.lastSyncedAt).toLocaleTimeString()
        : "never";
      els.backendMeta.textContent = "Last synced: " + when +
        ". Analyses read from your live StudioHabits and StudioEntries data.";
    } else {
      els.backendStatus.textContent = "Not connected";
      els.connectButton.hidden = false;
      els.syncButton.hidden    = true;
      els.signOutButton.hidden = true;
      els.backendMeta.textContent =
        "Connect Google Sheets to enable AI analysis. Your data never leaves your laptop.";
    }
  });

  // ── Events ────────────────────────────────────────────────────────────────
  els.connectButton.addEventListener("click",  function () { backend.signIn();  });
  els.syncButton.addEventListener("click",     function () { backend.sync();    });
  els.signOutButton.addEventListener("click",  function () { backend.signOut(); });

  els.lmCheckButton.addEventListener("click", async function () {
    els.lmCheckButton.textContent = "Checking…";
    els.lmCheckButton.disabled    = true;
    const ready = await checkLmStudio();
    setLmStatus(ready);
    els.lmCheckButton.textContent = "Check again";
    els.lmCheckButton.disabled    = false;
  });

  els.dailyButton.addEventListener("click",   function () { runAnalysis("daily",   dailyPrompt);   });
  els.weeklyButton.addEventListener("click",  function () { runAnalysis("weekly",  weeklyPrompt);  });
  els.monthlyButton.addEventListener("click", function () { runAnalysis("monthly", monthlyPrompt); });

  ["daily", "weekly", "monthly"].forEach(function (type) {
    els[type + "Copy"].addEventListener("click", function () {
      const text = els[type + "Result"].textContent;
      navigator.clipboard.writeText(text).catch(function () {});
    });
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  els.pageDate.textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  checkLmStudio().then(setLmStatus);

})(window, document);
