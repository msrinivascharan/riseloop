(function (window) {
  "use strict";

  const STORAGE_KEY = "system-habits-studio-v1";
  const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const ENTRY_STATUS = ["pending", "done", "skipped", "logged"];

  function formatDateKey(dateLike) {
    const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function createEmptyState() {
    return {
      habits: [],
      entries: [],
      meta: {
        backend: "localStorage",
        storageKey: STORAGE_KEY,
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
  }

  function normalizeTime(value, fallback) {
    const candidate = String(value || fallback || "").trim();
    if (/^\d{2}:\d{2}$/.test(candidate)) {
      return candidate;
    }
    return fallback || "07:00";
  }

  function normalizeDays(days) {
    const source = Array.isArray(days) ? days : DAY_ORDER;
    const normalized = source
      .map((day) => String(day || "").trim().toLowerCase().slice(0, 3))
      .filter((day, index, list) => DAY_ORDER.includes(day) && list.indexOf(day) === index);

    return DAY_ORDER.filter((day) => normalized.includes(day));
  }

  function normalizeWindowKey(windowKey) {
    const parts = String(windowKey || "").split("-");
    const windowStart = normalizeTime(parts[0], "");
    const windowEnd = normalizeTime(parts[1], "");
    if (!windowStart || !windowEnd || windowStart >= windowEnd) {
      return "";
    }

    return `${windowStart}-${windowEnd}`;
  }

  function normalizeRepeatWindows(repeatWindows, primaryWindowKey) {
    const source = Array.isArray(repeatWindows)
      ? repeatWindows
      : String(repeatWindows || "")
          .split("|")
          .map((windowKey) => windowKey.trim())
          .filter(Boolean);

    return source
      .map(normalizeWindowKey)
      .filter((windowKey, index, list) => windowKey && windowKey !== primaryWindowKey && list.indexOf(windowKey) === index)
      .sort();
  }

  function normalizeTarget(target) {
    const numeric = Number(target);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
    return 1;
  }

  function normalizeRepeatWindowTargets(repeatWindowTargets, repeatWindows, type) {
    if (type !== "measurable") {
      return {};
    }

    let source = repeatWindowTargets;
    if (typeof source === "string") {
      const trimmed = source.trim();
      if (!trimmed) {
        source = {};
      } else {
        try {
          source = JSON.parse(trimmed);
        } catch (error) {
          source = {};
        }
      }
    }

    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return {};
    }

    return (repeatWindows || []).reduce(function (targets, windowKey) {
      const numericValue = Number(source[windowKey]);
      if (Number.isFinite(numericValue) && numericValue > 0) {
        targets[windowKey] = normalizeTarget(numericValue);
      }
      return targets;
    }, {});
  }

  function normalizeEntryWindowAllocations(windowAllocations) {
    let source = windowAllocations;
    if (typeof source === "string") {
      const trimmed = source.trim();
      if (!trimmed) {
        source = {};
      } else {
        try {
          source = JSON.parse(trimmed);
        } catch (error) {
          source = {};
        }
      }
    }

    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return {};
    }

    return Object.keys(source).reduce(function (allocations, windowKey) {
      const normalizedWindowKey = normalizeWindowKey(windowKey);
      const numericValue = Number(source[windowKey]);
      if (normalizedWindowKey && Number.isFinite(numericValue) && numericValue > 0) {
        allocations[normalizedWindowKey] = Math.round(numericValue * 10000) / 10000;
      }
      return allocations;
    }, {});
  }

  function getHabitDailyTarget(habit) {
    if (!habit) {
      return 0;
    }

    if (habit.type !== "measurable") {
      return normalizeTarget(habit.target);
    }

    const primaryTarget = normalizeTarget(habit.target);
    const repeatedTarget = Object.keys(habit.repeatWindowTargets || {}).reduce(function (sum, windowKey) {
      return sum + normalizeTarget(habit.repeatWindowTargets[windowKey]);
    }, 0);

    return primaryTarget + repeatedTarget;
  }

  function getHabitAppearanceTarget(habit, windowKey) {
    if (!habit) {
      return 0;
    }

    if (habit.type !== "measurable") {
      return normalizeTarget(habit.target);
    }

    const normalizedWindowKey = normalizeWindowKey(windowKey);
    const primaryWindowKey = `${normalizeTime(habit.windowStart, "07:00")}-${normalizeTime(habit.windowEnd, "07:30")}`;
    if (!normalizedWindowKey || normalizedWindowKey === primaryWindowKey) {
      return normalizeTarget(habit.target);
    }

    const numericValue = Number(habit.repeatWindowTargets && habit.repeatWindowTargets[normalizedWindowKey]);
    return Number.isFinite(numericValue) && numericValue > 0 ? normalizeTarget(numericValue) : 0;
  }

  function normalizeHabit(habit) {
    if (!habit || typeof habit !== "object") {
      return null;
    }

    const type = String(habit.type || "checkbox").trim().toLowerCase() === "measurable"
      ? "measurable"
      : "checkbox";
    const windowStart = normalizeTime(habit.windowStart, "07:00");
    const windowEnd = normalizeTime(habit.windowEnd, "07:30");
    const primaryWindowKey = `${windowStart}-${windowEnd}`;
    const repeatWindows = normalizeRepeatWindows(habit.repeatWindows, primaryWindowKey);

    return {
      id: String(habit.id || `habit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      name: String(habit.name || "").trim(),
      category: String(habit.category || "General").trim() || "General",
      type: type,
      unit: String(habit.unit || "").trim(),
      target: normalizeTarget(habit.target),
      windowStart: windowStart,
      windowEnd: windowEnd,
      activeDays: normalizeDays(habit.activeDays),
      notes: String(habit.notes || "").trim(),
      createdAt: habit.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      repeatWindows: repeatWindows,
      repeatWindowTargets: normalizeRepeatWindowTargets(habit.repeatWindowTargets, repeatWindows, type)
    };
  }

  function normalizeEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const habitId = String(entry.habitId || "").trim();
    if (!habitId) {
      return null;
    }

    const requestedStatus = String(entry.status || "pending").trim().toLowerCase();
    const status = ENTRY_STATUS.includes(requestedStatus) ? requestedStatus : "pending";
    const dateKey = formatDateKey(entry.dateKey || entry.date || new Date());
    const numericValue = entry.value === "" || entry.value == null ? "" : Number(entry.value);
    const value = Number.isFinite(numericValue) ? numericValue : "";

    return {
      id: String(entry.id || `${habitId}-${dateKey}`),
      habitId: habitId,
      dateKey: dateKey,
      status: status,
      value: value,
      note: String(entry.note || "").trim(),
      updatedAt: new Date().toISOString(),
      windowAllocations: normalizeEntryWindowAllocations(entry.windowAllocations)
    };
  }

  function readState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return createEmptyState();
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return createEmptyState();
      }

      const state = createEmptyState();
      state.habits = Array.isArray(parsed.habits)
        ? parsed.habits.map(normalizeHabit).filter(Boolean)
        : [];
      state.entries = Array.isArray(parsed.entries)
        ? parsed.entries.map(normalizeEntry).filter(Boolean)
        : [];
      state.meta = {
        ...state.meta,
        ...(parsed.meta || {}),
        backend: "localStorage",
        storageKey: STORAGE_KEY
      };
      return state;
    } catch (error) {
      console.error("Could not read local backend state:", error);
      return createEmptyState();
    }
  }

  function writeState(state) {
    const nextState = {
      ...state,
      meta: {
        ...(state.meta || {}),
        backend: "localStorage",
        storageKey: STORAGE_KEY,
        updatedAt: new Date().toISOString()
      }
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    return nextState;
  }

  function compareHabits(left, right) {
    if (left.windowStart !== right.windowStart) {
      return left.windowStart.localeCompare(right.windowStart);
    }
    if (left.windowEnd !== right.windowEnd) {
      return left.windowEnd.localeCompare(right.windowEnd);
    }
    return left.name.localeCompare(right.name);
  }

  function listHabits() {
    return readState().habits.slice().sort(compareHabits);
  }

  function getHabit(id) {
    return listHabits().find((habit) => habit.id === id) || null;
  }

  function saveHabit(habitInput) {
    const normalized = normalizeHabit(habitInput);
    if (!normalized || !normalized.name) {
      throw new Error("Habit name is required.");
    }

    const state = readState();
    const index = state.habits.findIndex((habit) => habit.id === normalized.id);

    if (index >= 0) {
      normalized.createdAt = state.habits[index].createdAt;
      state.habits[index] = normalized;
    } else {
      state.habits.push(normalized);
    }

    writeState(state);
    return normalized;
  }

  function deleteHabit(id) {
    const state = readState();
    state.habits = state.habits.filter((habit) => habit.id !== id);
    state.entries = state.entries.filter((entry) => entry.habitId !== id);
    writeState(state);
  }

  function getDayKey(dateLike) {
    const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
    const dayIndex = date.getDay();
    return DAY_ORDER[(dayIndex + 6) % 7];
  }

  function listHabitsForDate(dateLike) {
    const dayKey = getDayKey(dateLike);
    return listHabits().filter((habit) => habit.activeDays.includes(dayKey));
  }

  function listWindowsForDate(dateLike) {
    const habits = listHabitsForDate(dateLike);
    const grouped = new Map();

    habits.forEach((habit) => {
      const windowKeys = [`${habit.windowStart}-${habit.windowEnd}`].concat(habit.repeatWindows || []);
      const dailyTarget = getHabitDailyTarget(habit);
      windowKeys.forEach((windowKey) => {
        const parts = windowKey.split("-");
        const windowStart = parts[0];
        const windowEnd = parts[1];

        if (!grouped.has(windowKey)) {
          grouped.set(windowKey, {
            key: windowKey,
            windowStart: windowStart,
            windowEnd: windowEnd,
            habits: []
          });
        }

        grouped.get(windowKey).habits.push({
          ...habit,
          appearanceKey: `${habit.id}::${windowKey}`,
          appearanceTarget: getHabitAppearanceTarget(habit, windowKey),
          primaryWindowEnd: habit.windowEnd,
          primaryWindowStart: habit.windowStart,
          totalTarget: dailyTarget,
          windowEnd: windowEnd,
          windowStart: windowStart
        });
      });
    });

    return Array.from(grouped.values()).sort((left, right) => {
      if (left.windowStart !== right.windowStart) {
        return left.windowStart.localeCompare(right.windowStart);
      }
      return left.windowEnd.localeCompare(right.windowEnd);
    });
  }

  function listEntriesForDate(dateLike) {
    const dateKey = formatDateKey(dateLike);
    return readState().entries.filter((entry) => entry.dateKey === dateKey);
  }

  function getEntryForDate(habitId, dateLike) {
    const dateKey = formatDateKey(dateLike);
    return readState().entries.find((entry) => entry.habitId === habitId && entry.dateKey === dateKey) || null;
  }

  function saveEntry(entryInput) {
    const normalized = normalizeEntry(entryInput);
    if (!normalized) {
      throw new Error("A habit entry needs at least a habitId and date.");
    }

    const state = readState();
    const index = state.entries.findIndex(
      (entry) => entry.habitId === normalized.habitId && entry.dateKey === normalized.dateKey
    );

    if (index >= 0) {
      normalized.id = state.entries[index].id;
      state.entries[index] = normalized;
    } else {
      state.entries.push(normalized);
    }

    writeState(state);
    return normalized;
  }

  function clearEntry(habitId, dateLike) {
    const dateKey = formatDateKey(dateLike);
    const state = readState();
    state.entries = state.entries.filter(
      (entry) => !(entry.habitId === habitId && entry.dateKey === dateKey)
    );
    writeState(state);
  }

  function getHabitProgress(habit, entry) {
    if (!habit || !entry) {
      return {
        complete: false,
        label: "Planned",
        progressRatio: 0,
        statusTone: "pending",
        value: ""
      };
    }

    if (habit.type === "checkbox") {
      const checkboxValue = Number(entry.value);
      const loggedCheckboxDone = entry.status === "logged" && (
        entry.value === ""
        || entry.value == null
        || !Number.isFinite(checkboxValue)
        || checkboxValue > 0
      );

      if (entry.status === "done" || loggedCheckboxDone) {
        return {
          complete: true,
          label: "Done",
          progressRatio: 1,
          statusTone: "done",
          value: ""
        };
      }

      if (entry.status === "skipped") {
        return {
          complete: false,
          label: "Not done",
          progressRatio: 0,
          statusTone: "pending",
          value: ""
        };
      }

      return {
        complete: false,
        label: "Planned",
        progressRatio: 0,
        statusTone: "pending",
        value: ""
      };
    }

    const value = Number(entry.value);
    const safeValue = Number.isFinite(value) ? value : 0;
    const targetValue = getHabitDailyTarget(habit);
    const ratio = targetValue > 0 ? Math.max(0, Math.min(1, safeValue / targetValue)) : 0;

    if (entry.status === "skipped") {
      return {
        complete: false,
        label: "Not done",
        progressRatio: 0,
        statusTone: "pending",
        value: 0
      };
    }

    if (safeValue >= targetValue) {
      return {
        complete: true,
        label: "Target met",
        progressRatio: 1,
        statusTone: "done",
        value: safeValue
      };
    }

    if (safeValue > 0) {
      return {
        complete: false,
        label: "In progress",
        progressRatio: ratio,
        statusTone: "active",
        value: safeValue
      };
    }

    return {
      complete: false,
      label: "Not done",
      progressRatio: 0,
      statusTone: "pending",
      value: 0
    };
  }

  function getDailySummary(dateLike) {
    const habits = listHabitsForDate(dateLike);
    const entriesByHabit = new Map(
      listEntriesForDate(dateLike).map((entry) => [entry.habitId, entry])
    );

    let completed = 0;
    let notDone = 0;
    let inProgress = 0;
    let progressPoints = 0;

    habits.forEach((habit) => {
      const progress = getHabitProgress(habit, entriesByHabit.get(habit.id));
      progressPoints += progress.progressRatio;

      if (progress.statusTone === "done") {
        completed += 1;
      } else if (progress.statusTone === "active") {
        inProgress += 1;
      } else {
        notDone += 1;
      }
    });

    const total = habits.length;
    const progressPercent = total > 0 ? Math.round((progressPoints / total) * 100) : 0;

    return {
      total: total,
      completed: completed,
      notDone: notDone,
      inProgress: inProgress,
      progressPercent: progressPercent
    };
  }

  function getStats(dateLike) {
    const habits = listHabits();
    const todaysHabits = listHabitsForDate(dateLike);
    const summary = getDailySummary(dateLike);

    return {
      totalHabits: habits.length,
      todaysHabits: todaysHabits.length,
      measurableHabits: habits.filter((habit) => habit.type === "measurable").length,
      totalWindowsToday: listWindowsForDate(dateLike).length,
      progressPercentToday: summary.progressPercent
    };
  }

  function getMeta() {
    return readState().meta;
  }

  function getStateSnapshot() {
    return JSON.parse(JSON.stringify(readState()));
  }

  window.SystemHabitsBackendLocal = {
    DAY_ORDER: DAY_ORDER.slice(),
    ENTRY_STATUS: ENTRY_STATUS.slice(),
    STORAGE_KEY: STORAGE_KEY,
    clearEntry: clearEntry,
    deleteHabit: deleteHabit,
    formatDateKey: formatDateKey,
    getDailySummary: getDailySummary,
    getEntryForDate: getEntryForDate,
    getHabit: getHabit,
    getHabitAppearanceTarget: getHabitAppearanceTarget,
    getHabitDailyTarget: getHabitDailyTarget,
    getHabitProgress: getHabitProgress,
    getMeta: getMeta,
    getStateSnapshot: getStateSnapshot,
    getStats: getStats,
    listEntriesForDate: listEntriesForDate,
    listHabits: listHabits,
    listHabitsForDate: listHabitsForDate,
    listWindowsForDate: listWindowsForDate,
    saveEntry: saveEntry,
    saveHabit: saveHabit
  };
})(window);

