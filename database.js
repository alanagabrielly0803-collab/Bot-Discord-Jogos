const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const DEFAULT_STATE = {
  version: 1,
  lastRun: null,
  lastSuccessfulRun: null,
  lastError: null,
  totalRuns: 0,
  announced: {},
  recent: []
};

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8');
  }
}

function readState() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STATE,
      ...parsed,
      announced: parsed.announced || {},
      recent: Array.isArray(parsed.recent) ? parsed.recent : []
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(state) {
  ensureStorage();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase();
}

function hasAnnounced(key) {
  const state = readState();
  return Boolean(state.announced[normalizeKey(key)]);
}

function addRecentGames(games) {
  const state = readState();
  const recent = Array.isArray(games) ? games : [games];
  const timestamp = new Date().toISOString();
  const keysToReplace = new Set(recent.map((game) => normalizeKey(game.dedupeKey)));

  state.recent = state.recent.filter((entry) => !keysToReplace.has(normalizeKey(entry.dedupeKey)));

  for (const game of recent) {
    const entry = {
      ...game,
      savedAt: timestamp
    };
    state.recent.unshift(entry);
  }

  state.recent = state.recent.slice(0, 100);
  writeState(state);
}

function markAnnounced(game) {
  const state = readState();
  const key = normalizeKey(game.dedupeKey);
  state.announced[key] = {
    title: game.title,
    platform: game.platform,
    announcedAt: new Date().toISOString(),
    claimUrl: game.claimUrl || null,
    endDate: game.endDate || null
  };
  state.totalRuns = Number(state.totalRuns || 0);
  writeState(state);
}

function recordRun({ startedAt, finishedAt, error, foundCount, newCount }) {
  const state = readState();
  state.lastRun = {
    startedAt,
    finishedAt,
    foundCount: foundCount || 0,
    newCount: newCount || 0,
    ok: !error,
    error: error ? String(error) : null
  };
  state.totalRuns = Number(state.totalRuns || 0) + 1;
  if (!error) {
    state.lastSuccessfulRun = finishedAt;
    state.lastError = null;
  } else {
    state.lastError = String(error);
  }
  writeState(state);
}

function getRecentGames(limit = 10) {
  const state = readState();
  return state.recent.slice(0, limit);
}

function getStatus() {
  const state = readState();
  return {
    lastRun: state.lastRun,
    lastSuccessfulRun: state.lastSuccessfulRun,
    lastError: state.lastError,
    totalRuns: state.totalRuns || 0,
    announcedCount: Object.keys(state.announced || {}).length,
    recentCount: state.recent.length
  };
}

module.exports = {
  addRecentGames,
  getRecentGames,
  getStatus,
  hasAnnounced,
  markAnnounced,
  recordRun
};
