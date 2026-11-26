// Versioned, validated local records and settings. Storage failure never prevents play:
// records are kept in memory when localStorage is unavailable, full or corrupt.

export const RECORDS_KEY = 'deepwake.records.v1';
export const SETTINGS_KEY = 'deepwake.settings.v1';
export const RECORDS_VERSION = 1;
export const ARCHIVE_COUNT = 3;

const MAX_TIME = 24 * 3600; // a single expedition can never take a day
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function emptyRecords() {
  return {
    version: RECORDS_VERSION,
    expeditions: 0,
    bestTime: null,
    bestFullArchiveTime: null,
    fewestRecoveries: null,
    fewestRecoveriesTime: null,
  };
}

/** Returns a sanitized records object, or null when the data is corrupt or incompatible. */
export function validateRecords(data) {
  if (!data || typeof data !== 'object' || data.version !== RECORDS_VERSION) return null;
  const out = emptyRecords();
  if (isNum(data.expeditions) && data.expeditions >= 0 && data.expeditions < 1e9) out.expeditions = Math.floor(data.expeditions);
  const time = (v) => (isNum(v) && v >= 0 && v <= MAX_TIME ? v : null);
  out.bestTime = time(data.bestTime);
  out.bestFullArchiveTime = time(data.bestFullArchiveTime);
  if (isNum(data.fewestRecoveries) && data.fewestRecoveries >= 0 && data.fewestRecoveries < 1e6 && Number.isInteger(data.fewestRecoveries)) {
    const t = time(data.fewestRecoveriesTime);
    if (t !== null) {
      out.fewestRecoveries = data.fewestRecoveries;
      out.fewestRecoveriesTime = t;
    }
  }
  return out;
}

/** True when a run result qualifies as a completed expedition. */
export function qualifies(result) {
  return !!result && isNum(result.time) && result.time >= 0 && !!result.relays && result.relays.A === true && result.relays.B === true && result.relays.C === true;
}

/**
 * Merge a completed expedition into the records. Returns { records, newBests } without mutating the input.
 * Only completed expeditions qualify. The full-archive time requires all three archives.
 * Fewer recoveries wins that record; completion time is only its tie-breaker.
 */
export function applyResult(records, result) {
  const base = validateRecords(records) || emptyRecords();
  const next = { ...base, expeditions: base.expeditions + 1 };
  const newBests = [];
  if (!qualifies(result)) return { records: next, newBests };
  const fullArchive = Array.isArray(result.archives) && result.archives.length >= ARCHIVE_COUNT;
  if (next.bestTime === null || result.time < next.bestTime) {
    next.bestTime = result.time;
    newBests.push('bestTime');
  }
  if (fullArchive && (next.bestFullArchiveTime === null || result.time < next.bestFullArchiveTime)) {
    next.bestFullArchiveTime = result.time;
    newBests.push('bestFullArchiveTime');
  }
  const rec = isNum(result.recoveries) && result.recoveries >= 0 ? Math.floor(result.recoveries) : null;
  if (rec !== null) {
    if (next.fewestRecoveries === null || rec < next.fewestRecoveries || (rec === next.fewestRecoveries && result.time < next.fewestRecoveriesTime)) {
      next.fewestRecoveries = rec;
      next.fewestRecoveriesTime = result.time;
      newBests.push('fewestRecoveries');
    }
  }
  return { records: next, newBests };
}

export function formatTime(seconds) {
  if (!isNum(seconds)) return '--:--';
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Safe storage probe: returns a storage object or null. */
function safeStorage(storage) {
  if (storage) return storage;
  try {
    const s = globalThis.localStorage;
    const probe = '__deepwake_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export class RecordStore {
  constructor(storage) {
    this.storage = safeStorage(storage);
    this.records = emptyRecords();
    this.available = false;
    this.load();
  }

  load() {
    this.records = emptyRecords();
    this.available = false;
    if (!this.storage) return this.records;
    let raw;
    try {
      raw = this.storage.getItem(RECORDS_KEY);
    } catch {
      return this.records; // storage itself is unusable
    }
    this.available = true;
    if (!raw) return this.records;
    try {
      const valid = validateRecords(JSON.parse(raw));
      // Corrupt or incompatible data is ignored without interrupting play.
      if (valid) this.records = valid;
    } catch {
      this.records = emptyRecords();
    }
    return this.records;
  }

  save() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(RECORDS_KEY, JSON.stringify(this.records));
      this.available = true;
      return true;
    } catch {
      this.available = false; // full or blocked: keep in memory
      return false;
    }
  }

  applyResult(result) {
    const { records, newBests } = applyResult(this.records, result);
    this.records = records;
    this.save();
    return newBests;
  }
}

export const DEFAULT_SETTINGS = Object.freeze({ muted: false, reducedMotion: false, touch: 'auto' });

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    muted: data.muted === true,
    reducedMotion: data.reducedMotion === true,
    touch: ['auto', 'on', 'off'].includes(data.touch) ? data.touch : 'auto',
  };
}

export function loadSettings(storage) {
  const s = safeStorage(storage);
  if (!s) return { ...DEFAULT_SETTINGS };
  try {
    return validateSettings(JSON.parse(s.getItem(SETTINGS_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage) {
  const s = safeStorage(storage);
  if (!s) return false;
  try {
    s.setItem(SETTINGS_KEY, JSON.stringify(validateSettings(settings)));
    return true;
  } catch {
    return false;
  }
}
