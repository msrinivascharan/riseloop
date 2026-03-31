(function (window, document) {
  "use strict";

  const googleBackend = window.SystemHabitsBackend;
  const localBackend = window.SystemHabitsBackendLocal || null;
  if (!googleBackend) {
    throw new Error("SystemHabitsBackend is required before loading reports.");
  }

  const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const DAY_LABELS = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday"
  };
  const PERIOD_META = {
    daily: { label: "Daily", count: 14 },
    weekly: { label: "Weekly", count: 12 },
    monthly: { label: "Monthly", count: 12 },
    yearly: { label: "Yearly", count: 5 }
  };
  const TIME_UNIT_META = [
    { pattern: /\b(sec|secs|second|seconds)\b/i, multiplier: 1 / 60 },
    { pattern: /\b(m|min|mins|minute|minutes)\b/i, multiplier: 1 },
    { pattern: /\b(h|hr|hrs|hour|hours)\b/i, multiplier: 60 }
  ];

  const state = {
    charts: [],
    period: "weekly"
  };

  const elements = {
    backendMeta: document.getElementById("backendMeta"),
    backendStatus: document.getElementById("backendStatus"),
    chartSectionCopy: document.getElementById("chartSectionCopy"),
    chartSections: document.getElementById("chartSections"),
    connectButton: document.getElementById("connectButton"),
    emptyReports: document.getElementById("emptyReports"),
    insightGrid: document.getElementById("insightGrid"),
    negativeCorrelationList: document.getElementById("negativeCorrelationList"),
    overviewCopy: document.getElementById("overviewCopy"),
    overviewGrid: document.getElementById("overviewGrid"),
    pageDate: document.getElementById("pageDate"),
    periodTabs: document.getElementById("periodTabs"),
    positiveCorrelationList: document.getElementById("positiveCorrelationList"),
    signOutButton: document.getElementById("signOutButton"),
    syncButton: document.getElementById("syncButton"),
    windowInsights: document.getElementById("windowInsights")
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function slugify(value) {
    return String(value || "item")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "item";
  }

  function roundNumber(value, decimals) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return 0;
    }

    const precision = Number.isInteger(decimals) ? decimals : 2;
    const multiplier = 10 ** precision;
    return Math.round(numericValue * multiplier) / multiplier;
  }

  function clampNumber(value, min, max) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return min;
    }

    return Math.min(max, Math.max(min, numericValue));
  }

  function formatCompactNumber(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return "0";
    }

    const rounded = roundNumber(numericValue, Math.abs(numericValue) >= 100 ? 0 : 2);
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function formatPercent(ratio) {
    return `${Math.round((Number(ratio) || 0) * 100)}%`;
  }

  function formatSignedPercent(ratio) {
    const numericValue = Number(ratio) || 0;
    const prefix = numericValue > 0 ? "+" : "";
    return `${prefix}${Math.round(numericValue * 100)}%`;
  }

  function formatDurationLabel(minutes) {
    const totalMinutes = Math.max(0, Math.round(Number(minutes) || 0));
    if (totalMinutes >= 60) {
      const hours = Math.floor(totalMinutes / 60);
      const remaining = totalMinutes % 60;
      return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
    }

    return `${totalMinutes} min`;
  }

  function formatLongDate(date) {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric"
    });
  }

  function formatDateKey(dateLike) {
    return googleBackend.formatDateKey(dateLike);
  }

  function isFileProtocol() {
    return window.location.protocol === "file:";
  }

  function getLocalHabitCount() {
    return localBackend ? localBackend.listHabits().length : 0;
  }

  function getReadBackend() {
    const status = googleBackend.getStatus();
    if (status.signedIn) {
      return googleBackend;
    }

    if (localBackend && localBackend.listHabits().length > 0) {
      return localBackend;
    }

    return googleBackend;
  }

  function destroyCharts() {
    state.charts.forEach(function (chart) {
      chart.destroy();
    });
    state.charts = [];
  }

  function getDayKey(dateLike) {
    const date = dateLike instanceof Date ? new Date(dateLike.getTime()) : new Date(dateLike);
    const dayIndex = date.getDay();
    return DAY_ORDER[(dayIndex + 6) % 7];
  }

  function isHabitActiveOnDate(habit, dateLike) {
    return Array.isArray(habit.activeDays) && habit.activeDays.includes(getDayKey(dateLike));
  }

  function getTimeUnitMinutesMultiplier(unit) {
    const normalized = String(unit || "").trim();
    const match = TIME_UNIT_META.find(function (item) {
      return item.pattern.test(normalized);
    });
    return match ? match.multiplier : null;
  }

  function habitValueToMinutes(habit, value) {
    const multiplier = getTimeUnitMinutesMultiplier(habit && habit.unit);
    if (!multiplier) {
      return 0;
    }

    return Math.max(0, (Number(value) || 0) * multiplier);
  }

  function getHabitDailyTargetValue(backend, habit) {
    if (!habit) {
      return 0;
    }

    if (backend && typeof backend.getHabitDailyTarget === "function") {
      const dailyTarget = Number(backend.getHabitDailyTarget(habit));
      return Number.isFinite(dailyTarget) && dailyTarget > 0 ? dailyTarget : 0;
    }

    const fallbackTarget = Number(habit.target);
    return Number.isFinite(fallbackTarget) && fallbackTarget > 0 ? fallbackTarget : 0;
  }

  function parseTimeToMinutes(value) {
    const parts = String(value || "").split(":");
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return 0;
    }

    return (hours * 60) + minutes;
  }

  function getWindowKey(windowStart, windowEnd) {
    if (!windowStart || !windowEnd || windowStart >= windowEnd) {
      return "";
    }

    return `${windowStart}-${windowEnd}`;
  }

  function addDays(dateLike, days) {
    const date = dateLike instanceof Date ? new Date(dateLike.getTime()) : new Date(dateLike);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return date;
  }

  function startOfDay(dateLike) {
    const date = dateLike instanceof Date ? new Date(dateLike.getTime()) : new Date(dateLike);
    date.setHours(12, 0, 0, 0);
    return date;
  }

  function startOfWeek(dateLike) {
    const date = startOfDay(dateLike);
    return addDays(date, -((date.getDay() + 6) % 7));
  }

  function startOfMonth(dateLike) {
    const date = dateLike instanceof Date ? new Date(dateLike.getTime()) : new Date(dateLike);
    return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
  }

  function startOfYear(dateLike) {
    const date = dateLike instanceof Date ? new Date(dateLike.getTime()) : new Date(dateLike);
    return new Date(date.getFullYear(), 0, 1, 12, 0, 0, 0);
  }

  function enumerateDates(startDate, endDate) {
    const dates = [];
    let cursor = startOfDay(startDate);
    const last = startOfDay(endDate);

    while (cursor.getTime() <= last.getTime()) {
      dates.push(new Date(cursor.getTime()));
      cursor = addDays(cursor, 1);
    }

    return dates;
  }

  function buildPeriodBuckets(period, anchorDate) {
    const today = startOfDay(anchorDate || new Date());
    const buckets = [];
    let index;

    if (period === "daily") {
      for (index = PERIOD_META.daily.count - 1; index >= 0; index -= 1) {
        const day = addDays(today, -index);
        buckets.push({
          key: formatDateKey(day),
          label: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          dates: [day]
        });
      }
      return buckets;
    }

    if (period === "weekly") {
      const thisWeekStart = startOfWeek(today);
      for (index = PERIOD_META.weekly.count - 1; index >= 0; index -= 1) {
        const start = addDays(thisWeekStart, -(index * 7));
        const end = addDays(start, 6);
        buckets.push({
          key: formatDateKey(start),
          label: `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
          dates: enumerateDates(start, end)
        });
      }
      return buckets;
    }

    if (period === "monthly") {
      const thisMonthStart = startOfMonth(today);
      for (index = PERIOD_META.monthly.count - 1; index >= 0; index -= 1) {
        const start = new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth() - index, 1, 12, 0, 0, 0);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 12, 0, 0, 0);
        buckets.push({
          key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
          label: start.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
          dates: enumerateDates(start, end)
        });
      }
      return buckets;
    }

    const thisYearStart = startOfYear(today);
    for (index = PERIOD_META.yearly.count - 1; index >= 0; index -= 1) {
      const year = thisYearStart.getFullYear() - index;
      const start = new Date(year, 0, 1, 12, 0, 0, 0);
      const end = new Date(year, 11, 31, 12, 0, 0, 0);
      buckets.push({
        key: String(year),
        label: String(year),
        dates: enumerateDates(start, end)
      });
    }
    return buckets;
  }

  function buildLastNDates(count, anchorDate) {
    const dates = [];
    const end = startOfDay(anchorDate || new Date());
    let offset;
    for (offset = count - 1; offset >= 0; offset -= 1) {
      dates.push(addDays(end, -offset));
    }
    return dates;
  }

  function buildEntryIndex(entries) {
    const index = new Map();
    entries.forEach(function (entry) {
      index.set(`${entry.habitId}::${entry.dateKey}`, entry);
    });
    return index;
  }

  function getEntryForDate(entryIndex, habitId, dateLike) {
    return entryIndex.get(`${habitId}::${formatDateKey(dateLike)}`) || null;
  }

  function getProgressForDate(backend, entryIndex, habit, dateLike) {
    return backend.getHabitProgress(habit, getEntryForDate(entryIndex, habit.id, dateLike));
  }

  function average(values) {
    const filtered = values.filter(function (value) {
      return Number.isFinite(value);
    });

    if (!filtered.length) {
      return 0;
    }

    return filtered.reduce(function (sum, value) {
      return sum + value;
    }, 0) / filtered.length;
  }

  function buildDailyScoreSeries(backend, habits, entryIndex, dates) {
    return dates.map(function (date) {
      const activeHabits = habits.filter(function (habit) {
        return isHabitActiveOnDate(habit, date);
      });

      if (!activeHabits.length) {
        return {
          date: date,
          score: null
        };
      }

      const totalProgress = activeHabits.reduce(function (sum, habit) {
        return sum + getProgressForDate(backend, entryIndex, habit, date).progressRatio;
      }, 0);

      return {
        date: date,
        score: totalProgress / activeHabits.length
      };
    });
  }

  function buildHabitWindowText(habit) {
    return `${habit.windowStart} - ${habit.windowEnd}`;
  }

  function groupHabitsByCategory(habits) {
    const groups = new Map();
    habits.forEach(function (habit) {
      const category = String(habit.category || "General").trim() || "General";
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category).push(habit);
    });

    return Array.from(groups.entries())
      .map(function (entry) {
        return {
          category: entry[0],
          habits: entry[1].slice().sort(function (left, right) {
            if (left.windowStart !== right.windowStart) {
              return left.windowStart.localeCompare(right.windowStart);
            }
            if (left.windowEnd !== right.windowEnd) {
              return left.windowEnd.localeCompare(right.windowEnd);
            }
            return left.name.localeCompare(right.name);
          })
        };
      })
      .sort(function (left, right) {
        return left.category.localeCompare(right.category);
      });
  }

  function buildHabitSeries(backend, habit, entryIndex, buckets) {
    const series = buckets.map(function (bucket) {
      let actual = 0;
      let target = 0;
      let progressSum = 0;
      let activeDays = 0;

      bucket.dates.forEach(function (date) {
        if (!isHabitActiveOnDate(habit, date)) {
          return;
        }

        activeDays += 1;
        const entry = getEntryForDate(entryIndex, habit.id, date);
        const progress = backend.getHabitProgress(habit, entry);
        progressSum += progress.progressRatio;

        if (habit.type === "checkbox") {
          target += 1;
          actual += progress.complete ? 1 : 0;
          return;
        }

        target += getHabitDailyTargetValue(backend, habit);
        const numericValue = Number(entry && entry.value);
        actual += Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
      });

      return {
        key: bucket.key,
        label: bucket.label,
        actual: roundNumber(actual, 2),
        target: roundNumber(target, 2),
        activeDays: activeDays,
        avgProgress: activeDays ? progressSum / activeDays : 0
      };
    });

    const totalActual = series.reduce(function (sum, bucket) {
      return sum + bucket.actual;
    }, 0);
    const totalTarget = series.reduce(function (sum, bucket) {
      return sum + bucket.target;
    }, 0);
    const averageProgress = average(series.map(function (bucket) {
      return bucket.activeDays ? bucket.avgProgress : null;
    }));

    return {
      averageProgress: averageProgress,
      series: series,
      totalActual: roundNumber(totalActual, 2),
      totalTarget: roundNumber(totalTarget, 2),
      hitRate: totalTarget > 0 ? totalActual / totalTarget : averageProgress
    };
  }

  function buildHabitMetrics(backend, habits, entryIndex, dates) {
    return habits.map(function (habit) {
      let activeDays = 0;
      let totalProgress = 0;
      let doneDays = 0;
      let totalActual = 0;
      let totalTarget = 0;

      dates.forEach(function (date) {
        if (!isHabitActiveOnDate(habit, date)) {
          return;
        }

        activeDays += 1;
        const entry = getEntryForDate(entryIndex, habit.id, date);
        const progress = backend.getHabitProgress(habit, entry);
        totalProgress += progress.progressRatio;
        if (progress.complete) {
          doneDays += 1;
        }

        if (habit.type === "checkbox") {
          totalActual += progress.complete ? 1 : 0;
          totalTarget += 1;
        } else {
          totalTarget += getHabitDailyTargetValue(backend, habit);
          const numericValue = Number(entry && entry.value);
          totalActual += Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
        }
      });

      return {
        habit: habit,
        activeDays: activeDays,
        averageProgress: activeDays ? totalProgress / activeDays : 0,
        consistency: activeDays ? doneDays / activeDays : 0,
        totalActual: roundNumber(totalActual, 2),
        totalTarget: roundNumber(totalTarget, 2)
      };
    }).filter(function (metric) {
      return metric.activeDays > 0;
    });
  }

  function pearsonCorrelation(leftValues, rightValues) {
    const pairs = [];
    let index;

    for (index = 0; index < leftValues.length; index += 1) {
      const left = leftValues[index];
      const right = rightValues[index];
      if (Number.isFinite(left) && Number.isFinite(right)) {
        pairs.push([left, right]);
      }
    }

    if (pairs.length < 8) {
      return null;
    }

    const leftAverage = average(pairs.map(function (pair) { return pair[0]; }));
    const rightAverage = average(pairs.map(function (pair) { return pair[1]; }));
    let numerator = 0;
    let leftSpread = 0;
    let rightSpread = 0;

    pairs.forEach(function (pair) {
      const leftDelta = pair[0] - leftAverage;
      const rightDelta = pair[1] - rightAverage;
      numerator += leftDelta * rightDelta;
      leftSpread += leftDelta * leftDelta;
      rightSpread += rightDelta * rightDelta;
    });

    if (!leftSpread || !rightSpread) {
      return null;
    }

    return {
      overlap: pairs.length,
      score: numerator / Math.sqrt(leftSpread * rightSpread)
    };
  }

  function buildCorrelationInsights(backend, habits, entryIndex, dates) {
    const vectors = habits.map(function (habit) {
      return {
        habit: habit,
        values: dates.map(function (date) {
          if (!isHabitActiveOnDate(habit, date)) {
            return null;
          }

          return getProgressForDate(backend, entryIndex, habit, date).progressRatio;
        })
      };
    });

    const pairs = [];
    let leftIndex;
    let rightIndex;
    for (leftIndex = 0; leftIndex < vectors.length; leftIndex += 1) {
      for (rightIndex = leftIndex + 1; rightIndex < vectors.length; rightIndex += 1) {
        const correlation = pearsonCorrelation(vectors[leftIndex].values, vectors[rightIndex].values);
        if (!correlation) {
          continue;
        }

        pairs.push({
          leftHabit: vectors[leftIndex].habit,
          rightHabit: vectors[rightIndex].habit,
          overlap: correlation.overlap,
          score: correlation.score
        });
      }
    }

    return {
      positive: pairs.filter(function (pair) { return pair.score >= 0.2; }).sort(function (left, right) {
        return right.score - left.score;
      }).slice(0, 6),
      negative: pairs.filter(function (pair) { return pair.score <= -0.15; }).sort(function (left, right) {
        return left.score - right.score;
      }).slice(0, 6)
    };
  }

  function buildWindowInsights(habits, entryIndex, dates) {
    const grouped = new Map();

    habits.forEach(function (habit) {
      if (habit.type !== "measurable" || !getTimeUnitMinutesMultiplier(habit.unit)) {
        return;
      }

      const windowKey = getWindowKey(habit.windowStart, habit.windowEnd);
      if (!windowKey) {
        return;
      }

      if (!grouped.has(windowKey)) {
        grouped.set(windowKey, {
          windowKey: windowKey,
          windowStart: habit.windowStart,
          windowEnd: habit.windowEnd,
          habits: []
        });
      }

      grouped.get(windowKey).habits.push(habit);
    });

    return Array.from(grouped.values()).map(function (group) {
      const windowDuration = Math.max(0, parseTimeToMinutes(group.windowEnd) - parseTimeToMinutes(group.windowStart));
      let activeWindowDays = 0;
      let plannedMinutes = 0;
      let loggedMinutes = 0;

      dates.forEach(function (date) {
        const activeHabits = group.habits.filter(function (habit) {
          return isHabitActiveOnDate(habit, date);
        });

        if (!activeHabits.length) {
          return;
        }

        activeWindowDays += 1;
        activeHabits.forEach(function (habit) {
          plannedMinutes += habitValueToMinutes(habit, Number(habit.target) || 0);
          const entry = getEntryForDate(entryIndex, habit.id, date);
          const numericValue = Number(entry && entry.value);
          if (Number.isFinite(numericValue) && numericValue > 0) {
            loggedMinutes += habitValueToMinutes(habit, numericValue);
          }
        });
      });

      const capacityMinutes = activeWindowDays * windowDuration;
      const unloggedMinutes = Math.max(0, plannedMinutes - loggedMinutes);
      const spareCapacityMinutes = Math.max(0, capacityMinutes - loggedMinutes);
      const targetHitRate = plannedMinutes > 0 ? loggedMinutes / plannedMinutes : 0;
      const capacityPressure = capacityMinutes > 0 ? plannedMinutes / capacityMinutes : 0;

      return {
        activeWindowDays: activeWindowDays,
        capacityMinutes: capacityMinutes,
        capacityPressure: capacityPressure,
        habits: group.habits,
        loggedMinutes: loggedMinutes,
        plannedMinutes: plannedMinutes,
        spareCapacityMinutes: spareCapacityMinutes,
        targetHitRate: targetHitRate,
        unloggedMinutes: unloggedMinutes,
        windowKey: group.windowKey,
        windowStart: group.windowStart,
        windowEnd: group.windowEnd,
        windowDuration: windowDuration
      };
    }).sort(function (left, right) {
      if (left.windowStart !== right.windowStart) {
        return left.windowStart.localeCompare(right.windowStart);
      }
      return left.windowEnd.localeCompare(right.windowEnd);
    });
  }

  function buildAnalytics(backend) {
    const snapshot = backend.getStateSnapshot();
    const habits = backend.listHabits();
    const entries = snapshot.entries || [];
    const trackedDateKeys = Array.from(new Set(entries.map(function (entry) {
      return entry.dateKey;
    }))).sort();
    const entryIndex = buildEntryIndex(entries);
    const now = new Date();
    const last30Dates = buildLastNDates(30, now);
    const last60Dates = buildLastNDates(60, now);
    const last90Dates = buildLastNDates(90, now);
    const recent14Dates = buildLastNDates(14, now);
    const previous14Dates = buildLastNDates(28, now).slice(0, 14);
    const dailyScore30 = buildDailyScoreSeries(backend, habits, entryIndex, last30Dates);
    const dailyScore90 = buildDailyScoreSeries(backend, habits, entryIndex, last90Dates);
    const recentScore14 = buildDailyScoreSeries(backend, habits, entryIndex, recent14Dates);
    const previousScore14 = buildDailyScoreSeries(backend, habits, entryIndex, previous14Dates);
    const metrics30 = buildHabitMetrics(backend, habits, entryIndex, last30Dates);
    const recentMetrics = buildHabitMetrics(backend, habits, entryIndex, recent14Dates);
    const previousMetrics = buildHabitMetrics(backend, habits, entryIndex, previous14Dates);
    const categoryGroups = groupHabitsByCategory(habits);
    const correlations = buildCorrelationInsights(backend, habits, entryIndex, last90Dates);
    const windows = buildWindowInsights(habits, entryIndex, last30Dates);
    const average30 = average(dailyScore30.map(function (item) { return item.score; }));
    const recentAverage = average(recentScore14.map(function (item) { return item.score; }));
    const previousAverage = average(previousScore14.map(function (item) { return item.score; }));
    const measurableMinutes30 = metrics30.reduce(function (sum, metric) {
      if (metric.habit.type !== "measurable" || !getTimeUnitMinutesMultiplier(metric.habit.unit)) {
        return sum;
      }
      return sum + habitValueToMinutes(metric.habit, metric.totalActual);
    }, 0);

    const strongestCategory = (function () {
      const categoryIndex = new Map();
      metrics30.forEach(function (metric) {
        const key = metric.habit.category || "General";
        if (!categoryIndex.has(key)) {
          categoryIndex.set(key, []);
        }
        categoryIndex.get(key).push(metric.averageProgress);
      });

      return Array.from(categoryIndex.entries()).map(function (entry) {
        return {
          category: entry[0],
          averageProgress: average(entry[1])
        };
      }).sort(function (left, right) {
        return right.averageProgress - left.averageProgress;
      })[0] || null;
    })();

    const mostReliableHabit = metrics30.slice().sort(function (left, right) {
      if (right.averageProgress !== left.averageProgress) {
        return right.averageProgress - left.averageProgress;
      }
      return right.activeDays - left.activeDays;
    })[0] || null;

    const growthPocket = (function () {
      const previousIndex = new Map(previousMetrics.map(function (metric) {
        return [metric.habit.id, metric];
      }));

      return recentMetrics.map(function (metric) {
        const previousMetric = previousIndex.get(metric.habit.id);
        return {
          habit: metric.habit,
          delta: metric.averageProgress - (previousMetric ? previousMetric.averageProgress : 0),
          recent: metric.averageProgress,
          previous: previousMetric ? previousMetric.averageProgress : 0
        };
      }).sort(function (left, right) {
        return right.delta - left.delta;
      })[0] || null;
    })();

    const bestDayRhythm = (function () {
      const days = new Map(DAY_ORDER.map(function (dayKey) {
        return [dayKey, []];
      }));
      dailyScore90.forEach(function (item) {
        if (!Number.isFinite(item.score)) {
          return;
        }
        days.get(getDayKey(item.date)).push(item.score);
      });

      return Array.from(days.entries()).map(function (entry) {
        return {
          dayKey: entry[0],
          averageScore: average(entry[1])
        };
      }).sort(function (left, right) {
        return right.averageScore - left.averageScore;
      })[0] || null;
    })();

    return {
      categoryGroups: categoryGroups,
      correlations: correlations,
      dailyScore30: dailyScore30,
      entryIndex: entryIndex,
      growthPocket: growthPocket,
      habits: habits,
      measurableMinutes30: measurableMinutes30,
      mostReliableHabit: mostReliableHabit,
      momentumDelta: recentAverage - previousAverage,
      average30: average30,
      scores90: dailyScore90,
      strongestCategory: strongestCategory,
      trackedDateKeys: trackedDateKeys,
      windows: windows,
      bestDayRhythm: bestDayRhythm
    };
  }

  function renderStatus() {
    const status = googleBackend.getStatus();
    const meta = googleBackend.getMeta();
    const localHabitCount = getLocalHabitCount();
    const usingLocalFallback = !status.signedIn && localHabitCount > 0;
    const today = new Date();

    elements.pageDate.textContent = formatLongDate(today);

    if (!status.configured) {
      elements.backendStatus.textContent = "Google Sheets config missing";
      elements.backendMeta.textContent = "Add apiKey, spreadsheetId, and clientId in system_habits_config.local.js to unlock the Google Sheets backend.";
    } else if (isFileProtocol() && usingLocalFallback) {
      elements.backendStatus.textContent = "Local backup mode";
      elements.backendMeta.textContent = `Showing ${localHabitCount} habits from browser storage. Google sign-in requires http://localhost rather than file://.`;
    } else if (isFileProtocol()) {
      elements.backendStatus.textContent = "Local mode only";
      elements.backendMeta.textContent = "Open this page through http://localhost to connect Google Sheets and load the shared backend.";
    } else if (status.error) {
      elements.backendStatus.textContent = "Google Sheets needs attention";
      elements.backendMeta.textContent = status.error;
    } else if (usingLocalFallback) {
      elements.backendStatus.textContent = "Showing local backup";
      elements.backendMeta.textContent = `Your browser still has ${localHabitCount} local habits. Connect Google Sheets to switch these reports over to StudioHabits and StudioEntries.`;
    } else if (status.syncing) {
      elements.backendStatus.textContent = "Syncing Google Sheets";
      elements.backendMeta.textContent = `${meta.sheets.habits} and ${meta.sheets.entries} are syncing now.`;
    } else if (!status.ready) {
      elements.backendStatus.textContent = "Preparing Google Sheets";
      elements.backendMeta.textContent = "Waiting for the Google API and sign-in client to finish loading.";
    } else if (!status.signedIn) {
      elements.backendStatus.textContent = "Google Sheets not connected";
      elements.backendMeta.textContent = `Connect to load the live ${meta.sheets.habits} and ${meta.sheets.entries} tabs from your spreadsheet.`;
    } else {
      const syncText = meta.lastSyncedAt ? `Last sync ${new Date(meta.lastSyncedAt).toLocaleString("en-US")}.` : "Connected and ready.";
      elements.backendStatus.textContent = "Google Sheets connected";
      elements.backendMeta.textContent = `${meta.sheets.habits} and ${meta.sheets.entries}. ${syncText}`;
    }

    elements.connectButton.disabled = isFileProtocol() || !status.configured || !status.ready || status.signedIn || status.syncing;
    elements.syncButton.disabled = isFileProtocol() || !status.signedIn || status.syncing;
    elements.signOutButton.disabled = !status.signedIn || status.syncing;
  }

  function renderOverview(analytics) {
    const uniqueCategories = new Set(analytics.habits.map(function (habit) {
      return habit.category || "General";
    }));
    const uniqueWindows = new Set(analytics.habits.map(function (habit) {
      return getWindowKey(habit.windowStart, habit.windowEnd);
    }).filter(Boolean));
    const cards = [
      {
        label: "Master habits",
        value: analytics.habits.length,
        copy: "The current size of your active system."
      },
      {
        label: "Categories",
        value: uniqueCategories.size,
        copy: "How many life domains are represented right now."
      },
      {
        label: "Tracked days",
        value: analytics.trackedDateKeys.length,
        copy: "Unique dates with at least one saved entry."
      },
      {
        label: "30-day score",
        value: formatPercent(analytics.average30),
        copy: "Average daily execution quality over the last 30 days."
      },
      {
        label: "Primary windows",
        value: uniqueWindows.size,
        copy: "Unique habit windows in the current master list."
      },
      {
        label: "Logged time",
        value: formatDurationLabel(analytics.measurableMinutes30),
        copy: "Time captured from measurable, time-based habits in the last 30 days."
      }
    ];

    elements.overviewGrid.innerHTML = cards.map(function (card) {
      return `
        <article class="metric-card">
          <div class="metric-label">${escapeHtml(card.label)}</div>
          <div class="metric-value">${escapeHtml(String(card.value))}</div>
          <div class="metric-copy">${escapeHtml(card.copy)}</div>
        </article>
      `;
    }).join("");

    elements.overviewCopy.textContent = `These summary cards cover ${analytics.trackedDateKeys.length || 0} tracked days and your current live system shape.`;
    elements.chartSectionCopy.textContent = `${PERIOD_META[state.period].label} bars for each habit, grouped by category. Bars show actual output and the line shows the target for that period.`;
  }

  function renderInsights(analytics) {
    const strongestNegative = analytics.correlations.negative[0] || null;
    const cards = [
      {
        chip: "Momentum",
        title: analytics.momentumDelta >= 0 ? "Recent momentum is improving" : "Recent momentum is softer",
        copy: `Your last 14 days are ${formatSignedPercent(analytics.momentumDelta)} versus the 14 days before that.`
      },
      {
        chip: "Reliability",
        title: analytics.mostReliableHabit ? analytics.mostReliableHabit.habit.name : "Not enough data yet",
        copy: analytics.mostReliableHabit
          ? `${formatPercent(analytics.mostReliableHabit.averageProgress)} average execution over ${analytics.mostReliableHabit.activeDays} active days in the last 30 days.`
          : "Log a few more days and this card will identify your most dependable habit."
      },
      {
        chip: "Growth pocket",
        title: analytics.growthPocket ? analytics.growthPocket.habit.name : "Not enough data yet",
        copy: analytics.growthPocket
          ? `${formatSignedPercent(analytics.growthPocket.delta)} versus the previous 14-day block. A good place to protect and compound.`
          : "This card will surface the fastest improver once more history builds up."
      },
      {
        chip: "Best rhythm",
        title: analytics.bestDayRhythm ? DAY_LABELS[analytics.bestDayRhythm.dayKey] : "Not enough data yet",
        copy: analytics.bestDayRhythm
          ? `${formatPercent(analytics.bestDayRhythm.averageScore)} average score. This looks like your strongest weekly rhythm pocket.`
          : "Daily rhythm needs more tracked days before it becomes meaningful."
      },
      {
        chip: "Strongest category",
        title: analytics.strongestCategory ? analytics.strongestCategory.category : "Not enough data yet",
        copy: analytics.strongestCategory
          ? `${formatPercent(analytics.strongestCategory.averageProgress)} average execution across the last 30 days.`
          : "As categories fill up, this will show where your system is currently strongest."
      },
      {
        chip: "Tradeoff watch",
        title: strongestNegative ? `${strongestNegative.leftHabit.name} vs ${strongestNegative.rightHabit.name}` : "No strong tradeoff signal yet",
        copy: strongestNegative
          ? `${formatSignedPercent(strongestNegative.score)} correlation across ${strongestNegative.overlap} overlapping days. This may be a timing or energy conflict worth investigating.`
          : "Nothing strongly negative stands out yet, which usually means your current system is not obviously cannibalizing itself."
      }
    ];

    elements.insightGrid.innerHTML = cards.map(function (card) {
      return `
        <article class="insight-card">
          <div class="insight-chip">${escapeHtml(card.chip)}</div>
          <strong>${escapeHtml(card.title)}</strong>
          <div class="insight-copy">${escapeHtml(card.copy)}</div>
        </article>
      `;
    }).join("");
  }

  function renderCorrelationList(container, pairs, emptyText, tone) {
    if (!pairs.length) {
      container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
      return;
    }

    container.innerHTML = pairs.map(function (pair) {
      return `
        <article class="insight-card correlation-item">
          <div class="correlation-chip">${escapeHtml(pair.leftHabit.category)} · ${escapeHtml(pair.rightHabit.category)}</div>
          <strong>${escapeHtml(pair.leftHabit.name)} and ${escapeHtml(pair.rightHabit.name)}</strong>
          <div class="correlation-score">${escapeHtml(formatSignedPercent(pair.score))}</div>
          <div class="correlation-copy">
            ${tone === "positive" ? "These habits tend to rise together." : "These habits tend to move in opposite directions."}
            Based on ${pair.overlap} overlapping active days.
          </div>
        </article>
      `;
    }).join("");
  }

  function renderWindows(analytics) {
    if (!analytics.windows.length) {
      elements.windowInsights.innerHTML = '<div class="empty-state">No time-based measurable windows exist yet. Add habits with time units like minutes or hours to unlock window intelligence.</div>';
      return;
    }

    elements.windowInsights.innerHTML = analytics.windows.map(function (windowInsight) {
      const progressWidth = `${Math.round(clampNumber(windowInsight.targetHitRate, 0, 1.4) * 100)}%`;
      const pressureCopy = windowInsight.capacityMinutes > 0
        ? `${formatPercent(windowInsight.capacityPressure)} planned versus window capacity`
        : "No capacity signal yet";

      return `
        <article class="window-card">
          <div class="window-chip">${escapeHtml(windowInsight.windowStart)} - ${escapeHtml(windowInsight.windowEnd)}</div>
          <strong>${windowInsight.habits.length} time-based habit${windowInsight.habits.length === 1 ? "" : "s"}</strong>
          <div class="window-copy">
            Planned ${escapeHtml(formatDurationLabel(windowInsight.plannedMinutes))} · Logged ${escapeHtml(formatDurationLabel(windowInsight.loggedMinutes))} · Unlogged ${escapeHtml(formatDurationLabel(windowInsight.unloggedMinutes))}
          </div>
          <div class="mini-progress" style="margin-top:14px;"><span style="width:${escapeHtml(progressWidth)};"></span></div>
          <div class="window-copy">
            ${escapeHtml(formatPercent(windowInsight.targetHitRate))} target hit rate · ${escapeHtml(pressureCopy)} · ${escapeHtml(formatDurationLabel(windowInsight.spareCapacityMinutes))} spare window time left across the last 30 days.
          </div>
        </article>
      `;
    }).join("");
  }

  function renderChartSections(backend, analytics) {
    destroyCharts();

    if (!analytics.habits.length) {
      elements.emptyReports.hidden = false;
      elements.chartSections.innerHTML = "";
      return;
    }

    elements.emptyReports.hidden = true;
    const buckets = buildPeriodBuckets(state.period, new Date());
    const categoryGroups = analytics.categoryGroups;

    elements.chartSections.innerHTML = categoryGroups.map(function (group) {
      const categoryId = `category-${slugify(group.category)}`;
      const cardsHtml = group.habits.map(function (habit) {
        const chartId = `chart-${slugify(group.category)}-${slugify(habit.id)}`;
        const stats = buildHabitSeries(backend, habit, analytics.entryIndex, buckets);
        const unitLabel = habit.type === "measurable"
          ? (habit.unit || "units")
          : "completions";

        return `
          <article class="chart-card">
            <div class="chart-card-head">
              <div>
                <h3>${escapeHtml(habit.name)}</h3>
                <div class="chart-copy">${escapeHtml(buildHabitWindowText(habit))} · ${escapeHtml(habit.type === "measurable" ? `${formatCompactNumber(getHabitDailyTargetValue(backend, habit))} ${unitLabel} / active day` : "checkbox habit")}</div>
              </div>
              <div class="chart-chip">${escapeHtml(PERIOD_META[state.period].label)}</div>
            </div>
            <div class="chart-stats">
              <div class="chart-stat">
                <div class="mini-label">Actual</div>
                <strong>${escapeHtml(formatCompactNumber(stats.totalActual))}</strong>
              </div>
              <div class="chart-stat">
                <div class="mini-label">Target</div>
                <strong>${escapeHtml(formatCompactNumber(stats.totalTarget))}</strong>
              </div>
              <div class="chart-stat">
                <div class="mini-label">Hit rate</div>
                <strong>${escapeHtml(formatPercent(stats.hitRate))}</strong>
              </div>
            </div>
            <canvas id="${escapeHtml(chartId)}"></canvas>
          </article>
        `;
      }).join("");

      return `
        <details class="category-panel" open>
          <summary class="category-summary">
            <div>
              <strong>${escapeHtml(group.category)}</strong>
              <span>${group.habits.length} habit${group.habits.length === 1 ? "" : "s"} in this category</span>
            </div>
            <div class="category-toggle">
              <span class="when-closed">+</span>
              <span class="when-open">-</span>
            </div>
          </summary>
          <div class="category-body" id="${escapeHtml(categoryId)}">
            <div class="report-grid">${cardsHtml}</div>
          </div>
        </details>
      `;
    }).join("");

    categoryGroups.forEach(function (group) {
      group.habits.forEach(function (habit) {
        const chartId = `chart-${slugify(group.category)}-${slugify(habit.id)}`;
        const chartNode = document.getElementById(chartId);
        if (!chartNode || !window.Chart) {
          return;
        }

        const series = buildHabitSeries(backend, habit, analytics.entryIndex, buckets);
        const chart = new window.Chart(chartNode.getContext("2d"), {
          type: "bar",
          data: {
            labels: series.series.map(function (bucket) { return bucket.label; }),
            datasets: [
              {
                type: "bar",
                label: "Actual",
                data: series.series.map(function (bucket) { return bucket.actual; }),
                backgroundColor: "rgba(100, 159, 125, 0.62)",
                borderColor: "rgba(63, 117, 89, 0.95)",
                borderWidth: 1,
                borderRadius: 8
              },
              {
                type: "line",
                label: "Target",
                data: series.series.map(function (bucket) { return bucket.target; }),
                borderColor: "rgba(245, 187, 134, 0.98)",
                backgroundColor: "rgba(245, 187, 134, 0.18)",
                borderDash: [6, 6],
                borderWidth: 2,
                fill: false,
                tension: 0.24,
                pointRadius: 2
              }
            ]
          },
          options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: "#718076" }
              },
              y: {
                beginAtZero: true,
                grid: { color: "rgba(91, 112, 95, 0.12)" },
                ticks: { color: "#718076" }
              }
            },
            plugins: {
              legend: {
                labels: { color: "#203128", boxWidth: 12, usePointStyle: true }
              },
              tooltip: {
                backgroundColor: "rgba(32, 49, 40, 0.92)",
                padding: 12,
                displayColors: true
              }
            }
          }
        });
        state.charts.push(chart);
      });
    });
  }

  function renderPeriodTabs() {
    elements.periodTabs.querySelectorAll("[data-period]").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-period") === state.period);
    });
  }

  function renderAll() {
    renderStatus();
    renderPeriodTabs();

    const backend = getReadBackend();
    const analytics = buildAnalytics(backend);

    renderOverview(analytics);
    renderInsights(analytics);
    renderCorrelationList(
      elements.positiveCorrelationList,
      analytics.correlations.positive,
      "No strong positive pairings stand out yet. Once more history accumulates, this section will show habits that tend to reinforce each other.",
      "positive"
    );
    renderCorrelationList(
      elements.negativeCorrelationList,
      analytics.correlations.negative,
      "No meaningful negative tradeoff signal stands out yet.",
      "negative"
    );
    renderWindows(analytics);
    renderChartSections(backend, analytics);
  }

  async function handleConnect() {
    try {
      await googleBackend.signIn();
    } catch (error) {
      window.alert(error && error.message ? error.message : "Could not connect Google Sheets.");
    }
  }

  async function handleSync() {
    try {
      await googleBackend.sync();
    } catch (error) {
      window.alert(error && error.message ? error.message : "Could not sync Google Sheets.");
    }
  }

  function bindEvents() {
    elements.connectButton.addEventListener("click", handleConnect);
    elements.syncButton.addEventListener("click", handleSync);
    elements.signOutButton.addEventListener("click", function () {
      googleBackend.signOut();
      renderAll();
    });

    elements.periodTabs.addEventListener("click", function (event) {
      const button = event.target.closest("[data-period]");
      if (!button) {
        return;
      }

      state.period = button.getAttribute("data-period") || "weekly";
      renderAll();
    });

    googleBackend.subscribe(function () {
      renderAll();
    });
  }

  async function initializeReports() {
    bindEvents();
    renderAll();

    try {
      await googleBackend.initialize();
    } catch (error) {
      console.error(error);
    }

    renderAll();
  }

  initializeReports();
})(window, document);



