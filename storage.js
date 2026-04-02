const KEYS = Object.freeze({
  TRIPS: 'speedometer_trips_v2',
  ACTIVE_SNAPSHOT: 'speedometer_active_trip_v2',
  LEARNING: 'speedometer_learning_profile_v2',
  BEST_TIMES: 'speedometer_best_times_v2',
  LAST_ELEVATION: 'speedometer_last_elevation_v2'
});

function safeReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeWriteJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed writing localStorage key ${key}:`, error);
  }
}

export function loadTrips() {
  const trips = safeReadJson(KEYS.TRIPS, []);
  return Array.isArray(trips) ? trips : [];
}

export function saveTrips(trips) {
  const normalized = Array.isArray(trips) ? trips.slice(0, 500) : [];
  safeWriteJson(KEYS.TRIPS, normalized);
}

export function loadActiveSnapshot() {
  return safeReadJson(KEYS.ACTIVE_SNAPSHOT, null);
}

export function saveActiveSnapshot(snapshot) {
  safeWriteJson(KEYS.ACTIVE_SNAPSHOT, snapshot);
}

export function clearActiveSnapshot() {
  try {
    localStorage.removeItem(KEYS.ACTIVE_SNAPSHOT);
  } catch (error) {
    console.error('Failed to clear active snapshot:', error);
  }
}

export function loadLearningProfile() {
  return safeReadJson(KEYS.LEARNING, null);
}

export function saveLearningProfile(profile) {
  safeWriteJson(KEYS.LEARNING, profile);
}

export function loadBestTimes() {
  const raw = safeReadJson(KEYS.BEST_TIMES, {
    zeroTo100: null,
    fiftyTo120: null,
    quarterMile: null
  });
  return {
    zeroTo100: raw.zeroTo100 ?? null,
    fiftyTo120: raw.fiftyTo120 ?? null,
    quarterMile: raw.quarterMile ?? null
  };
}

export function saveBestTimes(bestTimes) {
  safeWriteJson(KEYS.BEST_TIMES, {
    zeroTo100: bestTimes.zeroTo100 ?? null,
    fiftyTo120: bestTimes.fiftyTo120 ?? null,
    quarterMile: bestTimes.quarterMile ?? null
  });
}

export function clearBestTimes() {
  safeWriteJson(KEYS.BEST_TIMES, {
    zeroTo100: null,
    fiftyTo120: null,
    quarterMile: null
  });
}

export function loadLastElevation() {
  const value = safeReadJson(KEYS.LAST_ELEVATION, 0);
  return Number.isFinite(value) ? value : 0;
}

export function saveLastElevation(elevationM) {
  if (!Number.isFinite(elevationM)) return;
  safeWriteJson(KEYS.LAST_ELEVATION, elevationM);
}

export function clearAllStoredData() {
  Object.values(KEYS).forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to clear ${key}:`, error);
    }
  });
}
