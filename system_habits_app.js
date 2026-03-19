(function (window, document) {
  "use strict";

  const googleBackend = window.SystemHabitsBackend;
  const localBackend = window.SystemHabitsBackendLocal || null;
  if (!googleBackend) {
    throw new Error("SystemHabitsBackend is required before loading the app.");
  }

  const DAY_META = [
    { key: "mon", label: "Mon" },
    { key: "tue", label: "Tue" },
    { key: "wed", label: "Wed" },
    { key: "thu", label: "Thu" },
    { key: "fri", label: "Fri" },
    { key: "sat", label: "Sat" },
    { key: "sun", label: "Sun" }
  ];

  const TIMER_UNIT_META = [
    { pattern: /\b(sec|secs|second|seconds)\b/i, multiplier: 1 / 60 },
    { pattern: /\b(m|min|mins|minute|minutes)\b/i, multiplier: 1 },
    { pattern: /\b(h|hr|hrs|hour|hours)\b/i, multiplier: 60 }
  ];
  const FOCUS_TIMER_STORAGE_KEY = "system-habits-focus-timers-v1";

  function readPersistedTimerState() {
    try {
      const rawValue = window.localStorage.getItem(FOCUS_TIMER_STORAGE_KEY);
      if (!rawValue) {
        return {};
      }

      const parsedValue = JSON.parse(rawValue);
      return parsedValue && typeof parsedValue === "object" ? parsedValue : {};
    } catch (error) {
      return {};
    }
  }

  const state = {
    categoryPanels: {},
    editingHabitId: null,
    measureDrafts: {},
    selectedDateKey: googleBackend.formatDateKey(new Date()),
    timers: readPersistedTimerState()
  };
  let timerIntervalId = null;

  const elements = {
    backendMeta: document.getElementById("backendMeta"),
    backendPanelCopy: document.getElementById("backendPanelCopy"),
    backendStatus: document.getElementById("backendStatus"),
    backendDayCount: document.getElementById("backendDayCount"),
    backendDayData: document.getElementById("backendDayData"),
    backendDayLabel: document.getElementById("backendDayLabel"),
    backendMasterCount: document.getElementById("backendMasterCount"),
    backendMasterData: document.getElementById("backendMasterData"),
    checkInList: document.getElementById("checkInList"),
    connectButton: document.getElementById("connectButton"),
    dayInput: document.getElementById("dayInput"),
    dayLabel: document.getElementById("dayLabel"),
    emptyCheckin: document.getElementById("emptyCheckin"),
    emptyLibrary: document.getElementById("emptyLibrary"),
    form: document.getElementById("habitForm"),
    formTitle: document.getElementById("formTitle"),
    habitCategory: document.getElementById("habitCategory"),
    habitCountBadge: document.getElementById("habitCountBadge"),
    habitId: document.getElementById("habitId"),
    habitList: document.getElementById("habitList"),
    habitName: document.getElementById("habitName"),
    habitNotes: document.getElementById("habitNotes"),
    habitRepeatWindowList: document.getElementById("habitRepeatWindowList"),
    habitRepeatWindowMeta: document.getElementById("habitRepeatWindowMeta"),
    habitRepeatWindowSelect: document.getElementById("habitRepeatWindowSelect"),
    habitTarget: document.getElementById("habitTarget"),
    habitTargetLabel: document.getElementById("habitTargetLabel"),
    habitType: document.getElementById("habitType"),
    habitUnit: document.getElementById("habitUnit"),
    habitUnitWrap: document.getElementById("habitUnitWrap"),
    habitWindowEnd: document.getElementById("habitWindowEnd"),
    habitWindowStart: document.getElementById("habitWindowStart"),
    pageDate: document.getElementById("pageDate"),
    prevDayButton: document.getElementById("prevDayButton"),
    progressCompleted: document.getElementById("progressCompleted"),
    progressInProgress: document.getElementById("progressInProgress"),
    progressPercent: document.getElementById("progressPercent"),
    progressRing: document.getElementById("progressRing"),
    progressSkipped: document.getElementById("progressSkipped"),
    progressTotal: document.getElementById("progressTotal"),
    resetButton: document.getElementById("resetFormButton"),
    saveHabitButton: document.getElementById("saveHabitButton"),
    signOutButton: document.getElementById("signOutButton"),
    statMeasurable: document.getElementById("statMeasurable"),
    statProgress: document.getElementById("statProgress"),
    statToday: document.getElementById("statToday"),
    statTotal: document.getElementById("statTotal"),
    statWindows: document.getElementById("statWindows"),
    syncButton: document.getElementById("syncButton"),
    todayButton: document.getElementById("todayButton"),
    nextDayButton: document.getElementById("nextDayButton")
  };

  function getSelectedDate() {
    return new Date(`${state.selectedDateKey}T12:00:00`);
  }

  function isFileProtocol() {
    return window.location.protocol === "file:";
  }

  function getMeasureDraftKey(habitId, dateKey) {
    return `${dateKey}::${habitId}`;
  }

  function getBoardPanelKey(groupKey, dateKey) {
    return `${dateKey}::${String(groupKey || "default")}`;
  }

  function getTimerKey(habitId, dateKey) {
    return `timer::${dateKey}::${habitId}`;
  }

  function isBoardPanelOpen(groupKey, dateKey) {
    const panelKey = getBoardPanelKey(groupKey, dateKey);
    if (Object.prototype.hasOwnProperty.call(state.categoryPanels, panelKey)) {
      return state.categoryPanels[panelKey];
    }

    return false;
  }

  function setBoardPanelOpen(groupKey, dateKey, isOpen) {
    state.categoryPanels[getBoardPanelKey(groupKey, dateKey)] = Boolean(isOpen);
  }

  function getMeasureDraftValue(habitId, dateKey) {
    const key = getMeasureDraftKey(habitId, dateKey);
    return Object.prototype.hasOwnProperty.call(state.measureDrafts, key)
      ? state.measureDrafts[key]
      : undefined;
  }

  function setMeasureDraftValue(habitId, dateKey, value) {
    state.measureDrafts[getMeasureDraftKey(habitId, dateKey)] = String(value == null ? "" : value);
  }

  function clearMeasureDraftValue(habitId, dateKey) {
    delete state.measureDrafts[getMeasureDraftKey(habitId, dateKey)];
  }

  function syncVisibleMeasureInputs(habitId, value, sourceInput) {
    document.querySelectorAll(`[data-entry-input][data-habit-id="${habitId}"]`).forEach((input) => {
      if (sourceInput && input === sourceInput) {
        return;
      }

      input.value = value;
    });
  }

  function clearHabitTransientState(habitId) {
    Object.keys(state.measureDrafts).forEach((draftKey) => {
      if (draftKey.endsWith(`::${habitId}`)) {
        delete state.measureDrafts[draftKey];
      }
    });

    Object.keys(state.timers).forEach((timerKey) => {
      if (timerKey.endsWith(`::${habitId}`)) {
        delete state.timers[timerKey];
      }
    });

    persistTimerState();
    syncTimerTicker();
  }

  function getTimerUnitMultiplier(unit) {
    const normalized = String(unit || "").trim();
    const match = TIMER_UNIT_META.find((item) => item.pattern.test(normalized));
    return match ? match.multiplier : null;
  }

  function supportsHabitTimer(habit) {
    return Boolean(habit && habit.type === "measurable" && getTimerUnitMultiplier(habit.unit));
  }

  function getHabitTimerSupportText(habit) {
    if (!habit || habit.type !== "measurable") {
      return "";
    }

    if (supportsHabitTimer(habit)) {
      return "Measurable habit · Focus timer";
    }

    if (!String(habit.unit || "").trim()) {
      return "Measurable habit · No focus timer (add a time unit like min or hr)";
    }

    return `Measurable habit · No focus timer (${habit.unit} is not a time unit)`;
  }

  function persistTimerState() {
    try {
      const timerKeys = Object.keys(state.timers || {});
      if (timerKeys.length === 0) {
        window.localStorage.removeItem(FOCUS_TIMER_STORAGE_KEY);
        return;
      }

      window.localStorage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify(state.timers));
    } catch (error) {
      // Ignore storage failures so the rest of the app remains usable.
    }
  }

  function roundNumber(value, decimals) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return 0;
    }

    const precision = Number.isInteger(decimals) && decimals >= 0 ? decimals : 2;
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

  function formatMeasureValue(value) {
    const roundedValue = roundNumber(value, 2);
    return Number.isInteger(roundedValue) ? String(roundedValue) : String(Number(roundedValue.toFixed(2)));
  }

  function getStoredMeasureValue(habitId, dateKey, fallbackValue) {
    const entry = getReadBackend().getEntryForDate(habitId, dateKey);
    const entryValue = Number(entry && entry.value);
    const hasEntryValue = Number.isFinite(entryValue) && entryValue >= 0;
    const fallbackNumericValue = Number(fallbackValue);
    const safeFallbackValue = Number.isFinite(fallbackNumericValue) && fallbackNumericValue >= 0
      ? fallbackNumericValue
      : 0;
    const draftValue = getMeasureDraftValue(habitId, dateKey);
    if (draftValue !== undefined) {
      const trimmedDraft = String(draftValue).trim();
      if (!trimmedDraft) {
        return hasEntryValue ? entryValue : safeFallbackValue;
      }

      const numericDraft = Number(trimmedDraft);
      if (Number.isFinite(numericDraft) && numericDraft >= 0) {
        return numericDraft;
      }
    }

    return hasEntryValue ? entryValue : safeFallbackValue;
  }

  function convertSecondsToHabitValue(seconds, unit) {
    const unitMultiplier = getTimerUnitMultiplier(unit);
    if (!unitMultiplier) {
      return 0;
    }

    return roundNumber((Math.max(0, Number(seconds) || 0) / 60) / unitMultiplier, 4);
  }

  function convertHabitValueToSeconds(value, unit) {
    const unitMultiplier = getTimerUnitMultiplier(unit);
    if (!unitMultiplier) {
      return 0;
    }

    return Math.max(0, Math.round((Number(value) || 0) * unitMultiplier * 60));
  }

  function getTimerSession(habit, dateKey) {
    const timerKey = getTimerKey(habit.id, dateKey);
    const existingSession = state.timers[timerKey];

    if (!existingSession || typeof existingSession !== "object") {
      state.timers[timerKey] = {
        bufferSeconds: 0,
        dateKey: dateKey,
        habitId: habit.id,
        loggedValueSnapshot: 0,
        running: false,
        startedAtMs: 0
      };
      persistTimerState();
      return state.timers[timerKey];
    }

    existingSession.bufferSeconds = Math.max(0, Math.floor(Number(existingSession.bufferSeconds) || 0));
    existingSession.dateKey = dateKey;
    existingSession.habitId = habit.id;
    existingSession.loggedValueSnapshot = roundNumber(existingSession.loggedValueSnapshot, 4);
    existingSession.running = Boolean(existingSession.running);
    existingSession.startedAtMs = existingSession.running && Number.isFinite(existingSession.startedAtMs)
      ? Number(existingSession.startedAtMs)
      : 0;

    return existingSession;
  }

  function getExistingTimerSession(habitId, dateKey) {
    const timerKey = getTimerKey(habitId, dateKey);
    const session = state.timers[timerKey];
    return session && typeof session === "object" ? session : null;
  }

  function syncTimerSnapshot(habitId, dateKey, value) {
    const session = getExistingTimerSession(habitId, dateKey);
    if (!session) {
      return;
    }

    const nextSnapshotValue = roundNumber(value, 4);
    if (session.loggedValueSnapshot === nextSnapshotValue) {
      return;
    }

    session.loggedValueSnapshot = nextSnapshotValue;
    persistTimerState();
  }

  function getCurrentSessionSeconds(session, nowMs) {
    if (!session) {
      return 0;
    }

    const baseSeconds = Math.max(0, Math.floor(Number(session.bufferSeconds) || 0));
    if (!session.running || !Number.isFinite(session.startedAtMs) || session.startedAtMs <= 0) {
      return baseSeconds;
    }

    const referenceNow = Number.isFinite(nowMs) ? nowMs : Date.now();
    const liveSeconds = Math.max(0, Math.floor((referenceNow - session.startedAtMs) / 1000));
    return baseSeconds + liveSeconds;
  }

  function getPreciseCurrentMinutes(nowMs) {
    const referenceDate = Number.isFinite(nowMs) ? new Date(nowMs) : new Date();
    return (referenceDate.getHours() * 60) + referenceDate.getMinutes() + (referenceDate.getSeconds() / 60);
  }

  function formatDurationLabel(totalMinutes) {
    const safeMinutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;

    if (hours > 0 && minutes > 0) {
      return `${hours}h ${minutes}m`;
    }

    if (hours > 0) {
      return `${hours}h`;
    }

    return `${minutes}m`;
  }

  function formatTimerClock(totalSeconds) {
    const safeSeconds = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function buildTimerProgressCopy(habit, loggedValue, targetValue) {
    const unitLabel = String(habit.unit || "units").trim() || "units";
    if (targetValue > 0) {
      return `${formatMeasureValue(loggedValue)} / ${formatMeasureValue(targetValue)} ${unitLabel} logged`;
    }

    return `${formatMeasureValue(loggedValue)} ${unitLabel} logged`;
  }

  function getLiveMeasuredValue(habit, dateKey, nowMs) {
    if (!habit || habit.type !== "measurable") {
      return 0;
    }

    const timerSession = supportsHabitTimer(habit) ? getExistingTimerSession(habit.id, dateKey) : null;
    const storedValue = getStoredMeasureValue(
      habit.id,
      dateKey,
      timerSession ? timerSession.loggedValueSnapshot : undefined
    );

    if (!timerSession || !supportsHabitTimer(habit)) {
      return storedValue;
    }

    return roundNumber(
      storedValue + convertSecondsToHabitValue(getCurrentSessionSeconds(timerSession, nowMs), habit.unit),
      4
    );
  }

  function getLoggedWindowMinutes(windowSection, dateKey, nowMs) {
    return roundNumber(
      (windowSection.habits || []).reduce(function (totalMinutes, habit) {
        const unitMultiplier = getTimerUnitMultiplier(habit.unit);
        if (!habit || habit.type !== "measurable" || !unitMultiplier) {
          return totalMinutes;
        }

        return totalMinutes + (getLiveMeasuredValue(habit, dateKey, nowMs) * unitMultiplier);
      }, 0),
      2
    );
  }

  function getTargetWindowMinutes(windowSection) {
    return roundNumber(
      (windowSection.habits || []).reduce(function (totalMinutes, habit) {
        const unitMultiplier = getTimerUnitMultiplier(habit.unit);
        if (!habit || habit.type !== "measurable" || !unitMultiplier) {
          return totalMinutes;
        }

        return totalMinutes + (Number(habit.target) || 0) * unitMultiplier;
      }, 0),
      2
    );
  }

  function getWindowSummaryMetrics(windowSection, boardContext, nowMs) {
    const windowStartMinutes = parseTimeToMinutes(windowSection.windowStart);
    const windowEndMinutes = parseTimeToMinutes(windowSection.windowEnd);
    const windowDurationMinutes = Math.max(0, windowEndMinutes - windowStartMinutes);
    const preciseCurrentMinutes = boardContext.isToday ? getPreciseCurrentMinutes(nowMs) : null;
    const elapsedMinutes = boardContext.isPast
      ? windowDurationMinutes
      : boardContext.isToday
        ? clampNumber(preciseCurrentMinutes - windowStartMinutes, 0, windowDurationMinutes)
        : 0;
    const isClosed = boardContext.isPast || (
      boardContext.isToday &&
      preciseCurrentMinutes !== null &&
      preciseCurrentMinutes >= windowEndMinutes
    );
    const loggedMinutes = getLoggedWindowMinutes(windowSection, state.selectedDateKey, nowMs);
    const targetMinutes = getTargetWindowMinutes(windowSection);
    const unusedMinutes = isClosed
      ? Math.max(0, windowDurationMinutes - loggedMinutes)
      : Math.max(0, elapsedMinutes - loggedMinutes);

    const doneCount = (windowSection.habits || []).reduce(function (count, habit) {
      const entry = boardContext.entriesByHabit.get(habit.id);
      const progress = boardContext.backendRef.getHabitProgress(habit, entry);
      return count + (progress.complete ? 1 : 0);
    }, 0);
    const totalHabits = (windowSection.habits || []).length;

    return {
      doneCount: doneCount,
      elapsedBarWidth: `${Math.round(windowDurationMinutes > 0 ? (elapsedMinutes / windowDurationMinutes) * 100 : 0)}%`,
      elapsedCopy: isClosed
        ? `${formatDurationLabel(windowDurationMinutes)} elapsed · window closed`
        : `${formatDurationLabel(elapsedMinutes)} elapsed of ${formatDurationLabel(windowDurationMinutes)}`,
      loggedText: formatDurationLabel(loggedMinutes),
      pendingCount: Math.max(0, totalHabits - doneCount),
      targetText: formatDurationLabel(targetMinutes),
      totalHabits: totalHabits,
      unusedLabel: isClosed ? "Unused after close" : "Unlogged so far",
      unusedText: formatDurationLabel(unusedMinutes)
    };
  }

  function getTimerMeta(habit, dateKey, nowMs) {
    const session = getTimerSession(habit, dateKey);
    const storedValue = getStoredMeasureValue(habit.id, dateKey, session.loggedValueSnapshot);
    const sessionSeconds = getCurrentSessionSeconds(session, nowMs);
    const liveValue = roundNumber(storedValue + convertSecondsToHabitValue(sessionSeconds, habit.unit), 4);
    const liveSeconds = convertHabitValueToSeconds(storedValue, habit.unit) + sessionSeconds;
    const numericTarget = Number(habit.target);
    const safeTarget = Number.isFinite(numericTarget) && numericTarget > 0 ? numericTarget : 0;
    const progressRatio = safeTarget > 0 ? Math.max(0, Math.min(1, liveValue / safeTarget)) : 0;

    if (session.running) {
      return {
        actionLabel: "Running",
        canPause: true,
        canReset: true,
        clockText: formatTimerClock(liveSeconds),
        progressText: buildTimerProgressCopy(habit, liveValue, safeTarget),
        progressWidth: `${Math.round(progressRatio * 100)}%`,
        stateClass: "running",
        stateLabel: "Running"
      };
    }

    if (sessionSeconds > 0) {
      return {
        actionLabel: "Continue",
        canPause: false,
        canReset: true,
        clockText: formatTimerClock(liveSeconds),
        progressText: buildTimerProgressCopy(habit, liveValue, safeTarget),
        progressWidth: `${Math.round(progressRatio * 100)}%`,
        stateClass: "paused",
        stateLabel: "Paused"
      };
    }

    return {
      actionLabel: storedValue > 0 ? "Continue" : "Start",
      canPause: false,
      canReset: false,
      clockText: formatTimerClock(liveSeconds),
      progressText: buildTimerProgressCopy(habit, liveValue, safeTarget),
      progressWidth: `${Math.round(progressRatio * 100)}%`,
      stateClass: storedValue > 0 ? "saved" : "",
      stateLabel: storedValue > 0 ? "Logged" : "Ready"
    };
  }

  function syncTimerTicker() {
    const timers = state.timers ? Object.values(state.timers) : [];
    const hasRunningTimer = timers.some((session) => session.running);
    const liveBoardContext = buildBoardContext();
    const hasLiveWindowClock = liveBoardContext.isToday && liveBoardContext.visibleWindows.length > 0;
    const shouldTick = hasRunningTimer || hasLiveWindowClock;

    if (shouldTick && !timerIntervalId) {
      timerIntervalId = window.setInterval(tickTimers, 1000);
      return;
    }

    if (!shouldTick && timerIntervalId) {
      window.clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  function refreshVisibleWindowSummaries() {
    const summaryNodes = document.querySelectorAll("[data-window-summary-key]");
    if (!summaryNodes.length) {
      return false;
    }

    const boardContext = buildBoardContext();
    const windowSections = buildWindowSections(boardContext.visibleWindows);
    const windowSectionsByKey = new Map(windowSections.map((windowSection) => [windowSection.windowKey, windowSection]));
    const currentKeys = windowSections.map((windowSection) => windowSection.windowKey);
    const renderedKeys = Array.from(summaryNodes).map((node) => node.getAttribute("data-window-summary-key"));

    if (currentKeys.length !== renderedKeys.length || currentKeys.some((key, index) => key !== renderedKeys[index])) {
      render();
      return true;
    }

    summaryNodes.forEach((node) => {
      const summaryKey = node.getAttribute("data-window-summary-key");
      const windowSection = windowSectionsByKey.get(summaryKey);
      if (!windowSection) {
        return;
      }

      const metrics = getWindowSummaryMetrics(windowSection, boardContext);
      const totalNode = document.querySelector(`[data-window-total="${summaryKey}"]`);
      const doneNode = document.querySelector(`[data-window-done="${summaryKey}"]`);
      const pendingNode = document.querySelector(`[data-window-pending="${summaryKey}"]`);
      const targetNode = document.querySelector(`[data-window-target="${summaryKey}"]`);
      const loggedNode = document.querySelector(`[data-window-logged="${summaryKey}"]`);
      const unusedLabelNode = document.querySelector(`[data-window-unused-label="${summaryKey}"]`);
      const unusedValueNode = document.querySelector(`[data-window-unused-value="${summaryKey}"]`);
      const elapsedFillNode = document.querySelector(`[data-window-elapsed-fill="${summaryKey}"]`);
      const elapsedCopyNode = document.querySelector(`[data-window-elapsed-copy="${summaryKey}"]`);

      if (totalNode) {
        totalNode.textContent = String(metrics.totalHabits);
      }
      if (doneNode) {
        doneNode.textContent = String(metrics.doneCount);
      }
      if (pendingNode) {
        pendingNode.textContent = String(metrics.pendingCount);
      }
      if (targetNode) {
        targetNode.textContent = metrics.targetText;
      }
      if (loggedNode) {
        loggedNode.textContent = metrics.loggedText;
      }
      if (unusedLabelNode) {
        unusedLabelNode.textContent = metrics.unusedLabel;
      }
      if (unusedValueNode) {
        unusedValueNode.textContent = metrics.unusedText;
      }
      if (elapsedFillNode) {
        elapsedFillNode.style.width = metrics.elapsedBarWidth;
      }
      if (elapsedCopyNode) {
        elapsedCopyNode.textContent = metrics.elapsedCopy;
      }
    });

    return false;
  }

  function refreshVisibleTimerDisplays() {
    const readBackend = getReadBackend();
    const selectedDateKey = state.selectedDateKey;
    const timerNodes = document.querySelectorAll("[data-timer-key]");

    timerNodes.forEach((node) => {
      const timerKey = node.getAttribute("data-timer-key");
      const habitId = node.getAttribute("data-habit-id");
      if (!timerKey || !habitId) {
        return;
      }

      const habit = readBackend.getHabit(habitId);
      if (!habit) {
        return;
      }

      const timerMeta = getTimerMeta(habit, selectedDateKey);
      node.textContent = timerMeta.clockText;

      const timerPanel = node.closest(".timer-panel");
      const stateNode = timerPanel
        ? timerPanel.querySelector(`[data-timer-state="${timerKey}"]`)
        : null;
      if (stateNode) {
        stateNode.textContent = timerMeta.stateLabel;
        stateNode.className = `timer-state ${timerMeta.stateClass}`.trim();
      }

      const progressFillNode = timerPanel
        ? timerPanel.querySelector(`[data-timer-progress-fill="${timerKey}"]`)
        : null;
      if (progressFillNode) {
        progressFillNode.style.width = timerMeta.progressWidth;
      }

      const progressCopyNode = timerPanel
        ? timerPanel.querySelector(`[data-timer-progress-copy="${timerKey}"]`)
        : null;
      if (progressCopyNode) {
        progressCopyNode.textContent = timerMeta.progressText;
      }
    });
  }

  function tickTimers() {
    syncTimerTicker();
    if (refreshVisibleWindowSummaries()) {
      return;
    }
    refreshVisibleTimerDisplays();
  }

  function startHabitTimer(habitId) {
    const habit = getReadBackend().getHabit(habitId);
    if (!habit || !supportsHabitTimer(habit)) {
      return;
    }

    const session = getTimerSession(habit, state.selectedDateKey);
    if (session.running) {
      return;
    }

    session.loggedValueSnapshot = roundNumber(
      getStoredMeasureValue(habitId, state.selectedDateKey, session.loggedValueSnapshot),
      4
    );
    session.running = true;
    session.startedAtMs = Date.now();
    persistTimerState();
    syncTimerTicker();
    render();
  }

  async function pauseHabitTimer(habitId) {
    const habit = getReadBackend().getHabit(habitId);
    if (!habit || !supportsHabitTimer(habit)) {
      return;
    }

    const session = getTimerSession(habit, state.selectedDateKey);
    if (!session.running) {
      return;
    }

    const sessionSeconds = getCurrentSessionSeconds(session, Date.now());
    session.running = false;
    session.startedAtMs = 0;
    session.bufferSeconds = sessionSeconds;
    persistTimerState();
    syncTimerTicker();
    render();

    if (sessionSeconds <= 0) {
      session.bufferSeconds = 0;
      persistTimerState();
      render();
      return;
    }

    const nextValue = roundNumber(
      getStoredMeasureValue(habitId, state.selectedDateKey, session.loggedValueSnapshot) +
        convertSecondsToHabitValue(sessionSeconds, habit.unit),
      4
    );

    try {
      await Promise.resolve(getWriteBackend().saveEntry({
        habitId: habitId,
        dateKey: state.selectedDateKey,
        status: "logged",
        value: nextValue
      }));
      clearMeasureDraftValue(habitId, state.selectedDateKey);
      session.bufferSeconds = 0;
      session.loggedValueSnapshot = nextValue;
      persistTimerState();
      render();
    } catch (error) {
      persistTimerState();
      render();
      throw error;
    }
  }

  function resetHabitTimer(habitId) {
    const habit = getReadBackend().getHabit(habitId);
    if (!habit || !supportsHabitTimer(habit)) {
      return;
    }

    const session = getTimerSession(habit, state.selectedDateKey);
    session.running = false;
    session.startedAtMs = 0;
    session.bufferSeconds = 0;
    persistTimerState();
    syncTimerTicker();
    render();
  }

  function getLocalHabitCount() {
    return localBackend ? localBackend.listHabits().length : 0;
  }

  function hasLocalFallbackData() {
    return getLocalHabitCount() > 0;
  }

  function getReadBackend() {
    if (googleBackend.getStatus().signedIn) {
      return googleBackend;
    }

    if (localBackend) {
      return localBackend;
    }

    return googleBackend;
  }

  function getWriteBackend() {
    if (googleBackend.getStatus().signedIn) {
      return googleBackend;
    }

    if (localBackend) {
      return localBackend;
    }

    return googleBackend;
  }

  function compareDateKeys(left, right) {
    return String(left || "").localeCompare(String(right || ""));
  }

  function parseTimeToMinutes(timeValue) {
    const parts = String(timeValue || "00:00").split(":");
    const hours = Number(parts[0]) || 0;
    const minutes = Number(parts[1]) || 0;
    return (hours * 60) + minutes;
  }

  function compareHabitsByWindow(left, right) {
    if (left.windowStart !== right.windowStart) {
      return left.windowStart.localeCompare(right.windowStart);
    }

    if (left.windowEnd !== right.windowEnd) {
      return left.windowEnd.localeCompare(right.windowEnd);
    }

    return String(left.name || "").localeCompare(String(right.name || ""));
  }

  function compareHabitsWithinWindow(left, right) {
    return compareHabitsByWindow(left, right);
  }

  function buildCategorySections(habits) {
    const grouped = new Map();

    habits.forEach((habit) => {
      const category = String(habit.category || "General").trim() || "General";
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category).push(habit);
    });

    return Array.from(grouped.entries())
      .map(function (entry) {
        const categoryName = entry[0];
        const categoryHabits = entry[1].slice().sort(compareHabitsByWindow);
        return {
          categoryName: categoryName,
          earliestWindowStart: categoryHabits[0] ? categoryHabits[0].windowStart : "00:00",
          latestWindowEnd: categoryHabits[categoryHabits.length - 1]
            ? categoryHabits[categoryHabits.length - 1].windowEnd
            : "00:00",
          habits: categoryHabits
        };
      })
      .sort(function (left, right) {
        if (left.earliestWindowStart !== right.earliestWindowStart) {
          return left.earliestWindowStart.localeCompare(right.earliestWindowStart);
        }
        return left.categoryName.localeCompare(right.categoryName);
      });
  }

  function buildWindowSections(windowBlocks) {
    return windowBlocks.map(function (windowBlock) {
      const habits = (windowBlock.habits || []).slice().sort(compareHabitsWithinWindow);
      const categoryNames = Array.from(new Set(
        habits
          .map((habit) => String(habit.category || "General").trim() || "General")
      ));

      return {
        categoriesText: categoryNames.join(" · "),
        habits: habits,
        windowCopy: `${formatTime(windowBlock.windowStart)} - ${formatTime(windowBlock.windowEnd)}`,
        windowEnd: windowBlock.windowEnd,
        windowKey: windowBlock.key,
        windowStart: windowBlock.windowStart
      };
    });
  }

  function getHabitVisualState(habit, progress, boardContext) {
    const windowStartMinutes = parseTimeToMinutes(habit.windowStart);
    const windowEndMinutes = parseTimeToMinutes(habit.windowEnd);
    const isActiveWindow = boardContext.isToday &&
      boardContext.currentMinutes !== null &&
      boardContext.currentMinutes >= windowStartMinutes &&
      boardContext.currentMinutes < windowEndMinutes;
    const isOverdue = boardContext.isPast || (
      boardContext.isToday &&
      boardContext.currentMinutes !== null &&
      boardContext.currentMinutes >= windowEndMinutes
    );

    if (!progress.complete && isOverdue) {
      return {
        label: "Not done",
        statusTone: "missed"
      };
    }

    if (!progress.complete && isActiveWindow) {
      return {
        label: progress.statusTone === "active" ? "In progress" : "Active window",
        statusTone: "current"
      };
    }

    return {
      label: progress.label,
      statusTone: progress.statusTone
    };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(timeValue) {
    const parts = String(timeValue || "00:00").split(":");
    const hours = Number(parts[0]) || 0;
    const minutes = Number(parts[1]) || 0;
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function getWindowKey(windowStart, windowEnd) {
    if (!windowStart || !windowEnd || windowStart >= windowEnd) {
      return "";
    }

    return `${windowStart}-${windowEnd}`;
  }

  function parseWindowKey(windowKey) {
    const parts = String(windowKey || "").split("-");
    if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0] >= parts[1]) {
      return null;
    }

    return {
      key: `${parts[0]}-${parts[1]}`,
      windowEnd: parts[1],
      windowStart: parts[0]
    };
  }

  function formatWindowKeyLabel(windowKey) {
    const parsed = parseWindowKey(windowKey);
    if (!parsed) {
      return "";
    }

    return `${formatTime(parsed.windowStart)} - ${formatTime(parsed.windowEnd)}`;
  }

  function getEditorRepeatWindows() {
    if (!elements.habitRepeatWindowList) {
      return [];
    }

    return Array.from(elements.habitRepeatWindowList.querySelectorAll("[data-repeat-window]"))
      .map((node) => node.getAttribute("data-repeat-window"))
      .filter(Boolean);
  }

  function renderEditorRepeatWindows(windowKeys) {
    if (!elements.habitRepeatWindowList) {
      return;
    }

    const uniqueWindowKeys = Array.from(new Set((windowKeys || []).filter(Boolean)));
    if (uniqueWindowKeys.length === 0) {
      elements.habitRepeatWindowList.innerHTML = '<div class="repeat-window-empty">No repetition windows yet.</div>';
      return;
    }

    elements.habitRepeatWindowList.innerHTML = uniqueWindowKeys
      .map((windowKey) => `
        <div class="repeat-window-chip" data-repeat-window="${escapeHtml(windowKey)}">
          <span>${escapeHtml(formatWindowKeyLabel(windowKey))}</span>
          <button type="button" data-remove-repeat-window="${escapeHtml(windowKey)}">Remove</button>
        </div>
      `)
      .join("");
  }

  function removeEditorRepeatWindow(windowKeyToRemove) {
    renderEditorRepeatWindows(
      getEditorRepeatWindows().filter((windowKey) => windowKey !== windowKeyToRemove)
    );
    refreshRepeatWindowOptions();
  }

  function collectUniqueWindowOptions() {
    const options = new Map();
    getReadBackend().listHabits().forEach((habit) => {
      [getWindowKey(habit.windowStart, habit.windowEnd)]
        .concat(habit.repeatWindows || [])
        .forEach(function (windowKey) {
          const parsed = parseWindowKey(windowKey);
          if (parsed) {
            options.set(parsed.key, parsed.key);
          }
        });
    });

    return Array.from(options.values()).sort(function (left, right) {
      const leftWindow = parseWindowKey(left);
      const rightWindow = parseWindowKey(right);
      if (!leftWindow || !rightWindow) {
        return String(left || "").localeCompare(String(right || ""));
      }
      if (leftWindow.windowStart !== rightWindow.windowStart) {
        return leftWindow.windowStart.localeCompare(rightWindow.windowStart);
      }
      return leftWindow.windowEnd.localeCompare(rightWindow.windowEnd);
    });
  }

  function refreshRepeatWindowOptions() {
    if (!elements.habitRepeatWindowSelect) {
      return;
    }

    const currentWindowKey = getWindowKey(elements.habitWindowStart.value, elements.habitWindowEnd.value);
    const selectedWindowKeys = getEditorRepeatWindows().filter((windowKey) => windowKey !== currentWindowKey);
    if (selectedWindowKeys.length !== getEditorRepeatWindows().length) {
      renderEditorRepeatWindows(selectedWindowKeys);
    }

    const uniqueWindowKeys = collectUniqueWindowOptions();
    const availableWindowKeys = uniqueWindowKeys.filter((windowKey) => (
      windowKey &&
      windowKey !== currentWindowKey &&
      !selectedWindowKeys.includes(windowKey)
    ));
    const uniqueWindowCount = uniqueWindowKeys.filter((windowKey) => windowKey !== currentWindowKey).length;

    const placeholderText = availableWindowKeys.length > 0
      ? "Choose a repetition window"
      : "No other valid windows yet";

    elements.habitRepeatWindowSelect.innerHTML = [
      `<option value="">${escapeHtml(placeholderText)}</option>`
    ].concat(
      availableWindowKeys.map((windowKey) => (
        `<option value="${escapeHtml(windowKey)}">${escapeHtml(formatWindowKeyLabel(windowKey))}</option>`
      ))
    ).join("");
    elements.habitRepeatWindowSelect.disabled = availableWindowKeys.length === 0;

    if (elements.habitRepeatWindowMeta) {
      elements.habitRepeatWindowMeta.textContent = uniqueWindowCount > 0
        ? `${uniqueWindowCount} unique windows available from your master list.`
        : "No other unique windows available yet.";
    }
  }

  function addRepeatWindowFromSelect() {
    if (!elements.habitRepeatWindowSelect || !elements.habitRepeatWindowSelect.value) {
      return;
    }

    const nextWindowKey = elements.habitRepeatWindowSelect.value;
    const selectedWindowKeys = getEditorRepeatWindows();
    if (!selectedWindowKeys.includes(nextWindowKey)) {
      renderEditorRepeatWindows(selectedWindowKeys.concat(nextWindowKey));
    }

    elements.habitRepeatWindowSelect.value = "";
    refreshRepeatWindowOptions();
  }

  function buildHabitWindowText(habit) {
    const primaryWindowText = `${formatTime(habit.windowStart)} - ${formatTime(habit.windowEnd)}`;
    const repeatWindowKeys = habit.repeatWindows || [];
    if (repeatWindowKeys.length === 0) {
      return primaryWindowText;
    }

    const repeatText = repeatWindowKeys.map(formatWindowKeyLabel).join(", ");
    return `${primaryWindowText} · repeats in ${repeatText}`;
  }

  function getHabitAppearanceMeta(habit) {
    const windowSequence = [
      getWindowKey(
        habit.primaryWindowStart || habit.windowStart,
        habit.primaryWindowEnd || habit.windowEnd
      )
    ].concat(habit.repeatWindows || [])
      .map(parseWindowKey)
      .filter(Boolean)
      .filter(function (windowItem, index, list) {
        return list.findIndex(function (candidate) {
          return candidate.key === windowItem.key;
        }) === index;
      })
      .sort(function (left, right) {
        if (left.windowStart !== right.windowStart) {
          return left.windowStart.localeCompare(right.windowStart);
        }
        return left.windowEnd.localeCompare(right.windowEnd);
      });

    if (windowSequence.length <= 1) {
      return null;
    }

    const currentWindowKey = getWindowKey(habit.windowStart, habit.windowEnd);
    const appearanceIndex = windowSequence.findIndex(function (windowItem) {
      return windowItem.key === currentWindowKey;
    });
    if (appearanceIndex === -1) {
      return null;
    }

    return {
      label: `Rep ${appearanceIndex + 1} of ${windowSequence.length}`,
      number: appearanceIndex + 1,
      total: windowSequence.length
    };
  }

  function formatDays(days) {
    const daySet = new Set(days);
    if (daySet.size === 1 && daySet.has("sun")) {
      return "Sunday habit";
    }

    if (googleBackend.DAY_ORDER.every((day) => daySet.has(day))) {
      return "Every day";
    }

    return DAY_META
      .filter((day) => daySet.has(day.key))
      .map((day) => day.label)
      .join(", ");
  }

  function formatLongDate(date) {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function formatDateTime(dateLike) {
    return new Date(dateLike).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function getSelectedDays() {
    return DAY_META
      .filter((day) => {
        const checkbox = document.querySelector(`input[name="activeDays"][value="${day.key}"]`);
        return checkbox && checkbox.checked;
      })
      .map((day) => day.key);
  }

  function setSelectedDays(days) {
    const daySet = new Set(days);
    DAY_META.forEach((day) => {
      const checkbox = document.querySelector(`input[name="activeDays"][value="${day.key}"]`);
      if (checkbox) {
        checkbox.checked = daySet.has(day.key);
      }
    });
  }

  function updateTypeUi() {
    const type = elements.habitType.value;
    const isMeasurable = type === "measurable";
    elements.habitTargetLabel.textContent = isMeasurable
      ? "Daily target"
      : "Daily target (usually 1)";
    elements.habitUnitWrap.style.display = isMeasurable ? "grid" : "none";
    if (!isMeasurable) {
      elements.habitUnit.value = "";
    }
  }

  function buildTargetText(habit) {
    if (habit.type === "measurable") {
      return `${habit.target} ${habit.unit ? `${habit.unit} / day` : "units / day"}`;
    }
    return `${habit.target} completion / day`;
  }

  function buildVisibleSummary(habits, entriesByHabit, progressBackend) {
    let completed = 0;
    let notDone = 0;
    let inProgress = 0;
    let progressPoints = 0;

    habits.forEach((habit) => {
      const progress = progressBackend.getHabitProgress(habit, entriesByHabit.get(habit.id));
      progressPoints += progress.progressRatio;

      if (progress.statusTone === "done") {
        completed += 1;
      } else if (progress.statusTone === "active") {
        inProgress += 1;
      } else {
        notDone += 1;
      }
    });

    return {
      total: habits.length,
      completed: completed,
      notDone: notDone,
      inProgress: inProgress,
      progressPercent: habits.length > 0 ? Math.round((progressPoints / habits.length) * 100) : 0
    };
  }

  function buildBoardContext() {
    const readBackend = getReadBackend();
    const selectedDate = getSelectedDate();
    const todayKey = googleBackend.formatDateKey(new Date());
    const allWindows = readBackend.listWindowsForDate(selectedDate);
    const dateRelation = compareDateKeys(state.selectedDateKey, todayKey);
    const currentMinutes = dateRelation === 0
      ? ((new Date().getHours() * 60) + new Date().getMinutes())
      : null;
    let visibleWindows = allWindows;

    if (dateRelation > 0) {
      visibleWindows = [];
    } else if (dateRelation === 0) {
      visibleWindows = allWindows.filter((windowBlock) => parseTimeToMinutes(windowBlock.windowStart) <= currentMinutes);
    }

    const visibleHabits = visibleWindows.flatMap((windowBlock) => windowBlock.habits);
    const uniqueVisibleHabits = Array.from(new Map(
      visibleHabits.map((habit) => [habit.id, habit])
    ).values());
    const visibleHabitIds = new Set(visibleHabits.map((habit) => habit.id));
    const allEntries = readBackend.listEntriesForDate(selectedDate);
    const entriesByHabit = new Map(allEntries.map((entry) => [entry.habitId, entry]));
    const summary = buildVisibleSummary(uniqueVisibleHabits, entriesByHabit, readBackend);

    return {
      allEntries: allEntries,
      allWindows: allWindows,
      backendLabel: readBackend === googleBackend ? "google" : "local",
      backendRef: readBackend,
      currentMinutes: currentMinutes,
      entriesByHabit: entriesByHabit,
      isFuture: dateRelation > 0,
      isPast: dateRelation < 0,
      isToday: dateRelation === 0,
      selectedDate: selectedDate,
      summary: summary,
      visibleHabitIds: visibleHabitIds,
      visibleHabits: visibleHabits,
      uniqueVisibleHabits: uniqueVisibleHabits,
      visibleWindows: visibleWindows
    };
  }

  function renderHeaderMeta() {
    const today = new Date();
    const status = googleBackend.getStatus();
    const meta = googleBackend.getMeta();
    const localHabitCount = getLocalHabitCount();
    const usingLocalFallback = !status.signedIn && localHabitCount > 0;

    elements.pageDate.textContent = today.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric"
    });

    if (!status.configured) {
      elements.backendStatus.textContent = "Google Sheets config missing";
      elements.backendMeta.textContent = "Add apiKey, spreadsheetId, and clientId in system_habits_config.local.js.";
    } else if (isFileProtocol() && usingLocalFallback) {
      elements.backendStatus.textContent = "Local backup mode";
      elements.backendMeta.textContent = `Showing ${localHabitCount} habits from your browser backup. Google sign-in needs http://localhost, not file://.`;
    } else if (isFileProtocol()) {
      elements.backendStatus.textContent = "Local mode only";
      elements.backendMeta.textContent = "Google Sheets sign-in needs http://localhost, not file://. Open this app through a small local server to connect Google.";
    } else if (status.error) {
      elements.backendStatus.textContent = "Google Sheets needs attention";
      elements.backendMeta.textContent = status.error;
    } else if (usingLocalFallback) {
      elements.backendStatus.textContent = "Showing local backup";
      elements.backendMeta.textContent = `Your browser still has ${localHabitCount} local habits. Connect Google Sheets and we will move into StudioHabits and StudioEntries.`;
    } else if (status.syncing) {
      elements.backendStatus.textContent = "Syncing Google Sheets";
      elements.backendMeta.textContent = `${meta.sheets.habits} and ${meta.sheets.entries} are syncing now.`;
    } else if (!status.ready) {
      elements.backendStatus.textContent = "Preparing Google Sheets";
      elements.backendMeta.textContent = "Waiting for the Google API and sign-in client to finish loading.";
    } else if (!status.signedIn) {
      elements.backendStatus.textContent = "Google Sheets not connected";
      elements.backendMeta.textContent = `A fresh backend will be created in ${meta.sheets.habits} and ${meta.sheets.entries} after you connect.`;
    } else {
      const syncText = meta.lastSyncedAt
        ? `Last sync ${formatDateTime(meta.lastSyncedAt)}.`
        : "Connected and ready.";
      elements.backendStatus.textContent = "Google Sheets connected";
      elements.backendMeta.textContent = `${meta.sheets.habits} and ${meta.sheets.entries}. ${syncText}`;
    }

    if (elements.backendPanelCopy) {
      elements.backendPanelCopy.innerHTML = status.signedIn
        ? "This shows the live data currently stored in the fresh Google Sheets backend, powered by the <strong>StudioHabits</strong> and <strong>StudioEntries</strong> tabs."
        : "This currently shows the local browser backup on this machine. Once Google Sheets connects, this panel will switch to the new <strong>StudioHabits</strong> and <strong>StudioEntries</strong> backend.";
    }

    if (elements.saveHabitButton) {
      elements.saveHabitButton.textContent = status.signedIn
        ? "Save to Google master list"
        : "Save locally for now";
    }

    elements.connectButton.disabled = isFileProtocol() || !status.configured || !status.ready || status.signedIn || status.syncing;
    elements.syncButton.disabled = isFileProtocol() || !status.signedIn || status.syncing;
    elements.signOutButton.disabled = !status.signedIn || status.syncing;
  }

  function renderStats(boardContext) {
    const habits = boardContext.backendRef.listHabits();
    const measurableCount = habits.filter((habit) => habit.type === "measurable").length;
    const visibleWindowCount = boardContext.visibleWindows.length;

    elements.statTotal.textContent = String(habits.length);
    elements.statToday.textContent = String(boardContext.visibleHabits.length);
    elements.statMeasurable.textContent = String(measurableCount);
    elements.statWindows.textContent = String(visibleWindowCount);
    elements.statProgress.textContent = `${boardContext.summary.progressPercent}%`;
    elements.habitCountBadge.textContent = `${habits.length} habits`;
  }

  function renderProgressSummary(summary) {
    elements.progressPercent.textContent = `${summary.progressPercent}%`;
    elements.progressRing.style.setProperty("--progress", `${summary.progressPercent}%`);
    elements.progressCompleted.textContent = String(summary.completed);
    elements.progressInProgress.textContent = String(summary.inProgress);
    elements.progressSkipped.textContent = String(summary.notDone);
    elements.progressTotal.textContent = String(summary.total);
  }

  function renderBackendData() {
    if (
      !elements.backendMasterCount ||
      !elements.backendDayCount ||
      !elements.backendDayLabel ||
      !elements.backendMasterData ||
      !elements.backendDayData
    ) {
      return;
    }

    const readBackend = getReadBackend();
    const snapshot = readBackend.getStateSnapshot();
    const selectedEntries = readBackend.listEntriesForDate(state.selectedDateKey);

    elements.backendMasterCount.textContent = `${snapshot.habits.length} habits`;
    elements.backendDayCount.textContent = `${selectedEntries.length} entries`;
    elements.backendDayLabel.textContent = state.selectedDateKey;
    elements.backendMasterData.textContent = JSON.stringify(snapshot.habits, null, 2);
    elements.backendDayData.textContent = JSON.stringify(selectedEntries, null, 2);
  }

  function renderDailyBoard(boardContext) {
    const status = googleBackend.getStatus();
    elements.dayInput.value = state.selectedDateKey;
    elements.dayLabel.textContent = formatLongDate(boardContext.selectedDate);
    renderProgressSummary(boardContext.summary);

    if (!status.configured) {
      elements.emptyCheckin.hidden = false;
      elements.emptyCheckin.textContent = "Add your Google Sheets credentials first, then connect the app to load the new backend.";
      elements.checkInList.innerHTML = "";
      return;
    }

    if (isFileProtocol() && boardContext.backendLabel !== "local") {
      elements.emptyCheckin.hidden = false;
      elements.emptyCheckin.textContent = "Open this app through http://localhost to connect Google Sheets. The direct file:// version can only use local browser data.";
      elements.checkInList.innerHTML = "";
      return;
    }

    if (!status.signedIn && boardContext.backendLabel !== "local") {
      elements.emptyCheckin.hidden = false;
      elements.emptyCheckin.textContent = "Connect Google Sheets to load your master habits and start recording the day.";
      elements.checkInList.innerHTML = "";
      return;
    }

    if (boardContext.isFuture) {
      elements.emptyCheckin.hidden = false;
      elements.emptyCheckin.textContent = "Future days stay locked. Choose today or a past day to record only active and past windows.";
      elements.checkInList.innerHTML = "";
      return;
    }

    if (boardContext.allWindows.length === 0) {
      elements.emptyCheckin.hidden = false;
      elements.emptyCheckin.textContent = "No habits are active for this day yet. Add habits in the studio and they will appear here automatically.";
      elements.checkInList.innerHTML = "";
      return;
    }

    if (boardContext.visibleWindows.length === 0) {
      elements.emptyCheckin.hidden = false;
      elements.emptyCheckin.textContent = "Nothing has opened yet for today. Upcoming habits will appear as soon as their window starts.";
      elements.checkInList.innerHTML = "";
      return;
    }

    const windowSections = buildWindowSections(boardContext.visibleWindows);

    elements.emptyCheckin.hidden = true;
    elements.checkInList.innerHTML = windowSections
      .map((windowSection) => {
        const windowMetrics = getWindowSummaryMetrics(windowSection, boardContext);
        const habitsHtml = windowSection.habits
          .map((habit) => {
            const cardKey = habit.appearanceKey || `${habit.id}::${windowSection.windowKey}`;
            const entry = boardContext.entriesByHabit.get(habit.id);
            const progress = boardContext.backendRef.getHabitProgress(habit, entry);
            const visualState = getHabitVisualState(habit, progress, boardContext);
            const appearanceMeta = getHabitAppearanceMeta(habit);
            const statusClass = `status-${visualState.statusTone}`;
            const targetText = buildTargetText(habit);
            const draftValue = getMeasureDraftValue(habit.id, state.selectedDateKey);
            const measureValue = draftValue !== undefined
              ? draftValue
              : (progress.value === "" ? "0" : String(progress.value));
            const progressWidth = `${Math.round(progress.progressRatio * 100)}%`;
            const timerMarkup = supportsHabitTimer(habit)
              ? (function () {
                  const timerKey = getTimerKey(habit.id, state.selectedDateKey);
                  const timerSession = getTimerSession(habit, state.selectedDateKey);
                  const timerMeta = getTimerMeta(habit, state.selectedDateKey);
                  return `
                    <div class="timer-panel">
                      <div class="timer-head">
                        <div class="timer-title">
                          <strong>Focus timer</strong>
                          <span>Starts from 0 and every pause adds this session to today's logged time.</span>
                        </div>
                        <div class="timer-readout">
                          <div class="timer-clock" data-timer-key="${escapeHtml(timerKey)}" data-habit-id="${escapeHtml(habit.id)}">${escapeHtml(timerMeta.clockText)}</div>
                          <div class="timer-state ${escapeHtml(timerMeta.stateClass)}" data-timer-state="${escapeHtml(timerKey)}">${escapeHtml(timerMeta.stateLabel)}</div>
                        </div>
                      </div>
                      <div class="timer-progress">
                        <div class="mini-progress timer-progress-bar">
                          <span data-timer-progress-fill="${escapeHtml(timerKey)}" style="width:${escapeHtml(timerMeta.progressWidth)};"></span>
                        </div>
                        <div class="timer-progress-copy" data-timer-progress-copy="${escapeHtml(timerKey)}">${escapeHtml(timerMeta.progressText)}</div>
                      </div>
                      <div class="timer-row">
                        <button
                          class="inline-action primary"
                          type="button"
                          data-action="start-timer"
                          data-habit-id="${escapeHtml(habit.id)}"
                          ${timerSession.running ? "disabled" : ""}
                        >${escapeHtml(timerMeta.actionLabel)}</button>
                        <button
                          class="inline-action"
                          type="button"
                          data-action="pause-timer"
                          data-habit-id="${escapeHtml(habit.id)}"
                          ${timerMeta.canPause ? "" : "disabled"}
                        >Pause</button>
                        <button
                          class="inline-action"
                          type="button"
                          data-action="reset-timer"
                          data-habit-id="${escapeHtml(habit.id)}"
                          ${timerMeta.canReset ? "" : "disabled"}
                        >Reset</button>
                      </div>
                    </div>
                  `;
                })()
              : "";

            const controls = habit.type === "measurable"
              ? `
                  ${timerMarkup}
                  <div class="measure-row">
                    <input
                      class="measure-input"
                      type="number"
                      step="any"
                      value="${escapeHtml(measureValue)}"
                      placeholder="${escapeHtml(habit.unit || "value")}"
                      data-entry-input="${escapeHtml(cardKey)}"
                      data-habit-id="${escapeHtml(habit.id)}"
                    />
                    <button class="inline-action primary" type="button" data-action="save-measure" data-habit-id="${escapeHtml(habit.id)}">Save</button>
                    <button class="inline-action" type="button" data-action="clear-entry" data-habit-id="${escapeHtml(habit.id)}">Reset</button>
                  </div>
                `
              : `
                  <div class="check-actions">
                    <button class="toggle-action done" type="button" data-action="mark-done" data-habit-id="${escapeHtml(habit.id)}">Done</button>
                    <button class="toggle-action reset" type="button" data-action="clear-entry" data-habit-id="${escapeHtml(habit.id)}">Reset</button>
                  </div>
                `;

            return `
              <article class="track-card ${statusClass}" data-card-key="${escapeHtml(cardKey)}" data-habit-id="${escapeHtml(habit.id)}">
                <div class="track-card-head">
                  <div>
                    <div class="track-card-title">${escapeHtml(habit.name)}</div>
                    <div class="track-card-meta">${escapeHtml(habit.category)} · ${escapeHtml(targetText)}</div>
                    ${appearanceMeta ? `<div class="track-card-flags"><span class="track-flag">${escapeHtml(appearanceMeta.label)}</span></div>` : ""}
                  </div>
                  <div class="track-status-chip ${statusClass}">${escapeHtml(visualState.label)}</div>
                </div>
                <div class="track-card-body">
                  <div class="track-support">
                    <div>
                      <span class="label">Days</span>
                      <strong>${escapeHtml(formatDays(habit.activeDays))}</strong>
                    </div>
                    <div>
                      <span class="label">Window</span>
                      <strong>${formatTime(habit.windowStart)} - ${formatTime(habit.windowEnd)}</strong>
                    </div>
                  </div>
                  <div class="mini-progress">
                    <span style="width:${progressWidth};"></span>
                  </div>
                  ${controls}
                  ${habit.notes ? `<p class="track-note">${escapeHtml(habit.notes)}</p>` : ""}
                </div>
              </article>
            `;
          })
          .join("");

        return `
          <details
            class="category-panel"
            data-board-panel="${escapeHtml(windowSection.windowKey)}"
            ${isBoardPanelOpen(windowSection.windowKey, state.selectedDateKey) ? "open" : ""}
          >
            <summary class="category-summary" data-window-summary-key="${escapeHtml(windowSection.windowKey)}">
              <div class="window-summary-head">
                <div class="category-title-wrap">
                  <div class="category-chip">${escapeHtml(windowSection.windowCopy)}</div>
                  <div class="category-copy">
                    ${windowSection.habits.length} habit${windowSection.habits.length === 1 ? "" : "s"} in this window${windowSection.categoriesText ? ` · ${escapeHtml(windowSection.categoriesText)}` : ""}
                  </div>
                </div>
                <div class="category-meta">
                  <div class="category-count">${escapeHtml(formatTime(windowSection.windowStart))} - ${escapeHtml(formatTime(windowSection.windowEnd))}</div>
                  <span class="category-toggle when-closed" aria-hidden="true">+</span>
                  <span class="category-toggle when-open" aria-hidden="true">-</span>
                </div>
              </div>
              <div class="window-summary-stats">
                <div class="window-summary-stat">
                  <span class="window-summary-label">Habits</span>
                  <strong data-window-total="${escapeHtml(windowSection.windowKey)}">${windowMetrics.totalHabits}</strong>
                </div>
                <div class="window-summary-stat">
                  <span class="window-summary-label">Done</span>
                  <strong data-window-done="${escapeHtml(windowSection.windowKey)}">${windowMetrics.doneCount}</strong>
                </div>
                <div class="window-summary-stat">
                  <span class="window-summary-label">Pending</span>
                  <strong data-window-pending="${escapeHtml(windowSection.windowKey)}">${windowMetrics.pendingCount}</strong>
                </div>
                <div class="window-summary-stat">
                  <span class="window-summary-label">Targeted time</span>
                  <strong data-window-target="${escapeHtml(windowSection.windowKey)}">${escapeHtml(windowMetrics.targetText)}</strong>
                </div>
                <div class="window-summary-stat">
                  <span class="window-summary-label">Time logged</span>
                  <strong data-window-logged="${escapeHtml(windowSection.windowKey)}">${escapeHtml(windowMetrics.loggedText)}</strong>
                </div>
                <div class="window-summary-stat">
                  <span class="window-summary-label" data-window-unused-label="${escapeHtml(windowSection.windowKey)}">${escapeHtml(windowMetrics.unusedLabel)}</span>
                  <strong data-window-unused-value="${escapeHtml(windowSection.windowKey)}">${escapeHtml(windowMetrics.unusedText)}</strong>
                </div>
              </div>
              <div class="window-summary-progress">
                <div class="mini-progress window-elapsed-bar">
                  <span data-window-elapsed-fill="${escapeHtml(windowSection.windowKey)}" style="width:${escapeHtml(windowMetrics.elapsedBarWidth)};"></span>
                </div>
                <div class="window-progress-copy" data-window-elapsed-copy="${escapeHtml(windowSection.windowKey)}">${escapeHtml(windowMetrics.elapsedCopy)}</div>
              </div>
            </summary>
            <div class="category-body">
              <div class="window-grid">${habitsHtml}</div>
            </div>
          </details>
        `;
      })
      .join("");
  }

  function renderHabitLibrary() {
    const habits = getReadBackend().listHabits();

    if (habits.length === 0) {
      elements.emptyLibrary.hidden = false;
      elements.habitList.innerHTML = "";
      return;
    }

    elements.emptyLibrary.hidden = true;
    elements.habitList.innerHTML = habits
      .map((habit) => {
        const habitModeText = habit.type === "measurable"
          ? getHabitTimerSupportText(habit)
          : "Checkbox habit";

        return `
        <article class="habit-card" data-habit-id="${escapeHtml(habit.id)}">
          <div class="habit-card-head">
            <div>
              <div class="habit-card-title">${escapeHtml(habit.name)}</div>
              <div class="habit-card-subtitle">${escapeHtml(habit.category)} · ${escapeHtml(habitModeText)}</div>
            </div>
            <div class="habit-card-actions">
              <button type="button" class="ghost-button" data-action="edit">Edit</button>
              <button type="button" class="ghost-button danger" data-action="delete">Delete</button>
            </div>
          </div>
          <div class="habit-card-grid">
            <div>
              <span class="label">Window</span>
              <strong>${escapeHtml(buildHabitWindowText(habit))}</strong>
            </div>
            <div>
              <span class="label">Target</span>
              <strong>${escapeHtml(buildTargetText(habit))}</strong>
            </div>
            <div>
              <span class="label">Days</span>
              <strong>${escapeHtml(formatDays(habit.activeDays))}</strong>
            </div>
            <div>
              <span class="label">Mode</span>
              <strong>${escapeHtml(habitModeText)}</strong>
            </div>
          </div>
          ${habit.notes ? `<p class="habit-card-notes">${escapeHtml(habit.notes)}</p>` : ""}
        </article>
      `;
      })
      .join("");
  }

  function setFormForCreate() {
    state.editingHabitId = null;
    elements.formTitle.textContent = "Create a new habit";
    elements.habitId.value = "";
    elements.form.reset();
    setSelectedDays(googleBackend.DAY_ORDER);
    elements.habitWindowStart.value = "07:00";
    elements.habitWindowEnd.value = "07:30";
    elements.habitTarget.value = "1";
    elements.habitType.value = "checkbox";
    renderEditorRepeatWindows([]);
    refreshRepeatWindowOptions();
    updateTypeUi();
  }

  function setFormForEdit(habit) {
    state.editingHabitId = habit.id;
    elements.formTitle.textContent = `Editing ${habit.name}`;
    elements.habitId.value = habit.id;
    elements.habitName.value = habit.name;
    elements.habitCategory.value = habit.category;
    elements.habitType.value = habit.type;
    elements.habitUnit.value = habit.unit;
    elements.habitTarget.value = String(habit.target);
    elements.habitWindowStart.value = habit.windowStart;
    elements.habitWindowEnd.value = habit.windowEnd;
    elements.habitNotes.value = habit.notes;
    renderEditorRepeatWindows(habit.repeatWindows || []);
    refreshRepeatWindowOptions();
    setSelectedDays(habit.activeDays);
    updateTypeUi();
  }

  function ensureWritable(actionText) {
    const status = googleBackend.getStatus();

    if (status.signedIn) {
      return true;
    }

    if (localBackend) {
      return true;
    }

    if (isFileProtocol()) {
      window.alert("This page is running from file://. Open it through http://localhost to connect Google Sheets.");
      return false;
    }

    if (!status.configured) {
      window.alert("Google Sheets config is missing in system_habits_config.local.js.");
      return false;
    }

    if (!status.ready) {
      window.alert("Google Sheets is still preparing. Please wait a moment and try again.");
      return false;
    }

    window.alert(`Connect Google Sheets before ${actionText}.`);
    elements.connectButton.focus();
    return false;
  }

  async function saveMeasuredHabit(habitId, rawValue) {
    if (!ensureWritable("saving day entries")) {
      return;
    }

    const writeBackend = getWriteBackend();
    const habit = writeBackend.getHabit(habitId) || getReadBackend().getHabit(habitId);
    if (!habit) {
      return;
    }

    const textValue = String(rawValue || "").trim();
    if (!textValue) {
      await Promise.resolve(writeBackend.clearEntry(habitId, state.selectedDateKey));
      clearMeasureDraftValue(habitId, state.selectedDateKey);
      syncTimerSnapshot(habitId, state.selectedDateKey, 0);
      render();
      return;
    }

    const numericValue = Number(textValue);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      window.alert("Please enter a valid non-negative number.");
      return;
    }

    await Promise.resolve(writeBackend.saveEntry({
      habitId: habitId,
      dateKey: state.selectedDateKey,
      status: "logged",
      value: numericValue
    }));
    clearMeasureDraftValue(habitId, state.selectedDateKey);
    syncTimerSnapshot(habitId, state.selectedDateKey, numericValue);
    render();
  }

  function render() {
    const boardContext = buildBoardContext();
    renderHeaderMeta();
    renderStats(boardContext);
    renderDailyBoard(boardContext);
    renderHabitLibrary();
    renderBackendData();
    syncTimerTicker();
    refreshVisibleWindowSummaries();
    refreshVisibleTimerDisplays();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!ensureWritable("saving habits")) {
      return;
    }

    const activeDays = getSelectedDays();
    if (activeDays.length === 0) {
      window.alert("Select at least one active day for the habit.");
      return;
    }

    const habitInput = {
      id: elements.habitId.value || undefined,
      name: elements.habitName.value,
      category: elements.habitCategory.value,
      type: elements.habitType.value,
      unit: elements.habitUnit.value,
      target: elements.habitTarget.value,
      windowStart: elements.habitWindowStart.value,
      windowEnd: elements.habitWindowEnd.value,
      activeDays: activeDays,
      notes: elements.habitNotes.value,
      repeatWindows: getEditorRepeatWindows()
    };

    if (!habitInput.name.trim()) {
      window.alert("Habit name is required.");
      return;
    }

    if (!habitInput.windowStart || !habitInput.windowEnd) {
      window.alert("Please choose a start and end time.");
      return;
    }

    try {
      const savedHabit = await Promise.resolve(getWriteBackend().saveHabit(habitInput));
      if (savedHabit) {
        setFormForEdit(savedHabit);
      } else {
        setFormForCreate();
      }
      render();
    } catch (error) {
      console.error(error);
      window.alert(error && error.message ? error.message : "Could not save the habit to Google Sheets.");
    }
  }

  async function handleListClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const card = button.closest("[data-habit-id]");
    if (!card) {
      return;
    }

    const habitId = card.getAttribute("data-habit-id");
    const habit = getReadBackend().getHabit(habitId);
    if (!habit) {
      return;
    }

    const action = button.getAttribute("data-action");
    if (action === "edit") {
      setFormForEdit(habit);
      elements.habitName.focus();
      return;
    }

    if (action === "delete") {
      if (!ensureWritable("deleting habits")) {
        return;
      }

      const shouldDelete = window.confirm(`Delete "${habit.name}" from your master list?`);
      if (!shouldDelete) {
        return;
      }

      try {
        await Promise.resolve(getWriteBackend().deleteHabit(habit.id));
        clearHabitTransientState(habit.id);
        if (state.editingHabitId === habit.id) {
          setFormForCreate();
        }
        render();
      } catch (error) {
        console.error(error);
        window.alert(error && error.message ? error.message : "Could not delete the habit from Google Sheets.");
      }
    }
  }

  async function handleCheckInClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    if (!ensureWritable("recording check-ins")) {
      return;
    }

    const action = button.getAttribute("data-action");
    const habitId = button.getAttribute("data-habit-id");
    const writeBackend = getWriteBackend();

    try {
      if (action === "start-timer") {
        startHabitTimer(habitId);
        return;
      }

      if (action === "pause-timer") {
        await pauseHabitTimer(habitId);
        return;
      }

      if (action === "reset-timer") {
        resetHabitTimer(habitId);
        return;
      }

      if (action === "save-measure") {
        const card = button.closest("[data-card-key]");
        const input = card
          ? card.querySelector("[data-entry-input]")
          : document.querySelector(`[data-entry-input][data-habit-id="${habitId}"]`);
        await saveMeasuredHabit(habitId, input ? input.value : "");
        return;
      }

      if (action === "mark-done") {
        await Promise.resolve(writeBackend.saveEntry({
          habitId: habitId,
          dateKey: state.selectedDateKey,
          status: "done",
          value: ""
        }));
        render();
        return;
      }

      if (action === "clear-entry") {
        await Promise.resolve(writeBackend.clearEntry(habitId, state.selectedDateKey));
        clearMeasureDraftValue(habitId, state.selectedDateKey);
        syncTimerSnapshot(habitId, state.selectedDateKey, 0);
        render();
      }
    } catch (error) {
      console.error(error);
      window.alert(error && error.message ? error.message : "Could not update the habit entry.");
    }
  }

  function setSelectedDate(dateLike) {
    state.selectedDateKey = googleBackend.formatDateKey(dateLike);
    render();
  }

  function shiftSelectedDate(days) {
    const date = getSelectedDate();
    date.setDate(date.getDate() + days);
    setSelectedDate(date);
  }

  function bindEvents() {
    elements.form.addEventListener("submit", handleSubmit);
    elements.habitList.addEventListener("click", handleListClick);
    elements.resetButton.addEventListener("click", setFormForCreate);
    elements.habitType.addEventListener("change", updateTypeUi);
    if (elements.habitWindowStart) {
      elements.habitWindowStart.addEventListener("change", refreshRepeatWindowOptions);
    }
    if (elements.habitWindowEnd) {
      elements.habitWindowEnd.addEventListener("change", refreshRepeatWindowOptions);
    }
    if (elements.habitRepeatWindowSelect) {
      elements.habitRepeatWindowSelect.addEventListener("change", addRepeatWindowFromSelect);
    }
    if (elements.habitRepeatWindowList) {
      elements.habitRepeatWindowList.addEventListener("click", function (event) {
        const removeButton = event.target.closest("[data-remove-repeat-window]");
        if (!removeButton) {
          return;
        }

        removeEditorRepeatWindow(removeButton.getAttribute("data-remove-repeat-window"));
      });
    }
    elements.checkInList.addEventListener("click", handleCheckInClick);
    elements.checkInList.addEventListener("click", function (event) {
      const summary = event.target.closest("summary.category-summary");
      if (!summary) {
        return;
      }

      const details = summary.closest("details[data-board-panel]");
      if (!details) {
        return;
      }

      window.setTimeout(function () {
        setBoardPanelOpen(details.getAttribute("data-board-panel"), state.selectedDateKey, details.open);
      }, 0);
    });
    elements.checkInList.addEventListener("input", function (event) {
      const measureInput = event.target.closest("[data-entry-input]");
      if (measureInput) {
        const habitId = measureInput.getAttribute("data-habit-id");
        if (!habitId) {
          return;
        }

        setMeasureDraftValue(habitId, state.selectedDateKey, measureInput.value);
        syncVisibleMeasureInputs(habitId, measureInput.value, measureInput);
        refreshVisibleWindowSummaries();
        refreshVisibleTimerDisplays();
        return;
      }
    });
    elements.dayInput.addEventListener("change", function (event) {
      if (event.target.value) {
        setSelectedDate(event.target.value);
      }
    });
    elements.todayButton.addEventListener("click", function () {
      setSelectedDate(new Date());
    });
    elements.prevDayButton.addEventListener("click", function () {
      shiftSelectedDate(-1);
    });
    elements.nextDayButton.addEventListener("click", function () {
      shiftSelectedDate(1);
    });
    elements.connectButton.addEventListener("click", async function () {
      if (isFileProtocol()) {
        window.alert("Google Sheets sign-in will not work from file://. Open the app through http://localhost and then connect.");
        return;
      }

      try {
        await googleBackend.signIn();
      } catch (error) {
        console.error(error);
        window.alert("Could not connect Google Sheets. Please check the OAuth origin, then try again.");
      }
    });
    elements.syncButton.addEventListener("click", async function () {
      try {
        if (isFileProtocol()) {
          window.alert("Google Sheets sync needs http://localhost instead of file://.");
          return;
        }

        if (!googleBackend.getStatus().signedIn) {
          window.alert("Connect Google Sheets first, then sync.");
          return;
        }
        await googleBackend.sync();
      } catch (error) {
        console.error(error);
        window.alert(error && error.message ? error.message : "Could not sync Google Sheets.");
      }
    });
    elements.signOutButton.addEventListener("click", function () {
      googleBackend.signOut();
      setFormForCreate();
      render();
    });
    elements.checkInList.addEventListener("keydown", async function (event) {
      if (event.key !== "Enter") {
        return;
      }

      const input = event.target.closest("[data-entry-input]");
      if (!input) {
        return;
      }

      event.preventDefault();

      try {
        await saveMeasuredHabit(input.getAttribute("data-habit-id"), input.value);
      } catch (error) {
        console.error(error);
        window.alert(error && error.message ? error.message : "Could not save the measurable habit.");
      }
    });
    window.addEventListener("pagehide", persistTimerState);
    window.addEventListener("beforeunload", persistTimerState);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        persistTimerState();
      }
    });
  }

  function init() {
    googleBackend.subscribe(render);
    bindEvents();
    setFormForCreate();
    render();
    Promise.resolve(googleBackend.initialize())
      .then(render)
      .catch(function (error) {
        console.error(error);
        render();
      });
  }

  init();
})(window, document);
