(function (window) {
  "use strict";

  const shared = window.SystemHabitsShared || {};
  const config = shared.config || {};
  const hasCompleteConfig = typeof shared.hasCompleteConfig === "function"
    ? shared.hasCompleteConfig
    : function () {
        return false;
      };

  const AUTH_FLAG_KEY = "system_habits_google_auth";
  const LEGACY_LOCAL_STORAGE_KEY = "system-habits-studio-v1";
  const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const ENTRY_STATUS = ["pending", "done", "skipped", "logged"];
  const SHEETS = {
    habits: {
      title: "StudioHabits",
      headers: [
        "id",
        "name",
        "category",
        "type",
        "unit",
        "target",
        "windowStart",
        "windowEnd",
        "activeDays",
        "notes",
        "createdAt",
        "updatedAt",
        "repeatWindows",
        "repeatWindowTargets",
        "savedAt"
      ]
    },
    entries: {
      title: "StudioEntries",
      headers: [
        "id",
        "habitId",
        "dateKey",
        "status",
        "value",
        "note",
        "updatedAt",
        "windowAllocations"
      ]
    }
  };

  const listeners = new Set();
  let tokenClient = null;
  let gapiReady = false;
  let gisReady = false;

  const state = {
    habits: [],
    entries: [],
    meta: {
      backend: "Google Sheets",
      spreadsheetId: config.spreadsheetId || "",
      sheets: {
        habits: SHEETS.habits.title,
        entries: SHEETS.entries.title
      },
      lastSyncedAt: null
    },
    status: {
      configured: hasCompleteConfig(),
      ready: false,
      signedIn: false,
      syncing: false,
      needsReconnect: false,
      error: ""
    }
  };

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function updateStatus(patch) {
    state.status = {
      ...state.status,
      ...patch
    };
    emit();
  }

  function getGoogleErrorCode(error) {
    const directCode = Number(error && error.status);
    if (Number.isFinite(directCode)) {
      return directCode;
    }

    const resultCode = Number(error && error.result && error.result.error && error.result.error.code);
    if (Number.isFinite(resultCode)) {
      return resultCode;
    }

    const nestedCode = Number(error && error.error && error.error.code);
    if (Number.isFinite(nestedCode)) {
      return nestedCode;
    }

    return 0;
  }

  function getGoogleErrorText(error) {
    return String(
      (error && error.message)
      || (error && error.result && error.result.error && error.result.error.message)
      || (error && error.error && error.error.message)
      || ""
    ).toLowerCase();
  }

  function isReconnectRequiredError(error) {
    const code = getGoogleErrorCode(error);
    if (code === 401 || code === 403) {
      return true;
    }

    const text = getGoogleErrorText(error);
    return text.includes("invalid credentials")
      || text.includes("login required")
      || text.includes("request had invalid authentication credentials")
      || (text.includes("token") && text.includes("expired"))
      || (text.includes("access token") && text.includes("invalid"))
      || (text.includes("auth") && text.includes("expired"));
  }

  function buildReconnectError(message, cause) {
    const reconnectError = new Error(message);
    reconnectError.cause = cause;
    reconnectError.requiresReconnect = true;
    return reconnectError;
  }

  function handleGoogleFailure(error, fallbackMessage, reconnectMessage) {
    if (isReconnectRequiredError(error)) {
      if (window.gapi && window.gapi.client) {
        window.gapi.client.setToken("");
      }
      window.localStorage.removeItem(AUTH_FLAG_KEY);
      updateStatus({
        needsReconnect: true,
        syncing: false,
        error: reconnectMessage
      });
      return buildReconnectError(reconnectMessage, error);
    }

    updateStatus({
      needsReconnect: false,
      syncing: false,
      error: fallbackMessage
    });
    return error;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return function unsubscribe() {
      listeners.delete(listener);
    };
  }

  function requireSignedIn() {
    if (!state.status.signedIn) {
      throw new Error("Connect Google Sheets before saving or syncing data.");
    }
  }

  function formatDateKey(dateLike) {
    const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function normalizeTime(value, fallback) {
    const candidate = String(value || fallback || "").trim();
    if (/^\d{2}:\d{2}$/.test(candidate)) {
      return candidate;
    }
    return fallback || "07:00";
  }

  function normalizeDays(days) {
    const source = Array.isArray(days)
      ? days
      : String(days || "")
          .split(",")
          .map((day) => day.trim())
          .filter(Boolean);

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
      repeatWindowTargets: normalizeRepeatWindowTargets(habit.repeatWindowTargets, repeatWindows, type),
      savedAt: habit.savedAt || null
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
    return state.habits.slice().sort(compareHabits);
  }

  function getHabit(id) {
    return listHabits().find((habit) => habit.id === id) || null;
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
    return state.entries.filter((entry) => entry.dateKey === dateKey);
  }

  function getEntryForDate(habitId, dateLike) {
    const dateKey = formatDateKey(dateLike);
    return state.entries.find((entry) => entry.habitId === habitId && entry.dateKey === dateKey) || null;
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
    const entriesByHabit = new Map(listEntriesForDate(dateLike).map((entry) => [entry.habitId, entry]));

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

  function getStateSnapshot() {
    return JSON.parse(JSON.stringify({
      habits: state.habits,
      entries: state.entries,
      meta: state.meta,
      status: state.status
    }));
  }

  function getMeta() {
    return {
      ...state.meta,
      authReady: state.status.ready,
      signedIn: state.status.signedIn
    };
  }

  function getStatus() {
    return {
      ...state.status
    };
  }

  function readLegacyLocalState() {
    try {
      const raw = window.localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      const habits = Array.isArray(parsed.habits)
        ? parsed.habits.map(normalizeHabit).filter((habit) => habit && habit.name)
        : [];
      const habitIds = new Set(habits.map((habit) => habit.id));
      const entries = Array.isArray(parsed.entries)
        ? parsed.entries
            .map(normalizeEntry)
            .filter((entry) => entry && habitIds.has(entry.habitId))
        : [];

      if (habits.length === 0 && entries.length === 0) {
        return null;
      }

      return {
        habits: habits,
        entries: entries
      };
    } catch (error) {
      console.error("Could not read the local System Habits backup:", error);
      return null;
    }
  }

  async function ensureGapiClient() {
    if (!window.gapi || !config.apiKey) {
      return;
    }

    await new Promise((resolve) => {
      window.gapi.load("client", resolve);
    });

    await window.gapi.client.init({
      apiKey: config.apiKey,
      discoveryDocs: ["https://sheets.googleapis.com/$discovery/rest?version=v4"]
    });
  }

  function markReadyIfPossible() {
    const ready = state.status.configured && gapiReady && gisReady;
    updateStatus({
      ready: ready
    });

    if (ready && window.localStorage.getItem(AUTH_FLAG_KEY) === "true" && !state.status.signedIn) {
      signIn().catch((error) => {
        console.error(error);
      });
    }
  }

  async function initialize() {
    if (!state.status.configured) {
      updateStatus({
        error: "Google Sheets config is missing."
      });
      return;
    }

    if (window.gapi && !gapiReady) {
      await handleGapiLoaded();
    }

    if (window.google && window.google.accounts && window.google.accounts.oauth2 && !gisReady) {
      handleGisLoaded();
    }

    markReadyIfPossible();
  }

  async function handleGapiLoaded() {
    if (gapiReady || !state.status.configured) {
      return;
    }

    try {
      await ensureGapiClient();
      gapiReady = true;
      updateStatus({
        error: ""
      });
      markReadyIfPossible();
    } catch (error) {
      console.error(error);
      updateStatus({
        error: "Could not initialize the Google Sheets client."
      });
    }
  }

  function handleGisLoaded() {
    if (gisReady || !state.status.configured || !window.google || !window.google.accounts) {
      return;
    }

    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: config.scopes,
      callback: ""
    });

    gisReady = true;
    updateStatus({
      error: ""
    });
    markReadyIfPossible();
  }

  async function signIn() {
    if (!state.status.ready || !tokenClient) {
      throw new Error("Google auth is not ready yet.");
    }

    return new Promise((resolve, reject) => {
      tokenClient.callback = async function (response) {
        if (response && response.error) {
          updateStatus({
            error: "Google sign-in failed."
          });
          reject(response);
          return;
        }

        try {
          window.localStorage.setItem(AUTH_FLAG_KEY, "true");
          updateStatus({
            signedIn: true,
            needsReconnect: false,
            error: ""
          });
          await sync();
          resolve();
        } catch (error) {
          console.error(error);
          updateStatus({
            error: "Connected, but syncing the new Sheets backend failed."
          });
          reject(error);
        }
      };

      const prompt = window.gapi && window.gapi.client && window.gapi.client.getToken() ? "" : "consent";
      tokenClient.requestAccessToken({
        prompt: prompt
      });
    });
  }

  function signOut() {
    const token = window.gapi && window.gapi.client ? window.gapi.client.getToken() : null;
    if (token && window.google && window.google.accounts && window.google.accounts.oauth2) {
      window.google.accounts.oauth2.revoke(token.access_token);
      window.gapi.client.setToken("");
    }

    window.localStorage.removeItem(AUTH_FLAG_KEY);
    state.habits = [];
    state.entries = [];
    state.meta.lastSyncedAt = null;
    updateStatus({
      signedIn: false,
      syncing: false,
      needsReconnect: false,
      error: ""
    });
  }

  async function fetchSpreadsheetMetadata() {
    const response = await window.gapi.client.sheets.spreadsheets.get({
      spreadsheetId: config.spreadsheetId
    });
    return response.result.sheets || [];
  }

  async function ensureSheetExists(sheetTitle) {
    const sheets = await fetchSpreadsheetMetadata();
    const existing = sheets.find((sheet) => sheet.properties && sheet.properties.title === sheetTitle);
    if (existing) {
      return;
    }

    await window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.spreadsheetId,
      resource: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetTitle
              }
            }
          }
        ]
      }
    });
  }

  async function ensureHeaders(sheetConfig) {
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `${sheetConfig.title}!A1:Z1`
    });

    const values = response.result.values || [];
    const currentHeader = values[0] || [];
    const expectedHeader = sheetConfig.headers;
    const matches = expectedHeader.every((header, index) => currentHeader[index] === header);

    if (!matches) {
      await window.gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: config.spreadsheetId,
        range: `${sheetConfig.title}!A1`,
        valueInputOption: "RAW",
        resource: {
          values: [expectedHeader]
        }
      });
    }
  }

  async function ensureSheetsSetup() {
    await ensureSheetExists(SHEETS.habits.title);
    await ensureSheetExists(SHEETS.entries.title);
    await ensureHeaders(SHEETS.habits);
    await ensureHeaders(SHEETS.entries);
  }

  async function readSheetRows(sheetTitle) {
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: sheetTitle
    });

    return response.result.values || [];
  }

  function parseHabitRows(rows) {
    return rows
      .slice(1)
      .map((row) => normalizeHabit({
        id: row[0],
        name: row[1],
        category: row[2],
        type: row[3],
        unit: row[4],
        target: row[5],
        windowStart: row[6],
        windowEnd: row[7],
        activeDays: row[8],
        notes: row[9],
        createdAt: row[10],
        updatedAt: row[11],
        repeatWindows: row[12],
        repeatWindowTargets: row[13],
        savedAt: row[14] || null
      }))
      .filter(Boolean);
  }

  function parseEntryRows(rows) {
    return rows
      .slice(1)
      .map((row) => normalizeEntry({
        id: row[0],
        habitId: row[1],
        dateKey: row[2],
        status: row[3],
        value: row[4],
        note: row[5],
        updatedAt: row[6],
        windowAllocations: row[7]
      }))
      .filter(Boolean);
  }

  function toHabitRows() {
    return state.habits.map((habit) => [
      habit.id,
      habit.name,
      habit.category,
      habit.type,
      habit.unit,
      habit.target,
      habit.windowStart,
      habit.windowEnd,
      habit.activeDays.join(","),
      habit.notes,
      habit.createdAt,
      habit.updatedAt,
      (habit.repeatWindows || []).join("|"),
      Object.keys(habit.repeatWindowTargets || {}).length
        ? JSON.stringify(habit.repeatWindowTargets)
        : "",
      habit.savedAt || ""
    ]);
  }

  function toEntryRows() {
    return state.entries.map((entry) => [
      entry.id,
      entry.habitId,
      entry.dateKey,
      entry.status,
      entry.value === "" ? "" : entry.value,
      entry.note,
      entry.updatedAt,
      Object.keys(entry.windowAllocations || {}).length
        ? JSON.stringify(entry.windowAllocations)
        : ""
    ]);
  }

  async function writeSheet(sheetConfig, rows) {
    await window.gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId: config.spreadsheetId,
      range: sheetConfig.title
    });

    await window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${sheetConfig.title}!A1`,
      valueInputOption: "RAW",
      resource: {
        values: [sheetConfig.headers].concat(rows)
      }
    });
  }

  async function importLegacyLocalDataIfNeeded() {
    if (state.habits.length > 0 || state.entries.length > 0) {
      return false;
    }

    const legacyState = readLegacyLocalState();
    if (!legacyState) {
      return false;
    }

    state.habits = legacyState.habits;
    state.entries = legacyState.entries;
    await Promise.all([writeSheet(SHEETS.habits, toHabitRows()), writeSheet(SHEETS.entries, toEntryRows())]);
    state.meta.lastSyncedAt = new Date().toISOString();
    emit();
    return true;
  }

  async function persistHabits() {
    await writeSheet(SHEETS.habits, toHabitRows());
  }

  async function persistEntries() {
    await writeSheet(SHEETS.entries, toEntryRows());
  }

  async function sync() {
    requireSignedIn();

    updateStatus({
      syncing: true,
      error: ""
    });

    try {
      await ensureSheetsSetup();
      const [habitRows, entryRows] = await Promise.all([
        readSheetRows(SHEETS.habits.title),
        readSheetRows(SHEETS.entries.title)
      ]);

      state.habits = parseHabitRows(habitRows);
      state.entries = parseEntryRows(entryRows);
      await importLegacyLocalDataIfNeeded();
      state.meta.lastSyncedAt = new Date().toISOString();
      updateStatus({
        syncing: false,
        error: ""
      });
    } catch (error) {
      console.error(error);
      throw handleGoogleFailure(
        error,
        "Could not sync StudioHabits / StudioEntries from Google Sheets.",
        "Google session expired. Connect Google Sheets again, then sync Riseloop."
      );
    }
  }

  async function saveHabit(habitInput) {
    requireSignedIn();

    const normalized = normalizeHabit(habitInput);
    if (!normalized || !normalized.name) {
      throw new Error("Habit name is required.");
    }

    const previousHabits = state.habits.slice();
    const index = state.habits.findIndex((habit) => habit.id === normalized.id);
    if (index >= 0) {
      normalized.createdAt = state.habits[index].createdAt;
      state.habits[index] = normalized;
    } else {
      state.habits.push(normalized);
    }

    updateStatus({
      syncing: true,
      error: ""
    });

    try {
      await persistHabits();
      state.meta.lastSyncedAt = new Date().toISOString();
      updateStatus({
        syncing: false,
        error: ""
      });
      emit();
      return normalized;
    } catch (error) {
      state.habits = previousHabits;
      throw handleGoogleFailure(
        error,
        "Could not save the master habit list to Google Sheets.",
        "Google session expired. Connect Google Sheets again, then save the master habit list."
      );
    }

    return normalized;
  }

  async function deleteHabit(id) {
    requireSignedIn();
    const previousHabits = state.habits.slice();
    const previousEntries = state.entries.slice();
    state.habits = state.habits.filter((habit) => habit.id !== id);
    state.entries = state.entries.filter((entry) => entry.habitId !== id);

    updateStatus({
      syncing: true,
      error: ""
    });

    try {
      await Promise.all([persistHabits(), persistEntries()]);
      state.meta.lastSyncedAt = new Date().toISOString();
      updateStatus({
        syncing: false,
        error: ""
      });
      emit();
    } catch (error) {
      state.habits = previousHabits;
      state.entries = previousEntries;
      throw handleGoogleFailure(
        error,
        "Could not delete the habit from Google Sheets.",
        "Google session expired. Connect Google Sheets again, then delete the habit."
      );
    }
  }

  async function saveEntry(entryInput) {
    requireSignedIn();
    const normalized = normalizeEntry(entryInput);
    if (!normalized) {
      throw new Error("A habit entry needs at least a habitId and date.");
    }

    const previousEntries = state.entries.slice();
    const index = state.entries.findIndex(
      (entry) => entry.habitId === normalized.habitId && entry.dateKey === normalized.dateKey
    );

    if (index >= 0) {
      normalized.id = state.entries[index].id;
      state.entries[index] = normalized;
    } else {
      state.entries.push(normalized);
    }

    updateStatus({
      syncing: true,
      error: ""
    });

    try {
      await persistEntries();
      state.meta.lastSyncedAt = new Date().toISOString();
      updateStatus({
        syncing: false,
        error: ""
      });
      emit();
    } catch (error) {
      state.entries = previousEntries;
      throw handleGoogleFailure(
        error,
        "Could not save the day entry to Google Sheets.",
        "Google session expired. Connect Google Sheets again, then press Pause or Save again."
      );
    }

    return normalized;
  }

  async function clearEntry(habitId, dateLike) {
    requireSignedIn();
    const dateKey = formatDateKey(dateLike);
    const previousEntries = state.entries.slice();
    state.entries = state.entries.filter(
      (entry) => !(entry.habitId === habitId && entry.dateKey === dateKey)
    );

    updateStatus({
      syncing: true,
      error: ""
    });

    try {
      await persistEntries();
      state.meta.lastSyncedAt = new Date().toISOString();
      updateStatus({
        syncing: false,
        error: ""
      });
      emit();
    } catch (error) {
      state.entries = previousEntries;
      throw handleGoogleFailure(
        error,
        "Could not reset the entry in Google Sheets.",
        "Google session expired. Connect Google Sheets again, then reset the entry again."
      );
    }
  }

  window.SystemHabitsBackend = {
    DAY_ORDER: DAY_ORDER.slice(),
    ENTRY_STATUS: ENTRY_STATUS.slice(),
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
    getStatus: getStatus,
    initialize: initialize,
    listEntriesForDate: listEntriesForDate,
    listHabits: listHabits,
    listHabitsForDate: listHabitsForDate,
    listWindowsForDate: listWindowsForDate,
    saveEntry: saveEntry,
    saveHabit: saveHabit,
    signIn: signIn,
    signOut: signOut,
    subscribe: subscribe,
    sync: sync
  };

  window.systemHabitsGapiLoaded = handleGapiLoaded;
  window.systemHabitsGisLoaded = handleGisLoaded;
})(window);


