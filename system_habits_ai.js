(function (window, document) {
  "use strict";

  // ── Config ────────────────────────────────────────────────────────────────
  const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
  const GROQ_MODEL = (window.SystemHabitsConfig && window.SystemHabitsConfig.groqModel) || "llama-3.3-70b-versatile";

  function groqKey() {
    return (window.SystemHabitsConfig && window.SystemHabitsConfig.groqApiKey) || "";
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  const backend = window.SystemHabitsBackend;
  if (!backend) throw new Error("SystemHabitsBackend must load before system_habits_ai.js");

  const DOW_MAP    = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const DOW_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

  const appState = {
    signedIn: false,
    loading: { daily: false, weekly: false, monthly: false, deep: false }
  };

  const els = {
    pageDate:      document.getElementById("pageDate"),
    backendStatus: document.getElementById("backendStatus"),
    backendMeta:   document.getElementById("backendMeta"),
    connectButton: document.getElementById("connectButton"),
    syncButton:    document.getElementById("syncButton"),
    signOutButton: document.getElementById("signOutButton"),
    geminiStatus:  document.getElementById("geminiStatus"),
    dailyButton:   document.getElementById("dailyButton"),
    dailyResult:   document.getElementById("dailyResult"),
    dailyCopy:     document.getElementById("dailyCopy"),
    weeklyButton:  document.getElementById("weeklyButton"),
    weeklyResult:  document.getElementById("weeklyResult"),
    weeklyCopy:    document.getElementById("weeklyCopy"),
    monthlyButton: document.getElementById("monthlyButton"),
    monthlyResult: document.getElementById("monthlyResult"),
    monthlyCopy:   document.getElementById("monthlyCopy"),
    deepButton:    document.getElementById("deepButton"),
    deepResult:    document.getElementById("deepResult"),
    deepCopy:      document.getElementById("deepCopy")
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

  function windowBucket(timeStr) {
    if (!timeStr) return "Unscheduled";
    const h = parseInt(timeStr.split(":")[0], 10);
    if (h < 6)  return "Night";
    if (h < 9)  return "Early Morning";
    if (h < 12) return "Morning";
    if (h < 15) return "Early Afternoon";
    if (h < 18) return "Afternoon";
    if (h < 21) return "Evening";
    return "Night";
  }

  // ── Phase A: Category & Window Rankings ───────────────────────────────────
  function computeCategoryRankings(habitStats) {
    const catMap = {};
    habitStats.forEach(function (h) {
      const cat = h.category || "Uncategorised";
      if (!catMap[cat]) catMap[cat] = { done: 0, active: 0 };
      catMap[cat].done   += h.done;
      catMap[cat].active += h.active;
    });
    return Object.keys(catMap)
      .map(function (cat) {
        return { name: cat, pct: Math.round((catMap[cat].done / catMap[cat].active) * 100) };
      })
      .sort(function (a, b) { return b.pct - a.pct; });
  }

  function computeWindowRankings(allEntries, days) {
    const winMap = {};
    for (let i = 0; i < days; i++) {
      const dk     = dateKeyFor(i);
      const habits = backend.listHabitsForDate(dk);
      habits.forEach(function (h) {
        const bucket = windowBucket(h.windowStart);
        if (!winMap[bucket]) winMap[bucket] = { done: 0, active: 0 };
        winMap[bucket].active++;
        const entry = allEntries.find(function (e) { return e.habitId === h.id && e.dateKey === dk; });
        if (backend.getHabitProgress(h, entry).statusTone === "done") winMap[bucket].done++;
      });
    }
    return Object.keys(winMap)
      .map(function (w) {
        return { name: w, pct: Math.round((winMap[w].done / winMap[w].active) * 100) };
      })
      .sort(function (a, b) { return b.pct - a.pct; });
  }

  function computeHabitTiers(habitStats) {
    const favourites   = habitStats.filter(function (h) { return (h.done / h.active) >= 0.8; });
    const struggling   = habitStats.filter(function (h) { return (h.done / h.active) <  0.4; });
    const inconsistent = habitStats.filter(function (h) {
      const r = h.done / h.active;
      return r >= 0.4 && r < 0.8;
    });
    return { favourites: favourites, struggling: struggling, inconsistent: inconsistent };
  }

  // ── Phase B: Correlation Engine ───────────────────────────────────────────
  function computeCorrelations(allHabits, allEntries, days) {
    const habitDays = {};
    allHabits.forEach(function (h) {
      habitDays[h.id] = { name: h.name };
      const dayMap = {};
      for (let i = 0; i < days; i++) {
        const dk  = dateKeyFor(i);
        const dow = dowFor(dk);
        if (!(h.activeDays || []).includes(dow)) continue;
        const entry = allEntries.find(function (e) { return e.habitId === h.id && e.dateKey === dk; });
        dayMap[dk] = backend.getHabitProgress(h, entry).statusTone === "done" ? 1 : 0;
      }
      habitDays[h.id].days = dayMap;
    });

    const pairs = [];
    const ids   = Object.keys(habitDays);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = habitDays[ids[i]];
        const b = habitDays[ids[j]];
        const shared = Object.keys(a.days).filter(function (dk) { return dk in b.days; });
        if (shared.length < 5) continue;
        let bothDone = 0, aDoneOnly = 0, bDoneOnly = 0;
        shared.forEach(function (dk) {
          const av = a.days[dk], bv = b.days[dk];
          if (av && bv)       bothDone++;
          else if (av && !bv) aDoneOnly++;
          else if (!av && bv) bDoneOnly++;
        });
        const total    = shared.length;
        const aRate    = (bothDone + aDoneOnly) / total;
        const bRate    = (bothDone + bDoneOnly) / total;
        const expected = aRate * bRate;
        const actual   = bothDone / total;
        const lift     = expected > 0 ? actual / expected : 0;
        const negLift  = (bothDone + aDoneOnly) > 0 ? aDoneOnly / (bothDone + aDoneOnly) : 0;
        pairs.push({
          a: a.name, b: b.name,
          lift: lift, negLift: negLift,
          aRate: Math.round(aRate * 100),
          bRate: Math.round(bRate * 100),
          bothPct: Math.round(actual * 100)
        });
      }
    }

    const positive = pairs
      .filter(function (p) { return p.lift > 1.3; })
      .sort(function (a, b) { return b.lift - a.lift; })
      .slice(0, 4);

    const negative = pairs
      .filter(function (p) { return p.negLift > 0.6 && p.aRate > 50; })
      .sort(function (a, b) { return b.negLift - a.negLift; })
      .slice(0, 3);

    return { positive: positive, negative: negative };
  }

  // ── Phase C: Trend Detection ──────────────────────────────────────────────
  function computeTrends(allHabits, allEntries, days) {
    return allHabits.map(function (h) {
      const pts = [];
      for (let i = days - 1; i >= 0; i--) {
        const dk  = dateKeyFor(i);
        const dow = dowFor(dk);
        if (!(h.activeDays || []).includes(dow)) continue;
        const entry = allEntries.find(function (e) { return e.habitId === h.id && e.dateKey === dk; });
        pts.push(backend.getHabitProgress(h, entry).statusTone === "done" ? 1 : 0);
      }
      if (pts.length < 5) return null;

      const win = Math.min(7, pts.length);
      const rolling = [];
      for (let i = win - 1; i < pts.length; i++) {
        const slice = pts.slice(i - win + 1, i + 1);
        rolling.push(slice.reduce(function (s, v) { return s + v; }, 0) / win);
      }

      const n = rolling.length;
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      rolling.forEach(function (y, x) { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; });
      const slope    = (n * sumXY - sumX * sumY) / ((n * sumX2 - sumX * sumX) || 1);
      const mean     = sumY / n;
      const variance = rolling.reduce(function (s, v) { return s + Math.pow(v - mean, 2); }, 0) / n;

      const recentAvg = Math.round(rolling.slice(-3).reduce(function (s, v) { return s + v; }, 0) / 3 * 100);
      const earlyAvg  = Math.round(rolling.slice(0, 3).reduce(function (s, v) { return s + v; }, 0) / 3 * 100);

      let direction = "stable";
      if      (slope >  0.02) direction = "rising";
      else if (slope < -0.02) direction = "falling";
      if (variance > 0.08)    direction = direction === "stable" ? "volatile" : direction + " (volatile)";

      return { name: h.name, category: h.category, direction: direction,
               recentAvg: recentAvg, earlyAvg: earlyAvg, slope: slope };
    }).filter(Boolean);
  }

  // ── Phase D: 14-Day Projections ───────────────────────────────────────────
  function computeProjections(trends) {
    return trends.map(function (t) {
      const projected = Math.min(100, Math.max(0, Math.round(t.recentAvg + t.slope * 14 * 100)));
      const change    = projected - t.recentAvg;
      return {
        name: t.name, current: t.recentAvg, projected: projected, change: change,
        direction: change > 5 ? "improving" : change < -5 ? "declining" : "steady"
      };
    }).sort(function (a, b) { return a.change - b.change; });
  }

  // ── Phase E: Failure Pattern Detection ────────────────────────────────────
  function computeFailurePatterns(allHabits, allEntries, days) {
    return allHabits.map(function (h) {
      const dowMisses = {}, dowActive = {}, missLoads = [];
      for (let i = 0; i < days; i++) {
        const dk  = dateKeyFor(i);
        const dow = dowFor(dk);
        if (!(h.activeDays || []).includes(dow)) continue;
        dowActive[dow] = (dowActive[dow] || 0) + 1;
        const entry = allEntries.find(function (e) { return e.habitId === h.id && e.dateKey === dk; });
        if (backend.getHabitProgress(h, entry).statusTone !== "done") {
          dowMisses[dow] = (dowMisses[dow] || 0) + 1;
          missLoads.push(backend.getDailySummary(dk).total);
        }
      }
      const totalActive = Object.values(dowActive).reduce(function (s, v) { return s + v; }, 0);
      const totalMissed = Object.values(dowMisses).reduce(function (s, v) { return s + v; }, 0);
      if (totalActive === 0 || (totalMissed / totalActive) < 0.3) return null;

      const worstDow = Object.keys(dowActive)
        .map(function (d) { return { dow: d, rate: (dowMisses[d] || 0) / dowActive[d] }; })
        .sort(function (a, b) { return b.rate - a.rate; })[0];

      const avgMissLoad = missLoads.length
        ? Math.round(missLoads.reduce(function (s, v) { return s + v; }, 0) / missLoads.length)
        : 0;

      return {
        name:      h.name,
        missRate:  Math.round((totalMissed / totalActive) * 100),
        worstDow:  worstDow ? worstDow.dow : null,
        worstRate: worstDow ? Math.round(worstDow.rate * 100) : 0,
        avgMissLoad: avgMissLoad
      };
    }).filter(Boolean).sort(function (a, b) { return b.missRate - a.missRate; });
  }

  // ── Shared stats builder ──────────────────────────────────────────────────
  function buildHabitStats(days) {
    const snapshot   = backend.getStateSnapshot();
    const allHabits  = snapshot.habits;
    const allEntries = snapshot.entries;

    const stats = allHabits.map(function (h) {
      let done = 0, active = 0, totalValue = 0;
      let tempStreak = 0, longestStreak = 0, currentStreak = 0;

      for (let i = days - 1; i >= 0; i--) {
        const dk  = dateKeyFor(i);
        const dow = dowFor(dk);
        if (!(h.activeDays || []).includes(dow)) continue;
        active++;
        const entry    = allEntries.find(function (e) { return e.habitId === h.id && e.dateKey === dk; });
        const progress = backend.getHabitProgress(h, entry);
        if (progress.statusTone === "done") {
          done++;
          tempStreak++;
          if (tempStreak > longestStreak) longestStreak = tempStreak;
          if (i === 0) currentStreak = tempStreak;
        } else {
          if (i === 0) currentStreak = 0;
          tempStreak = 0;
        }
        if (typeof progress.value === "number") totalValue += progress.value;
      }
      return active > 0
        ? { id: h.id, name: h.name, category: h.category, type: h.type, unit: h.unit,
            windowStart: h.windowStart,
            done: done, active: active, totalValue: totalValue,
            currentStreak: currentStreak, longestStreak: longestStreak }
        : null;
    }).filter(Boolean);

    return { stats: stats, allHabits: allHabits, allEntries: allEntries };
  }

  // ── Data context builders ─────────────────────────────────────────────────
  function buildDailyContext() {
    const today    = dateKeyFor(0);
    const habits   = backend.listHabitsForDate(today);
    const entries  = backend.listEntriesForDate(today);
    const entryMap = new Map(entries.map(function (e) { return [e.habitId, e]; }));

    const catToday = {}, winToday = {};
    const habitLines = habits.map(function (h) {
      const progress = backend.getHabitProgress(h, entryMap.get(h.id));
      const cat      = h.category || "Uncategorised";
      const bucket   = windowBucket(h.windowStart);

      if (!catToday[cat]) catToday[cat] = { done: 0, total: 0 };
      catToday[cat].total++;
      if (!winToday[bucket]) winToday[bucket] = { done: 0, total: 0 };
      winToday[bucket].total++;

      if (progress.statusTone === "done") {
        catToday[cat].done++;
        winToday[bucket].done++;
      }

      let line = "  " + h.name + " [" + cat + "] — " + progress.label;
      if (h.type === "measurable" && progress.value !== "") {
        line += " (" + progress.value + "/" + h.target + " " + (h.unit || "") + ")";
      }
      return line;
    });

    const summary  = backend.getDailySummary(today);
    const weekRows = [];
    for (let i = 6; i >= 0; i--) {
      const dk = dateKeyFor(i);
      const s  = backend.getDailySummary(dk);
      weekRows.push("  " + (i === 0 ? dayName(dk) + " (today)" : dayName(dk)) +
        ": " + s.progressPercent + "% (" + s.completed + "/" + s.total + ")");
    }

    const catLines = Object.keys(catToday)
      .map(function (c) { return "  " + c + ": " + catToday[c].done + "/" + catToday[c].total + " done"; })
      .sort();
    const winLines = Object.keys(winToday)
      .map(function (w) { return "  " + w + ": " + winToday[w].done + "/" + winToday[w].total + " done"; })
      .sort();

    return [
      "DATE: " + longDate(today),
      "",
      "TODAY'S SCORE: " + summary.progressPercent + "% — " +
        summary.completed + " done, " + summary.inProgress + " in-progress, " +
        summary.notDone + " not done (of " + summary.total + " scheduled)",
      "",
      "BY CATEGORY TODAY:",
      catLines.join("\n"),
      "",
      "BY TIME WINDOW TODAY:",
      winLines.join("\n"),
      "",
      "HABITS TODAY:",
      habitLines.join("\n"),
      "",
      "LAST 7 DAYS:",
      weekRows.join("\n")
    ].join("\n");
  }

  function buildWeeklyContext() {
    const { stats, allEntries } = buildHabitStats(7);
    const catRankings = computeCategoryRankings(stats);
    const winRankings = computeWindowRankings(allEntries, 7);
    const tiers       = computeHabitTiers(stats);

    const dayRows = [];
    for (let i = 6; i >= 0; i--) {
      const dk = dateKeyFor(i);
      const s  = backend.getDailySummary(dk);
      dayRows.push("  " + (i === 0 ? dayName(dk) + " (today)" : dayName(dk)) +
        ": " + s.progressPercent + "% (" + s.completed + "/" + s.total + ")");
    }

    const sortedStats = stats.slice().sort(function (a, b) { return (b.done / b.active) - (a.done / a.active); });
    const habitLines  = sortedStats.map(function (h) {
      let line = "  " + h.name + " [" + (h.category || "—") + "]: " +
        h.done + "/" + h.active + " (" + Math.round((h.done / h.active) * 100) + "%)";
      if (h.type === "measurable" && h.totalValue > 0) line += " — " + h.totalValue + " " + (h.unit || "units");
      return line;
    });

    const overallPct = stats.length
      ? Math.round(stats.reduce(function (s, h) { return s + (h.done / h.active); }, 0) / stats.length * 100)
      : 0;

    return [
      "WEEKLY ANALYSIS — Last 7 Days",
      "OVERALL AVERAGE: " + overallPct + "%",
      "",
      "DAILY BREAKDOWN:",
      dayRows.join("\n"),
      "",
      "CATEGORY RANKINGS (best → worst):",
      catRankings.map(function (c) { return "  " + c.name + ": " + c.pct + "%"; }).join("\n"),
      "",
      "TIME WINDOW RANKINGS (best → worst):",
      winRankings.map(function (w) { return "  " + w.name + ": " + w.pct + "%"; }).join("\n"),
      "",
      "FAVOURITES (≥80%): " + (tiers.favourites.map(function (h) { return h.name; }).join(", ") || "none"),
      "STRUGGLING (<40%): " + (tiers.struggling.map(function (h) { return h.name; }).join(", ") || "none"),
      "",
      "PER-HABIT COMPLETION (best → worst):",
      habitLines.join("\n")
    ].join("\n");
  }

  function buildMonthlyContext() {
    const { stats, allEntries } = buildHabitStats(30);
    const catRankings = computeCategoryRankings(stats);
    const winRankings = computeWindowRankings(allEntries, 30);

    let earlyTotal = 0, earlyCount = 0, recentTotal = 0, recentCount = 0;
    for (let i = 0; i < 30; i++) {
      const s = backend.getDailySummary(dateKeyFor(i));
      if (s.total === 0) continue;
      if (i < 15) { recentTotal += s.progressPercent; recentCount++; }
      else         { earlyTotal  += s.progressPercent; earlyCount++;  }
    }
    const earlyAvg  = earlyCount  ? Math.round(earlyTotal  / earlyCount)  : 0;
    const recentAvg = recentCount ? Math.round(recentTotal / recentCount) : 0;
    const trend     = recentAvg > earlyAvg + 5 ? "improving" :
                      recentAvg < earlyAvg - 5 ? "declining" : "stable";

    const sortedStats = stats.slice().sort(function (a, b) { return (b.done / b.active) - (a.done / a.active); });
    const habitLines  = sortedStats.map(function (h) {
      let line = "  " + h.name + " [" + (h.category || "—") + "]: " +
        h.done + "/" + h.active + " (" + Math.round((h.done / h.active) * 100) + "%)";
      if (h.currentStreak > 1)  line += " — streak: " + h.currentStreak + "d";
      if (h.longestStreak > 1)  line += ", longest: " + h.longestStreak + "d";
      if (h.type === "measurable" && h.totalValue > 0) line += " — " + h.totalValue + " " + (h.unit || "units");
      return line;
    });

    return [
      "MONTHLY ANALYSIS — Last 30 Days",
      "OVERALL TREND: " + trend + " (early avg: " + earlyAvg + "%, recent avg: " + recentAvg + "%)",
      "",
      "CATEGORY RANKINGS (best → worst):",
      catRankings.map(function (c) { return "  " + c.name + ": " + c.pct + "%"; }).join("\n"),
      "",
      "TIME WINDOW RANKINGS (best → worst):",
      winRankings.map(function (w) { return "  " + w.name + ": " + w.pct + "%"; }).join("\n"),
      "",
      "PER-HABIT STATS (best → worst):",
      habitLines.join("\n")
    ].join("\n");
  }

  // ── Phase F: Deep context (all 6 dimensions pre-computed) ─────────────────
  function buildDeepContext() {
    const { stats, allHabits, allEntries } = buildHabitStats(30);
    const catRankings  = computeCategoryRankings(stats);
    const winRankings  = computeWindowRankings(allEntries, 30);
    const tiers        = computeHabitTiers(stats);
    const correlations = computeCorrelations(allHabits, allEntries, 30);
    const trends       = computeTrends(allHabits, allEntries, 30);
    const projections  = computeProjections(trends);
    const failures     = computeFailurePatterns(allHabits, allEntries, 30);

    const lines = ["DEEP ANALYSIS — Last 30 Days (pre-computed statistics for AI interpretation)", ""];

    lines.push("── A. CATEGORY PERFORMANCE RANKINGS ──");
    catRankings.forEach(function (c, i) { lines.push((i + 1) + ". " + c.name + ": " + c.pct + "%"); });
    lines.push("");

    lines.push("── B. TIME WINDOW RANKINGS ──");
    winRankings.forEach(function (w, i) { lines.push((i + 1) + ". " + w.name + ": " + w.pct + "%"); });
    lines.push("");

    lines.push("── C. HABIT PERFORMANCE TIERS ──");
    lines.push("FAVOURITES (≥80% — these are now automatic):");
    if (tiers.favourites.length) {
      tiers.favourites.forEach(function (h) {
        lines.push("  + " + h.name + " [" + (h.category || "—") + "] — " +
          Math.round((h.done / h.active) * 100) + "%" +
          (h.currentStreak > 2 ? ", " + h.currentStreak + "-day streak" : ""));
      });
    } else { lines.push("  (none yet)"); }
    lines.push("STRUGGLING (<40% — these need attention):");
    if (tiers.struggling.length) {
      tiers.struggling.forEach(function (h) {
        lines.push("  - " + h.name + " [" + (h.category || "—") + "] — " +
          Math.round((h.done / h.active) * 100) + "%");
      });
    } else { lines.push("  (none — excellent!)"); }
    lines.push("INCONSISTENT (40–79% — potential to unlock):");
    if (tiers.inconsistent.length) {
      tiers.inconsistent.forEach(function (h) {
        lines.push("  ~ " + h.name + " [" + (h.category || "—") + "] — " +
          Math.round((h.done / h.active) * 100) + "%");
      });
    } else { lines.push("  (none)"); }
    lines.push("");

    if (correlations.positive.length) {
      lines.push("── D. POSITIVE CORRELATIONS (habits that reinforce each other) ──");
      correlations.positive.forEach(function (p) {
        lines.push("  When '" + p.a + "' is done, '" + p.b + "' is also done " +
          p.bothPct + "% of shared days (individual rates: " + p.aRate + "% and " + p.bRate + "%)");
      });
      lines.push("");
    }

    if (correlations.negative.length) {
      lines.push("── E. CONFLICT PATTERNS (done together less than expected) ──");
      correlations.negative.forEach(function (p) {
        lines.push("  When '" + p.a + "' is done, '" + p.b + "' is missed " +
          Math.round(p.negLift * 100) + "% of those same days");
      });
      lines.push("");
    }

    if (trends.length) {
      lines.push("── F. TREND DIRECTIONS (30-day rolling trajectory per habit) ──");
      trends.forEach(function (t) {
        lines.push("  " + t.name + " [" + (t.category || "—") + "]: " + t.direction +
          " (early avg " + t.earlyAvg + "% → recent avg " + t.recentAvg + "%)");
      });
      lines.push("");
    }

    if (projections.length) {
      lines.push("── G. 14-DAY PROJECTIONS (if current trend continues unchanged) ──");
      projections.slice(0, 6).forEach(function (p) {
        lines.push("  " + p.name + ": " + p.current + "% → " + p.projected + "% (" +
          (p.change >= 0 ? "+" : "") + p.change + " pts) — " + p.direction);
      });
      lines.push("");
    }

    if (failures.length) {
      lines.push("── H. FAILURE PATTERNS (worst day-of-week for each struggling habit) ──");
      failures.slice(0, 6).forEach(function (f) {
        lines.push("  " + f.name + ": overall miss rate " + f.missRate + "%" +
          (f.worstDow ? ", worst on " + (DOW_LABELS[f.worstDow] || f.worstDow) + "s (" + f.worstRate + "% miss)" : "") +
          (f.avgMissLoad > 0 ? " — avg " + f.avgMissLoad + " habits scheduled on days it's missed" : ""));
      });
      lines.push("");
    }

    return lines.join("\n");
  }

  // ── Prompts ───────────────────────────────────────────────────────────────
  const SYSTEM_PROMPT =
    "You are a sharp, warm personal habit coach. Analyse the pre-computed habit data provided. " +
    "Respond in plain text only — no markdown, no asterisks, no hash symbols, no bullet dashes. " +
    "Use numbered sections exactly as asked. Be specific to the numbers given. " +
    "Write like a coach who knows this person well.";

  function dailyPrompt() {
    return {
      system: SYSTEM_PROMPT + " Keep your response under 220 words.",
      user: buildDailyContext() +
        "\n\nGive me exactly three sections:\n" +
        "1. TODAY'S VERDICT: Which category won today and which lost? What was the best time window and the worst?\n" +
        "2. PATTERN CHECK: One specific insight drawn from this week's daily scores — what trend is forming?\n" +
        "3. TOMORROW'S FOCUS: One concrete, specific action to improve tomorrow based on today's weakest area"
    };
  }

  function weeklyPrompt() {
    return {
      system: SYSTEM_PROMPT + " Keep your response under 300 words.",
      user: buildWeeklyContext() +
        "\n\nGive me exactly four sections:\n" +
        "1. WEEK VERDICT: Which category dominated and which struggled? Best vs worst time window this week?\n" +
        "2. FAVOURITE HABIT: Which habit has become most automatic this week and what does that consistency tell me about my lifestyle?\n" +
        "3. BIGGEST CONCERN: Which habit is being most neglected — what is the likely real-world reason?\n" +
        "4. NEXT WEEK FOCUS: One specific habit to concentrate on and one concrete strategy to improve it"
    };
  }

  function monthlyPrompt() {
    return {
      system: SYSTEM_PROMPT + " Keep your response under 380 words.",
      user: buildMonthlyContext() +
        "\n\nGive me exactly four sections:\n" +
        "1. MONTHLY VERDICT: Overall trend direction, best and worst performing category with commentary\n" +
        "2. TRAJECTORY STORY: What does the early-vs-recent comparison tell about momentum? Is this person accelerating or slowing?\n" +
        "3. STRONGEST HABIT: Which habit has become a genuine strength and what made it stick?\n" +
        "4. NEXT MONTH: One thing to actively change and one thing to consciously protect"
    };
  }

  function deepPrompt() {
    return {
      system: SYSTEM_PROMPT + " Keep your response under 650 words. Write in sections exactly as instructed.",
      user: buildDeepContext() +
        "\n\nBased on all the pre-computed data above, write a deep insight report with exactly these 6 sections:\n\n" +
        "1. WINS AND LOSSES: Which categories and time windows won or lost this month? Give a ranked commentary — what does the gap between best and worst category tell about this person's lifestyle balance?\n\n" +
        "2. FAVOURITES AND NEGLECTED: Which habits have become automatic (the favourites) and which are being consistently under-served? What does the gap between the top tier and struggling tier reveal about where energy is going?\n\n" +
        "3. CHAIN REACTIONS: From the correlation data, which habits are pulling other habits up with them? Are there any conflict patterns where doing one thing crowds out another? Name the single most important anchor habit and explain why.\n\n" +
        "4. TRENDS AND FLUCTUATIONS: Which habits are clearly rising, which are falling, and which are volatile? Pick the one fluctuation that is most worth paying attention to and explain what it might mean.\n\n" +
        "5. FUTURE OUTLOOK: Based on the 14-day projections, if nothing changes — what improves on its own and what falls further? Where is the single highest-leverage intervention right now to change the trajectory?\n\n" +
        "6. ROOT CAUSES AND FIXES: For the habits with the worst failure patterns — what is the likely real-world reason they fail on those specific days or under high-load conditions? Give one practical, specific suggestion for each of the top two failure habits."
    };
  }

  // ── Groq API ──────────────────────────────────────────────────────────────
  async function callGroq(systemPrompt, userPrompt) {
    const key = groqKey();
    if (!key || key.length < 10) {
      throw new Error("Groq API key not configured — add groqApiKey to system_habits_config.local.js");
    }
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + key
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   }
        ],
        temperature: 0.7,
        max_tokens:  1800
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!res.ok) {
      const text = await res.text().catch(function () { return ""; });
      throw new Error("Groq returned " + res.status + ": " + text.slice(0, 300));
    }

    const data    = await res.json();
    const content = data && data.choices && data.choices[0] &&
                    data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error("Groq returned an empty response.");
    return content.trim();
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  function syncButtons() {
    const canRun = appState.signedIn;
    els.dailyButton.disabled   = !canRun || appState.loading.daily;
    els.weeklyButton.disabled  = !canRun || appState.loading.weekly;
    els.monthlyButton.disabled = !canRun || appState.loading.monthly;
    els.deepButton.disabled    = !canRun || appState.loading.deep;
    els.dailyCopy.hidden   = !els.dailyResult.textContent.trim()   || appState.loading.daily;
    els.weeklyCopy.hidden  = !els.weeklyResult.textContent.trim()  || appState.loading.weekly;
    els.monthlyCopy.hidden = !els.monthlyResult.textContent.trim() || appState.loading.monthly;
    els.deepCopy.hidden    = !els.deepResult.textContent.trim()    || appState.loading.deep;
  }

  const BUTTON_LABELS = {
    daily:   "Generate Daily Analysis",
    weekly:  "Generate Weekly Analysis",
    monthly: "Generate Monthly Analysis",
    deep:    "Generate Deep Analysis"
  };

  function setLoading(type, loading) {
    appState.loading[type] = loading;
    const btn = els[type + "Button"];
    const res = els[type + "Result"];
    if (loading) {
      btn.textContent = "Gemini is thinking…";
      res.className   = "ai-result ai-loading";
      res.textContent = "Analysing your habit data with Groq — usually ready in 2 – 5 seconds.";
    } else {
      btn.textContent = BUTTON_LABELS[type];
    }
    syncButtons();
  }

  function setResult(type, text, isError) {
    const res = els[type + "Result"];
    res.className   = "ai-result" + (isError ? " ai-error" : " ai-done") + (type === "deep" ? " ai-deep" : "");
    res.textContent = text;
    syncButtons();
  }

  async function runAnalysis(type, promptFn) {
    if (appState.loading[type]) return;
    setLoading(type, true);
    try {
      const p    = promptFn();
      const text = await callGroq(p.system, p.user);
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
      const when = meta.lastSyncedAt ? new Date(meta.lastSyncedAt).toLocaleTimeString() : "never";
      els.backendMeta.textContent = "Last synced: " + when +
        ". Analyses read from your live habits and entries data.";
    } else {
      els.backendStatus.textContent = "Not connected";
      els.connectButton.hidden = false;
      els.syncButton.hidden    = true;
      els.signOutButton.hidden = true;
      els.backendMeta.textContent = "Connect Google Sheets to enable AI analysis.";
    }
  });

  // ── Events ────────────────────────────────────────────────────────────────
  els.connectButton.addEventListener("click",  function () { backend.signIn();  });
  els.syncButton.addEventListener("click",     function () { backend.sync();    });
  els.signOutButton.addEventListener("click",  function () { backend.signOut(); });

  els.dailyButton.addEventListener("click",   function () { runAnalysis("daily",   dailyPrompt);   });
  els.weeklyButton.addEventListener("click",  function () { runAnalysis("weekly",  weeklyPrompt);  });
  els.monthlyButton.addEventListener("click", function () { runAnalysis("monthly", monthlyPrompt); });
  els.deepButton.addEventListener("click",    function () { runAnalysis("deep",    deepPrompt);    });

  ["daily", "weekly", "monthly", "deep"].forEach(function (type) {
    els[type + "Copy"].addEventListener("click", function () {
      navigator.clipboard.writeText(els[type + "Result"].textContent).catch(function () {});
    });
  });

  // ── Groq key status indicator ─────────────────────────────────────────────
  if (els.geminiStatus) {
    if (groqKey().length > 10) {
      els.geminiStatus.className = "ai-status ai-status-ready";
      els.geminiStatus.innerHTML =
        '<div class="ai-dot"></div><span>Groq — ' + GROQ_MODEL + ' — API key configured and ready</span>';
    } else {
      els.geminiStatus.className = "ai-status ai-status-offline";
      els.geminiStatus.innerHTML =
        '<div class="ai-dot"></div><span>Groq API key missing — add <code>groqApiKey</code> to system_habits_config.local.js</span>';
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  els.pageDate.textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

})(window, document);
