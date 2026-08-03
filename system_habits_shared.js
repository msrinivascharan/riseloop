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

/* ------------------------------------------------------------------ *
 * Toast notifications — a non-blocking, themed replacement for the
 * blocking window.alert() used across the app. Self-contained: injects
 * its own styles and container, and overrides window.alert so every
 * existing alert() call becomes a toast. No other code needs to change.
 * ------------------------------------------------------------------ */
(function (window) {
  "use strict";
  var doc = window.document;
  if (!doc) { return; }

  var STYLE_ID = "riseloop-toast-style";
  var CONTAINER_ID = "riseloop-toast-container";
  var activeToasts = {};

  function ensureStyle() {
    if (doc.getElementById(STYLE_ID)) { return; }
    var css =
      "#" + CONTAINER_ID + "{position:fixed;top:16px;right:16px;z-index:99999;" +
      "display:flex;flex-direction:column;gap:10px;" +
      "max-width:min(360px,calc(100vw - 32px));pointer-events:none;}" +
      ".riseloop-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;" +
      "padding:12px 14px;border-radius:14px;background:var(--paper-strong,#fff);" +
      "color:var(--text,#33291d);border:1px solid var(--line,rgba(198,143,92,.22));" +
      "border-left:4px solid var(--danger,#e2674f);box-shadow:0 12px 30px rgba(120,70,20,.16);" +
      "font:600 0.9rem/1.4 var(--font-main,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);" +
      "letter-spacing:-0.01em;opacity:0;transform:translateX(12px);" +
      "transition:opacity .25s ease,transform .25s ease;cursor:pointer;}" +
      ".riseloop-toast.show{opacity:1;transform:none;}" +
      ".riseloop-toast .rt-ico{flex:none;font-size:1rem;line-height:1.35;}" +
      ".riseloop-toast .rt-msg{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word;}" +
      "@media (prefers-reduced-motion:reduce){.riseloop-toast{transition:none;}}";
    var style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function ensureContainer() {
    var c = doc.getElementById(CONTAINER_ID);
    if (!c) {
      c = doc.createElement("div");
      c.id = CONTAINER_ID;
      c.setAttribute("role", "status");
      c.setAttribute("aria-live", "polite");
      (doc.body || doc.documentElement).appendChild(c);
    }
    return c;
  }

  function showToast(message, options) {
    options = options || {};
    ensureStyle();
    var container = ensureContainer();

    // De-duplicate: if the same message is already showing, refresh its timer
    // instead of stacking another identical toast.
    var text = String(message == null ? "" : message);
    if (activeToasts[text]) { activeToasts[text].bump(); return activeToasts[text].dismiss; }

    var toast = doc.createElement("div");
    toast.className = "riseloop-toast";

    var ico = doc.createElement("span");
    ico.className = "rt-ico";
    ico.textContent = options.icon || "⚠️";

    var msg = doc.createElement("span");
    msg.className = "rt-msg";
    msg.textContent = text;

    toast.appendChild(ico);
    toast.appendChild(msg);
    container.appendChild(toast);

    // Fade/slide in (setTimeout, not rAF, so it also works in background tabs).
    window.setTimeout(function () { toast.classList.add("show"); }, 10);

    var timer = null;
    var ms = typeof options.duration === "number" ? options.duration : 5000;
    function dismiss() {
      if (timer) { window.clearTimeout(timer); timer = null; }
      delete activeToasts[text];
      toast.classList.remove("show");
      window.setTimeout(function () {
        if (toast.parentNode) { toast.parentNode.removeChild(toast); }
      }, 260);
    }
    function bump() { if (ms > 0) { if (timer) { window.clearTimeout(timer); } timer = window.setTimeout(dismiss, ms); } }
    toast.addEventListener("click", dismiss);

    activeToasts[text] = { dismiss: dismiss, bump: bump };
    if (ms > 0) { timer = window.setTimeout(dismiss, ms); }
    return dismiss;
  }

  // Public helper + drop-in, non-blocking replacement for alert().
  window.riseloopToast = showToast;
  var nativeAlert = window.alert;
  window.alert = function (message) {
    try { showToast(message); }
    catch (e) { try { nativeAlert.call(window, message); } catch (e2) {} }
  };
})(window);
