/* ================================================================
 * Riseloop · Time Value
 * A daily time tracker. Treats each day as 1,440 minutes and groups it by
 * the same habit categories the board and reports use, plus a Drain bucket
 * for ad-hoc time that belongs to no habit category. Pulls habit time from
 * the existing backend and shows an end-of-day 24-hour verdict.
 * Self-contained: its own data lives in localStorage; it reuses the
 * habit backend read-only. No changes to the board or app.js.
 * ================================================================ */
(function (window) {
  "use strict";
  var doc = window.document;

  var googleBackend = window.SystemHabitsBackend || null;
  var localBackend = window.SystemHabitsBackendLocal || null;

  // Time is grouped by the habit categories the system already uses, so the
  // day reads in the same language as the board and the reports. DRAIN is the
  // one bucket that isn't a habit category: ad-hoc time that belongs to none.
  var DRAIN = "Drain";
  var UNASSIGNED = "Other";
  var DAY_ABBR = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  // Stable colour per category, picked by name so it doesn't shuffle when
  // categories come and go. Drain is always the warning colour.
  var CAT_PALETTE = [
    { base: "#6fa844", strong: "#4c8438" },
    { base: "#4a90d2", strong: "#2f72bb" },
    { base: "#6366c9", strong: "#474bad" },
    { base: "#f4b330", strong: "#955a05" },
    { base: "#3aa79a", strong: "#2b7f75" },
    { base: "#a266c9", strong: "#7d46a3" },
    { base: "#e2749a", strong: "#bf4f78" },
    { base: "#f5991f", strong: "#b45309" }
  ];
  var DRAIN_COLOR = { base: "#ef6b53", strong: "#d24d37" };
  var UNACCOUNTED_COLOR = { base: "#c9b7a6", strong: "#8a7663" };

  // Colours are handed out in category order rather than hashed, so two
  // categories can never land on the same swatch while there are colours left.
  var catColors = {};

  function refreshCategoryColors() {
    var next = {};
    allCategories().forEach(function (name) {
      if (name === DRAIN) { return; }
      next[name] = CAT_PALETTE[Object.keys(next).length % CAT_PALETTE.length];
    });
    catColors = next;
  }

  function categoryColor(name) {
    if (name === DRAIN) { return DRAIN_COLOR; }
    if (name === "__unaccounted") { return UNACCOUNTED_COLOR; }
    if (!catColors[name]) {
      catColors[name] = CAT_PALETTE[Object.keys(catColors).length % CAT_PALETTE.length];
    }
    return catColors[name];
  }

  var DEFAULT_ACTIVITIES = [
    { name: "Pharmacy run", category: DRAIN },
    { name: "Unplanned errand", category: DRAIN },
    { name: "TV / entertainment", category: DRAIN },
    { name: "Doomscrolling / idle", category: DRAIN }
  ];

  var LS = {
    settings: "riseloop_tv_settings",
    activities: "riseloop_tv_activities",
    logPrefix: "riseloop_tv_log:"
  };

  var state = {
    dateKey: todayKey(),
    activities: loadActivities(),
    entries: [],
    mode: "duration"
  };

  /* ---------- storage ---------- */
  function readJSON(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  // Currency/hourly-value settings were removed — drop the now-unused key so
  // stale data doesn't linger. Day logs and the activity library are untouched.
  function dropLegacySettings() { try { localStorage.removeItem(LS.settings); } catch (e) {} }

  function loadActivities() {
    var stored = readJSON(LS.activities, null);
    if (!stored || !stored.length) {
      var seeded = DEFAULT_ACTIVITIES.map(function (x, i) {
        return { id: "a" + i, name: x.name, category: x.category };
      });
      writeJSON(LS.activities, seeded);
      return seeded;
    }
    // Carry the old value-tier library over: what used to drain is ad-hoc
    // time, everything else waits to be filed under a real habit category.
    var changed = false;
    var list = stored.map(function (a) {
      if (a && a.category) { return a; }
      changed = true;
      return { id: a.id, name: a.name, category: a.tier === "drains" ? DRAIN : UNASSIGNED };
    });
    if (changed) { writeJSON(LS.activities, list); }
    return list;
  }

  // Habit categories in use, with Drain always offered last.
  function allCategories() {
    var set = {};
    var snap = getSnapshot();
    if (snap && snap.habits) {
      snap.habits.forEach(function (h) {
        if (h.enabled === false) { return; }
        set[habitCategory(h)] = true;
      });
    }
    // Keep anything already in use so nothing silently loses its bucket.
    state.activities.forEach(function (a) { if (a.category) { set[a.category] = true; } });
    state.entries.forEach(function (e) { if (e.category) { set[e.category] = true; } });
    delete set[DRAIN];
    var list = Object.keys(set).sort();
    list.push(DRAIN);
    return list;
  }
  function saveActivities() { writeJSON(LS.activities, state.activities); }

  function logKey(dateKey) { return LS.logPrefix + dateKey; }
  function loadEntries(dateKey) { return readJSON(logKey(dateKey), []) || []; }
  function saveEntries() { writeJSON(logKey(state.dateKey), state.entries); }

  /* ---------- dates ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function keyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayKey() { return keyOf(new Date()); }
  function keyToDate(k) { var p = String(k).split("-"); return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)); }
  function shiftKey(k, delta) { var d = keyToDate(k); d.setDate(d.getDate() + delta); return keyOf(d); }
  function weekdayAbbr(k) { return DAY_ABBR[keyToDate(k).getDay()]; }
  function weekdayLetter(k) { return "SMTWTFS"[keyToDate(k).getDay()]; }

  function genId() { return "e-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7); }

  /* ---------- format ---------- */
  function fmtHM(mins) {
    mins = Math.round(mins);
    var h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) { return h + "h " + m + "m"; }
    if (h) { return h + "h"; }
    return m + "m";
  }

  function parseTimeToMinutes(t) {
    t = String(t || "").trim();
    var ampm = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(t);
    if (ampm) {
      var h = parseInt(ampm[1], 10), mi = parseInt(ampm[2], 10), ap = ampm[3].toUpperCase();
      if (ap === "PM" && h !== 12) { h += 12; }
      if (ap === "AM" && h === 12) { h = 0; }
      return h * 60 + mi;
    }
    var hm = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (hm) { return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10); }
    return null;
  }

  /* ---------- compute ---------- */
  function computeDay(entries) {
    var by = { invests: 0, recharges: 0, maintains: 0, drains: 0 };
    entries.forEach(function (e) {
      var cat = (e.category && String(e.category)) || UNASSIGNED;
      by[cat] = (by[cat] || 0) + Math.max(0, e.minutes || 0);
    });

    var accounted = 0;
    Object.keys(by).forEach(function (k) { accounted += by[k]; });
    var drain = by[DRAIN] || 0;
    var onCategories = accounted - drain;
    var unaccounted = Math.max(0, 1440 - accounted);
    // How much of the time you accounted for went to a real habit category.
    var score = accounted > 0 ? Math.round((100 * onCategories) / accounted) : 0;

    return {
      by: by, accounted: accounted, drain: drain,
      onCategories: onCategories, unaccounted: unaccounted, score: score
    };
  }

  /* ---------- render ---------- */
  function renderAll() {
    refreshCategoryColors();
    renderDashboard();
    renderEntries();
    renderTrend();
  }

  function renderDashboard() {
    var c = computeDay(state.entries);

    var scoreEl = doc.getElementById("tvScore");
    if (scoreEl) { scoreEl.textContent = c.score; }
    var ring = doc.getElementById("tvScoreRing");
    if (ring) { ring.style.setProperty("--p", c.score + "%"); }

    // 24h bar
    var bar = doc.getElementById("tv24hBar");
    var legend = doc.getElementById("tv24hLegend");
    if (bar) { bar.innerHTML = ""; }
    if (legend) { legend.innerHTML = ""; }

    // Biggest category first, with ad-hoc Drain kept at the end.
    var names = Object.keys(c.by).filter(function (k) { return c.by[k] > 0; });
    names.sort(function (a, b) {
      if (a === DRAIN) { return 1; }
      if (b === DRAIN) { return -1; }
      return c.by[b] - c.by[a];
    });

    names.forEach(function (n) { addSeg(bar, legend, n, n, c.by[n]); });
    addSeg(bar, legend, "__unaccounted", "Unaccounted", c.unaccounted);

    // One card per category actually used today.
    var grid = doc.getElementById("tvCategoryGrid");
    if (grid) {
      grid.innerHTML = names.map(function (n) {
        var col = categoryColor(n);
        var mins = c.by[n];
        return '<div class="tier-card" style="--cat:' + col.base + '">' +
          '<div class="tier-head"><span class="tier-dot" style="background:' + col.base + '"></span>' +
          escapeHtml(n) + '</div>' +
          '<div class="tier-hours">' + escapeHtml(fmtHM(mins)) + '</div>' +
          '<div class="tier-sub">' + Math.round((mins / 1440) * 100) + '% of day</div>' +
          '</div>';
      }).join("");
    }
    var emptyNote = doc.getElementById("tvCategoryEmpty");
    if (emptyNote) { emptyNote.hidden = names.length > 0; }

    // time summary
    setText(doc.getElementById("tvValueAdding"), fmtHM(c.onCategories));
    setText(doc.getElementById("tvTimeDrained"), fmtHM(c.drain));
    setText(doc.getElementById("tvUnaccounted"), fmtHM(c.unaccounted));
  }

  function addSeg(bar, legend, key, label, mins) {
    if (mins <= 0) { return; }
    var pct = (mins / 1440) * 100;
    var color = categoryColor(key).base;
    if (bar) {
      var s = doc.createElement("span");
      s.style.width = pct + "%";
      s.style.background = color;
      s.title = label + " · " + fmtHM(mins);
      bar.appendChild(s);
    }
    if (legend) {
      var lg = doc.createElement("span");
      lg.className = "lg";
      lg.innerHTML = '<span class="dot" style="background:' + color + '"></span>' +
        label + " " + fmtHM(mins);
      legend.appendChild(lg);
    }
  }

  function renderEntries() {
    var list = doc.getElementById("tvEntryList");
    var empty = doc.getElementById("tvEntryEmpty");
    if (!list) { return; }
    list.innerHTML = "";
    if (!state.entries.length) {
      if (empty) { empty.hidden = false; }
    } else if (empty) {
      empty.hidden = true;
    }

    state.entries.forEach(function (e) {
      var row = doc.createElement("div");
      row.className = "entry";
      var cat = e.category || UNASSIGNED;
      var color = categoryColor(cat).base;
      var src = e.source === "habit" ? '<span class="src">from habit</span>' : "";
      row.innerHTML =
        '<span class="e-dot" style="background:' + color + '"></span>' +
        '<span class="e-name">' + escapeHtml(e.name) + src + '</span>' +
        '<span class="e-time">' + fmtHM(e.minutes) + '</span>' +
        '<span class="e-pct">' + escapeHtml(cat) + '</span>' +
        '<button class="e-del" type="button" title="Remove" data-del="' + e.id + '">×</button>';
      list.appendChild(row);
    });

    var c = computeDay(state.entries);
    setText(doc.getElementById("tvAccountedLabel"), fmtHM(c.accounted) + " of 24h accounted");
    setText(doc.getElementById("tvUnaccLabel"),
      c.unaccounted > 0 ? (fmtHM(c.unaccounted) + " unaccounted") : "Full day accounted ✓");
  }

  function renderTrend() {
    var el = doc.getElementById("tvTrend");
    if (!el) { return; }
    el.innerHTML = "";
    var days = [];
    for (var i = 6; i >= 0; i--) { days.push(shiftKey(state.dateKey, -i)); }
    days.forEach(function (k) {
      var entries = (k === state.dateKey) ? state.entries : loadEntries(k);
      var c = computeDay(entries);
      var bar = doc.createElement("div");
      bar.className = "bar";
      var h = Math.max(3, Math.round((c.score / 100) * 80));
      var isSel = k === state.dateKey;
      bar.innerHTML =
        '<div class="fill" style="height:' + h + 'px;' +
        (isSel ? "" : "opacity:.55;") + '" title="' + k + " · " + c.score + '/100"></div>' +
        '<div class="day">' + weekdayLetter(k) + '</div>';
      el.appendChild(bar);
    });
  }

  function renderActivitySelect() {
    var sel = doc.getElementById("tvActivitySelect");
    if (!sel) { return; }
    sel.innerHTML = "";
    state.activities.forEach(function (a) {
      var o = doc.createElement("option");
      o.value = a.id;
      o.textContent = a.name + "  ·  " + (a.category || UNASSIGNED);
      sel.appendChild(o);
    });
  }

  function renderCategoryOptions(sel, selected) {
    if (!sel) { return; }
    var options = allCategories();
    if (selected && options.indexOf(selected) === -1) { options.unshift(selected); }
    sel.innerHTML = "";
    options.forEach(function (name) {
      var o = doc.createElement("option");
      o.value = name;
      o.textContent = name;
      if (name === selected) { o.selected = true; }
      sel.appendChild(o);
    });
  }

  function renderLibrary() {
    var list = doc.getElementById("tvLibList");
    if (list) {
      list.innerHTML = "";
      state.activities.forEach(function (a) {
        var row = doc.createElement("div");
        row.className = "lib-item";
        var color = categoryColor(a.category || UNASSIGNED).base;
        row.innerHTML =
          '<span class="l-name"><span class="tier-pill"><span class="tier-dot" style="background:' + color + '"></span>' +
          escapeHtml(a.name) + '</span></span>' +
          '<select data-cat-for="' + a.id + '"></select>' +
          '<button class="btn sm" type="button" data-del-act="' + a.id + '">Delete</button>';
        list.appendChild(row);
        renderCategoryOptions(row.querySelector("[data-cat-for]"), a.category || UNASSIGNED);
      });
    }
    setText(doc.getElementById("tvLibCount"), state.activities.length + " activities");
    renderCategoryOptions(doc.getElementById("tvNewCategory"), allCategories()[0]);
    renderActivitySelect();
  }

  /* ---------- actions ---------- */
  function setMode(mode) {
    state.mode = mode === "range" ? "range" : "duration";
    var range = state.mode === "range";
    var minsEl = doc.getElementById("tvMinutes");
    var rangeEl = doc.getElementById("tvRangeInputs");
    if (minsEl) { minsEl.hidden = range; }
    if (rangeEl) { rangeEl.hidden = !range; }
    [].forEach.call(doc.querySelectorAll(".mode-btn"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-mode") === state.mode);
    });
    var focusEl = doc.getElementById(range ? "tvStart" : "tvMinutes");
    if (focusEl && focusEl.focus) { try { focusEl.focus(); } catch (e) {} }
  }

  // Returns { minutes } or { error, focus } — never throws.
  function readDurationInput() {
    if (state.mode === "range") {
      var s = doc.getElementById("tvStart"), e = doc.getElementById("tvEnd");
      var sm = s && s.value ? parseTimeToMinutes(s.value) : null;
      var em = e && e.value ? parseTimeToMinutes(e.value) : null;
      if (sm == null) { return { error: "times", focus: s }; }
      if (em == null) { return { error: "times", focus: e }; }
      // Handle overnight spans (e.g. sleep 23:00 → 06:30).
      var dur = em > sm ? (em - sm) : (em + 1440 - sm);
      if (dur <= 0) { return { error: "zero", focus: e }; }
      return { minutes: dur };
    }
    var minsEl = doc.getElementById("tvMinutes");
    var mins = parseInt(minsEl && minsEl.value, 10);
    if (!mins || mins <= 0) { return { error: "mins", focus: minsEl }; }
    return { minutes: mins };
  }

  function clearAddInputs() {
    ["tvMinutes", "tvStart", "tvEnd"].forEach(function (id) {
      var el = doc.getElementById(id); if (el) { el.value = ""; }
    });
  }

  function addEntry() {
    var sel = doc.getElementById("tvActivitySelect");
    var act = state.activities.filter(function (a) { return a.id === (sel && sel.value); })[0];
    if (!act) { alert("Pick an activity first."); if (sel) { try { sel.focus(); } catch (e) {} } return; }
    var r = readDurationInput();
    if (r.error) {
      if (r.focus && r.focus.focus) { try { r.focus.focus(); } catch (e) {} }
      if (r.error === "mins") { alert("Enter minutes, or switch to Start–End."); }
      else if (r.error === "times") { alert("Enter a start and an end time."); }
      else { alert("End time must be after the start."); }
      return;
    }
    state.entries.push({
      id: genId(), name: act.name, category: act.category || UNASSIGNED,
      minutes: r.minutes, source: "manual"
    });
    saveEntries();
    clearAddInputs();
    renderAll();
  }

  function removeEntry(id) {
    state.entries = state.entries.filter(function (e) { return e.id !== id; });
    saveEntries();
    renderAll();
  }

  function addActivity() {
    var nameEl = doc.getElementById("tvNewName");
    var catEl = doc.getElementById("tvNewCategory");
    if (!nameEl) { return; }
    var name = (nameEl.value || "").trim();
    if (!name) { alert("Enter an activity name."); return; }
    var category = (catEl && catEl.value) || allCategories()[0] || DRAIN;
    state.activities.push({ id: "a" + Date.now(), name: name, category: category });
    saveActivities();
    nameEl.value = "";
    renderLibrary();
  }

  function setActivityCategory(id, category) {
    if (!category) { return; }
    state.activities.forEach(function (a) { if (a.id === id) { a.category = category; } });
    saveActivities();
    renderLibrary();
  }

  function deleteActivity(id) {
    state.activities = state.activities.filter(function (a) { return a.id !== id; });
    saveActivities();
    renderLibrary();
  }

  // Silent one-time cleanup: on the first load after this update, erase every
  // Time Value day-log except today, then set a flag so it never runs again.
  // Touches ONLY "riseloop_tv_log:*" keys — nothing else in the app.
  function purgeOncePastDays() {
    var FLAG = "riseloop_tv_purged_v1";
    try {
      if (localStorage.getItem(FLAG) === "1") { return; }
      var keepKey = logKey(todayKey());
      var toRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(LS.logPrefix) === 0 && k !== keepKey) { toRemove.push(k); }
      }
      toRemove.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      localStorage.setItem(FLAG, "1");
    } catch (e) {}
  }

  /* ---------- habit import ---------- */
  function getSnapshot() {
    try {
      if (googleBackend && googleBackend.getMeta && googleBackend.getMeta().signedIn &&
          googleBackend.getStateSnapshot) {
        var g = googleBackend.getStateSnapshot();
        if (g && g.habits && g.habits.length) { return g; }
      }
    } catch (e) {}
    try {
      if (localBackend && localBackend.getStateSnapshot) {
        var l = localBackend.getStateSnapshot();
        if (l && l.habits && l.habits.length) { return l; }
      }
    } catch (e) {}
    return null;
  }

  function isActiveOn(habit, wd) {
    var d = habit.activeDays;
    if (!d) { return true; }
    if (Array.isArray(d)) {
      if (!d.length) { return true; }
      return d.some(function (x) { return String(x).toLowerCase().slice(0, 3) === wd; });
    }
    var s = String(d).toLowerCase();
    if (!s.trim()) { return true; }
    return s.indexOf(wd) > -1;
  }

  function windowKeysOf(habit) {
    var keys = [];
    if (habit.windowStart && habit.windowEnd) { keys.push(habit.windowStart + "-" + habit.windowEnd); }
    if (Array.isArray(habit.repeatWindows)) {
      habit.repeatWindows.forEach(function (w) { if (w) { keys.push(String(w)); } });
    }
    return keys;
  }

  function habitCategory(h) { return (String(h.category || "General").trim()) || "General"; }

  // Populate the import dropdown with ONLY categories that have non-zero logged
  // time for the currently-viewed date. A category with nothing logged that day
  // (e.g. Profession = 0 today) is not offered at all.
  function refreshImportCategories() {
    var sel = doc.getElementById("tvImportCategory");
    if (!sel) { return; }
    var snap = getSnapshot();
    var hasData = !!(snap && snap.habits && snap.habits.length);
    var catSet = {};
    if (hasData) {
      var valueMap = buildEntryValueMap(snap);
      var wd = weekdayAbbr(state.dateKey);
      snap.habits.forEach(function (h) {
        if (h.enabled === false) { return; }
        if (!isActiveOn(h, wd)) { return; }
        var mult = unitToMinutesMult(h.unit);
        if (!mult) { return; }
        var val = valueMap[String(h.id) + "|" + state.dateKey] || 0;
        if (Math.round(val * mult) <= 0) { return; }
        catSet[habitCategory(h)] = true;
      });
    }
    var cats = Object.keys(catSet).sort();
    var current = sel.value;
    sel.innerHTML = "";
    var all = doc.createElement("option");
    all.value = "";
    all.textContent = cats.length ? "All categories"
      : (hasData ? "No logged time this day" : "All (connect to load)");
    sel.appendChild(all);
    cats.forEach(function (c) {
      var o = doc.createElement("option");
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
    if (current && catSet[current]) { sel.value = current; }
  }

  // Time units → minutes multiplier (mirrors the app's timer unit handling).
  var TIME_UNITS = [
    { re: /\b(sec|secs|second|seconds)\b/i, mult: 1 / 60 },
    { re: /\b(m|min|mins|minute|minutes)\b/i, mult: 1 },
    { re: /\b(h|hr|hrs|hour|hours)\b/i, mult: 60 }
  ];
  function unitToMinutesMult(unit) {
    var u = String(unit || "");
    for (var i = 0; i < TIME_UNITS.length; i++) { if (TIME_UNITS[i].re.test(u)) { return TIME_UNITS[i].mult; } }
    return 0; // not a time unit → no logged duration to import
  }

  // Map of habitId|dateKey → logged value, from the backend snapshot's entries.
  function buildEntryValueMap(snapshot) {
    var map = {};
    (snapshot.entries || []).forEach(function (e) {
      if (!e || e.habitId == null || e.dateKey == null) { return; }
      map[String(e.habitId) + "|" + String(e.dateKey)] = Number(e.value) || 0;
    });
    return map;
  }

  // Import the ACTUAL logged time (not the scheduled window length) for one
  // category on one date. Only time-tracked habits that actually logged minutes
  // that day are counted. Replaces just this category's previous import; keeps
  // manual entries and other categories untouched.
  function importCategoryForDate(dateKey, snapshot, category, valueMap) {
    var wd = weekdayAbbr(dateKey);
    var fresh = [];
    snapshot.habits.forEach(function (h) {
      if (h.enabled === false) { return; }
      if (habitCategory(h) !== category) { return; }
      if (!isActiveOn(h, wd)) { return; }
      var mult = unitToMinutesMult(h.unit);
      if (!mult) { return; } // checkbox / non-time habit → no duration to import
      var val = valueMap[String(h.id) + "|" + dateKey] || 0;
      var mins = Math.round(val * mult);
      if (mins <= 0) { return; } // nothing logged for this habit that day
      fresh.push({
        id: genId(), name: (h.name || category),
        minutes: mins, source: "habit", category: category
      });
    });

    var entries = loadEntries(dateKey).filter(function (e) {
      return !(e.source === "habit" && e.category === category);
    }).concat(fresh);

    writeJSON(logKey(dateKey), entries);
    if (dateKey === state.dateKey) { state.entries = entries; }
    return { added: fresh.length, total: fresh.reduce(function (s, e) { return s + e.minutes; }, 0) };
  }

  // Import for the currently-viewed date only. To do a past day, use ‹ Prev /
  // Next › to move there first, then Import.
  function importHabits() {
    var snap = getSnapshot();
    if (!snap || !snap.habits || !snap.habits.length) {
      alert("No habit data available yet. Click “Connect Google Sheets” above so your habits can be imported.");
      return;
    }
    refreshImportCategories();

    var catSel = doc.getElementById("tvImportCategory");
    var chosen = catSel ? catSel.value : "";
    var categories;
    if (chosen) {
      categories = [chosen];
    } else {
      var set = {};
      snap.habits.forEach(function (h) { if (h.enabled !== false) { set[habitCategory(h)] = true; } });
      categories = Object.keys(set);
    }

    var valueMap = buildEntryValueMap(snap);
    var dateKey = state.dateKey;
    var items = 0, totalMin = 0;
    categories.forEach(function (c) {
      var r = importCategoryForDate(dateKey, snap, c, valueMap);
      items += r.added; totalMin += r.total;
    });

    renderAll();
    var catLabel = chosen ? ("“" + chosen + "”") : "all categories";
    if (items > 0) {
      alert("Imported " + fmtHM(totalMin) + " of logged time for " + catLabel + " on " + dateKey + ".");
    } else {
      alert("No logged time found for " + catLabel + " on " + dateKey + ". Only time-tracked habits with minutes logged that day are imported.");
    }
  }

  /* ---------- backend connect ---------- */
  function updateBackendStatus() {
    var el = doc.getElementById("tvBackendStatus");
    if (!el) { return; }
    var signed = false;
    try { signed = !!(googleBackend && googleBackend.getMeta && googleBackend.getMeta().signedIn); } catch (e) {}
    el.textContent = signed ? "Google Sheets connected" : "Local mode";
    var btn = doc.getElementById("tvConnectBtn");
    if (btn) { btn.hidden = signed; }
    refreshImportCategories();
  }

  function connectGoogle() {
    if (!googleBackend || !googleBackend.signIn) { alert("Google backend is unavailable on this page."); return; }
    Promise.resolve()
      .then(function () { return googleBackend.signIn(); })
      .then(function () { return googleBackend.sync ? googleBackend.sync() : null; })
      .then(function () {
        updateBackendStatus();
        refreshImportCategories();
        alert("Connected. Pick a category and click Import.");
      })
      .catch(function (err) { alert((err && err.message) || "Could not connect to Google Sheets."); });
  }

  function initBackend() {
    if (googleBackend && googleBackend.initialize) {
      if (googleBackend.subscribe) { googleBackend.subscribe(updateBackendStatus); }
      googleBackend.initialize().then(updateBackendStatus).catch(function () {});
    }
    updateBackendStatus();
  }

  /* ---------- day switching ---------- */
  function setDate(key) {
    state.dateKey = key;
    state.entries = loadEntries(key);
    var input = doc.getElementById("tvDate");
    if (input) { input.value = key; }
    setImportDefaults();
    refreshImportCategories();
    renderAll();
  }

  function setImportDefaults() {
    var f = doc.getElementById("tvImportFrom"), t = doc.getElementById("tvImportTo");
    if (f) { f.value = state.dateKey; }
    if (t) { t.value = state.dateKey; }
  }

  /* ---------- helpers ---------- */
  function setText(el, txt) { if (el) { el.textContent = txt; } }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- wire up ---------- */
  function bind() {
    on("tvAddBtn", "click", addEntry);
    on("tvImportHabits", "click", importHabits);
    on("tvConnectBtn", "click", connectGoogle);
    on("tvAddActivity", "click", addActivity);
    on("tvPrevDay", "click", function () { setDate(shiftKey(state.dateKey, -1)); });
    on("tvNextDay", "click", function () { setDate(shiftKey(state.dateKey, 1)); });
    on("tvTodayBtn", "click", function () { setDate(todayKey()); });

    var dateInput = doc.getElementById("tvDate");
    if (dateInput) { dateInput.addEventListener("change", function () { if (dateInput.value) { setDate(dateInput.value); } }); }

    ["tvMinutes", "tvStart", "tvEnd"].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el) { el.addEventListener("keydown", function (e) { if (e.key === "Enter") { addEntry(); } }); }
    });
    [].forEach.call(doc.querySelectorAll(".mode-btn"), function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-mode")); });
    });

    // event delegation for dynamic controls
    doc.addEventListener("click", function (e) {
      var del = e.target.closest && e.target.closest("[data-del]");
      if (del) { removeEntry(del.getAttribute("data-del")); return; }
      var delAct = e.target.closest && e.target.closest("[data-del-act]");
      if (delAct) { deleteActivity(delAct.getAttribute("data-del-act")); return; }
    });
    doc.addEventListener("change", function (e) {
      var tsel = e.target.closest && e.target.closest("[data-cat-for]");
      if (tsel) { setActivityCategory(tsel.getAttribute("data-cat-for"), tsel.value); }
    });
  }

  function on(id, ev, fn) { var el = doc.getElementById(id); if (el) { el.addEventListener(ev, fn); } }

  function start() {
    purgeOncePastDays();
    dropLegacySettings();
    state.entries = loadEntries(state.dateKey);
    var input = doc.getElementById("tvDate");
    if (input) { input.value = state.dateKey; }
    setImportDefaults();
    renderLibrary();
    bind();
    setMode("duration");
    refreshImportCategories();
    renderAll();
    initBackend();
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  // expose a little for debugging/testing
  window.RiseloopTimeValue = {
    state: state, computeDay: computeDay, importHabits: importHabits,
    setDate: setDate, refreshImportCategories: refreshImportCategories
  };
})(window);
