(function (window) {
  "use strict";

  const configFromWindow = window.SystemHabitsConfig || {};
  const config = {
    apiKey: String(configFromWindow.apiKey || "").trim(),
    spreadsheetId: String(configFromWindow.spreadsheetId || "").trim(),
    clientId: String(configFromWindow.clientId || "").trim(),
    scopes: String(
      configFromWindow.scopes || "https://www.googleapis.com/auth/spreadsheets"
    ).trim()
  };
  const requiredConfigKeys = ["apiKey", "spreadsheetId", "clientId"];

  function readCell(columns, index, fallback) {
    const value = columns[index];
    if (value === undefined || value === null || value === "") {
      return fallback;
    }
    return value;
  }

  function readText(columns, index, fallback) {
    return String(readCell(columns, index, fallback) || "").trim();
  }

  function parseHabitsSheet(sheetData) {
    const rows = Array.isArray(sheetData) ? sheetData.slice(1) : [];

    return rows
      .map((columns) => {
        if (!Array.isArray(columns) || columns.length === 0) {
          return null;
        }

        const habitName = readText(columns, 4, "");
        if (!habitName) {
          return null;
        }

        const targetPerDay = readCell(columns, 8, readCell(columns, 9, ""));

        return {
          windowStarts: readText(columns, 0, ""),
          windowEnds: readText(columns, 1, ""),
          activeDays: readText(columns, 3, ""),
          habit: habitName,
          category: readText(columns, 5, "Uncategorized") || "Uncategorized",
          type: readText(columns, 6, ""),
          units: readText(columns, 7, ""),
          targetPerDay: targetPerDay
        };
      })
      .filter(Boolean);
  }

  function parseLogDate(rawDate) {
    let date = null;

    if (typeof rawDate === "number") {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      date = new Date(excelEpoch.getTime() + rawDate * 86400000);
    } else if (typeof rawDate === "string" && rawDate.trim() !== "") {
      const trimmedDate = rawDate.trim();

      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
        const parts = trimmedDate.split("-");
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);

        if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
          date = new Date(Date.UTC(year, month, day));
        }
      } else {
        const parsed = new Date(trimmedDate);
        if (!isNaN(parsed.getTime())) {
          date = new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
        }
      }
    }

    if (!date || isNaN(date.getTime())) {
      return null;
    }

    return date;
  }

  function parseLogSheet(sheetData) {
    const rows = Array.isArray(sheetData) ? sheetData.slice(1) : [];

    return rows
      .map((row) => {
        if (!Array.isArray(row) || row.length === 0) {
          return null;
        }

        const date = parseLogDate(row[0]);
        if (!date) {
          return null;
        }

        return {
          date: date,
          habit: String(row[1] || "").trim(),
          status: row[2],
          value: row[3],
          schedule: row[4] || null
        };
      })
      .filter(Boolean);
  }

  function getMissingConfigKeys() {
    return requiredConfigKeys.filter((key) => !config[key]);
  }

  function hasCompleteConfig() {
    return getMissingConfigKeys().length === 0;
  }

  window.SystemHabitsShared = {
    config: config,
    getMissingConfigKeys: getMissingConfigKeys,
    hasCompleteConfig: hasCompleteConfig,
    parseHabitsSheet: parseHabitsSheet,
    parseLogDate: parseLogDate,
    parseLogSheet: parseLogSheet
  };
})(window);
