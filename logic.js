export const APP_STATES = Object.freeze({
  IDLE: 'IDLE',
  TRACKING: 'TRACKING',
  PAUSED_AUTO: 'PAUSED_AUTO',
  PAUSED_MANUAL: 'PAUSED_MANUAL',
  ENDED: 'ENDED'
});

export const TIMING_MODES = Object.freeze({
  ZERO_TO_100: 'zeroTo100',
  FIFTY_TO_120: 'fiftyTo120',
  QUARTER_MILE: 'quarterMile'
});

const KMH_TO_MS = 1000 / 3600;
const QUARTER_MILE_KM = 0.402336;

export function formatDuration(ms) {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
  const r = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dPhi = (lat2 - lat1) * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

export function computeSpeedKmhFromPoints(prev, curr) {
  if (!prev || !curr) return 0;
  const dtMs = curr.timestampMs - prev.timestampMs;
  if (dtMs <= 0) return 0;
  const meters = calculateDistanceMeters(prev.lat, prev.lng, curr.lat, curr.lng);
  return (meters / (dtMs / 1000)) * 3.6;
}

export function computeAccelMps2(prevSpeedKmh, speedKmh, dtMs) {
  if (!Number.isFinite(prevSpeedKmh) || !Number.isFinite(speedKmh) || !Number.isFinite(dtMs) || dtMs <= 0) {
    return 0;
  }
  const dvMs = (speedKmh - prevSpeedKmh) * KMH_TO_MS;
  return dvMs / (dtMs / 1000);
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values) {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - m) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function classifyMotion(sampleWindow) {
  if (!Array.isArray(sampleWindow) || sampleWindow.length < 6) {
    return {
      carLikeScore: 0,
      walkLikeScore: 0,
      isCarLike: false,
      isWalkLike: false,
      speedMean: 0,
      speedStd: 0,
      accelMeanAbs: 0,
      gyroStd: 0
    };
  }

  const speeds = sampleWindow.map((s) => s.speedKmh || 0);
  const accels = sampleWindow.map((s) => Math.abs(s.accelMps2 || 0));
  const gyros = sampleWindow.map((s) => s.gyroMagnitude || 0);
  const speedMean = mean(speeds);
  const speedStd = stdDev(speeds);
  const accelMeanAbs = mean(accels);
  const gyroStd = stdDev(gyros);

  let carLikeScore = 0;
  if (speedMean >= 12) carLikeScore += 0.55;
  if (accelMeanAbs >= 0.6 && accelMeanAbs <= 4.5) carLikeScore += 0.25;
  if (speedStd <= 15) carLikeScore += 0.2;

  let walkLikeScore = 0;
  if (speedMean <= 9) walkLikeScore += 0.35;
  if (gyroStd >= 0.3) walkLikeScore += 0.35;
  if (speedStd >= 2 && speedStd <= 10) walkLikeScore += 0.3;

  return {
    carLikeScore,
    walkLikeScore,
    isCarLike: carLikeScore >= 0.6,
    isWalkLike: walkLikeScore >= 0.6,
    speedMean,
    speedStd,
    accelMeanAbs,
    gyroStd
  };
}

export function shouldAutoPause(context) {
  const {
    stationaryMs,
    speedKmh,
    motionClassification,
    distanceFromPauseAnchorM
  } = context;

  const standingStill = stationaryMs >= 60000 && speedKmh <= 1.2;
  const likelyWalkAway =
    speedKmh <= 9 &&
    motionClassification?.isWalkLike === true &&
    distanceFromPauseAnchorM >= 35;

  return standingStill || likelyWalkAway;
}

export function shouldAutoResume(context) {
  const {
    distanceToAnchorM,
    motionClassification,
    speedKmh,
    pausedAtMs,
    nowMs
  } = context;

  if (!Number.isFinite(distanceToAnchorM) || distanceToAnchorM > 100) return false;
  if (Number.isFinite(pausedAtMs) && Number.isFinite(nowMs) && nowMs - pausedAtMs > 3600000) return false;

  const carLike = motionClassification?.isCarLike === true;
  return carLike && speedKmh >= 6;
}

export function isSnapshotStale(snapshot, nowMs = Date.now()) {
  if (!snapshot?.updatedAtMs) return true;
  return (nowMs - snapshot.updatedAtMs) > 3600000;
}

export function createLearningProfile() {
  return {
    zeroTo100: { mean: 1.3, variance: 0.2, samples: 0 },
    fiftyTo120: { mean: 1.1, variance: 0.15, samples: 0 },
    quarterMile: { mean: 1.25, variance: 0.2, samples: 0 }
  };
}

export function updateLearningProfile(profile, mode, launchAccelMps2) {
  if (!profile[mode] || !Number.isFinite(launchAccelMps2)) return profile;
  const curr = profile[mode];
  const alpha = curr.samples < 8 ? 0.25 : 0.12;
  const nextMean = curr.mean + alpha * (launchAccelMps2 - curr.mean);
  const diff = launchAccelMps2 - nextMean;
  const nextVariance = Math.max(0.02, (1 - alpha) * curr.variance + alpha * (diff * diff));
  return {
    ...profile,
    [mode]: {
      mean: nextMean,
      variance: nextVariance,
      samples: curr.samples + 1
    }
  };
}

export function accelerationThreshold(profile, mode) {
  const entry = profile?.[mode];
  if (!entry) return 1.0;
  const sigma = Math.sqrt(entry.variance);
  return Math.max(0.9, entry.mean - (0.5 * sigma));
}

function defaultTimingState(targetSpeedKmh, targetDistanceKm = null) {
  return {
    phase: 'idle',
    startedAtMs: null,
    startedDistanceKm: null,
    launchAccelMps2: null,
    resultSeconds: null,
    lastDeltaKmh: 0,
    bestSeconds: null,
    targetSpeedKmh,
    targetDistanceKm,
    holdStartMs: null,
    doneTone: null,
    doneAtMs: null,
    recentPeakSpeedKmh: 0
  };
}

export function createTimingState() {
  return {
    [TIMING_MODES.ZERO_TO_100]: defaultTimingState(100),
    [TIMING_MODES.FIFTY_TO_120]: defaultTimingState(120),
    [TIMING_MODES.QUARTER_MILE]: defaultTimingState(999, QUARTER_MILE_KM)
  };
}

function isHeavyAcceleration(sample, threshold) {
  return sample.accelMps2 >= threshold;
}

function shouldAbortTiming(state, sample, nowMs) {
  const droppedHard = state.recentPeakSpeedKmh - sample.speedKmh > 9;
  const plateau = Math.abs(sample.deltaSpeedKmh) < 0.6 && sample.accelMps2 < 0.35;

  if (droppedHard) return true;
  if (!plateau) {
    state.holdStartMs = null;
    return false;
  }
  if (!state.holdStartMs) {
    state.holdStartMs = nowMs;
    return false;
  }
  return nowMs - state.holdStartMs > 2500;
}

export function stepTimingEngine({
  timingState,
  mode,
  sample,
  nowMs,
  learningProfile,
  distanceKm
}) {
  const state = { ...timingState[mode] };
  const out = { ...timingState };
  const threshold = accelerationThreshold(learningProfile, mode);

  if (state.phase === 'done' && state.doneAtMs && nowMs - state.doneAtMs > 10000) {
    state.phase = 'idle';
    state.doneTone = null;
    state.doneAtMs = null;
    state.resultSeconds = null;
  }

  const speed = sample.speedKmh;
  const delta = sample.deltaSpeedKmh;
  state.lastDeltaKmh = delta;
  state.recentPeakSpeedKmh = Math.max(state.recentPeakSpeedKmh, speed);

  const stationaryReady = speed <= 1.6 && sample.accelAbsMps2 <= 0.45;
  const steadyFifty = speed >= 47 && speed <= 53 && sample.speedStdKmh <= 2.4;

  if (mode === TIMING_MODES.ZERO_TO_100 || mode === TIMING_MODES.QUARTER_MILE) {
    if (state.phase === 'idle' || state.phase === 'ready') {
      if (stationaryReady) {
        if (!state.holdStartMs) state.holdStartMs = nowMs;
        if (nowMs - state.holdStartMs >= 2000) state.phase = 'ready';
      } else if (state.phase !== 'tracking') {
        state.holdStartMs = null;
      }
      if (state.phase === 'ready' && isHeavyAcceleration(sample, threshold)) {
        state.phase = 'tracking';
        state.startedAtMs = nowMs - Math.min(350, sample.lookbackMs || 0);
        state.startedDistanceKm = distanceKm;
        state.launchAccelMps2 = sample.accelMps2;
        state.holdStartMs = null;
      }
    }
  }

  if (mode === TIMING_MODES.FIFTY_TO_120) {
    if (state.phase === 'idle' || state.phase === 'ready') {
      if (steadyFifty) {
        if (!state.holdStartMs) state.holdStartMs = nowMs;
        if (nowMs - state.holdStartMs >= 1000) state.phase = 'ready';
      } else {
        state.holdStartMs = null;
        if (state.phase !== 'tracking') state.phase = 'idle';
      }

      if (state.phase === 'ready' && isHeavyAcceleration(sample, threshold)) {
        state.phase = 'tracking';
        state.startedAtMs = nowMs - Math.min(250, sample.lookbackMs || 0);
        state.startedDistanceKm = distanceKm;
        state.launchAccelMps2 = sample.accelMps2;
        state.holdStartMs = null;
      }
    }
  }

  if (state.phase === 'tracking') {
    if (shouldAbortTiming(state, sample, nowMs)) {
      state.phase = 'idle';
      state.startedAtMs = null;
      state.startedDistanceKm = null;
      state.launchAccelMps2 = null;
      state.recentPeakSpeedKmh = speed;
      out[mode] = state;
      return { timingState: out, event: { type: 'aborted', mode } };
    }

    const hitSpeed = speed >= state.targetSpeedKmh;
    const hitDistance =
      mode === TIMING_MODES.QUARTER_MILE &&
      Number.isFinite(state.startedDistanceKm) &&
      Number.isFinite(distanceKm) &&
      (distanceKm - state.startedDistanceKm) >= state.targetDistanceKm;

    if (hitSpeed || hitDistance) {
      const seconds = Math.max(0.01, (nowMs - state.startedAtMs) / 1000);
      const better = !Number.isFinite(state.bestSeconds) || seconds < state.bestSeconds;
      state.resultSeconds = seconds;
      state.bestSeconds = better ? seconds : state.bestSeconds;
      state.phase = 'done';
      state.doneTone = better ? 'better' : 'worse';
      state.doneAtMs = nowMs;
      state.startedAtMs = null;
      state.startedDistanceKm = null;
      state.recentPeakSpeedKmh = speed;
      out[mode] = state;
      return {
        timingState: out,
        event: {
          type: 'finished',
          mode,
          seconds,
          better,
          launchAccelMps2: state.launchAccelMps2
        }
      };
    }
  }

  out[mode] = state;
  return { timingState: out, event: null };
}

export function aggregateAllTimeRecords({ trips, lastKnownElevationM, bestTimes }) {
  const safeTrips = Array.isArray(trips) ? trips : [];
  const maxSpeedKmh = safeTrips.reduce((max, trip) => Math.max(max, trip.maxSpeedKmh || 0), 0);
  const maxAvgSpeedKmh = safeTrips.reduce((max, trip) => Math.max(max, trip.avgSpeedKmh || 0), 0);

  let longestTrip = { distanceKm: 0, movingDurationMs: 0 };
  for (const trip of safeTrips) {
    if ((trip.totalDistanceKm || 0) > longestTrip.distanceKm) {
      longestTrip = {
        distanceKm: trip.totalDistanceKm || 0,
        movingDurationMs: trip.movingDurationMs || 0
      };
    }
  }

  const minElevationEverM = safeTrips.reduce((min, trip) => {
    if (!Number.isFinite(trip.minElevationM)) return min;
    return Math.min(min, trip.minElevationM);
  }, Number.POSITIVE_INFINITY);

  const maxElevationEverM = safeTrips.reduce((max, trip) => Math.max(max, trip.maxElevationM || Number.NEGATIVE_INFINITY), Number.NEGATIVE_INFINITY);

  const elevationDiffEverM = safeTrips.reduce((max, trip) => {
    const diff = Number.isFinite(trip.maxElevationM) && Number.isFinite(trip.minElevationM)
      ? trip.maxElevationM - trip.minElevationM
      : 0;
    return Math.max(max, diff);
  }, 0);

  return {
    maxSpeedKmh,
    maxAvgSpeedKmh,
    longestDistanceKm: longestTrip.distanceKm,
    longestDistanceTripDurationMs: longestTrip.movingDurationMs,
    currentElevationM: Number.isFinite(lastKnownElevationM) ? lastKnownElevationM : 0,
    minElevationEverM: Number.isFinite(minElevationEverM) ? minElevationEverM : 0,
    maxElevationEverM: Number.isFinite(maxElevationEverM) ? maxElevationEverM : 0,
    maxElevationDiffEverM: elevationDiffEverM,
    bestZeroTo100S: bestTimes?.zeroTo100 ?? null,
    bestFiftyTo120S: bestTimes?.fiftyTo120 ?? null,
    bestQuarterMileS: bestTimes?.quarterMile ?? null
  };
}

export function deriveTripMetrics(trip, nowMs) {
  if (!trip) {
    return { movingDurationMs: 0, avgSpeedKmh: 0 };
  }

  const startTimeMs = Number.isFinite(trip.startTimeMs) ? trip.startTimeMs : nowMs;
  const pausedDurationMs = Number.isFinite(trip.pausedDurationMs) ? Math.max(0, trip.pausedDurationMs) : 0;
  const activeMs = Math.max(0, nowMs - startTimeMs - pausedDurationMs);
  const hours = activeMs / 3600000;
  const distanceKm = Number.isFinite(trip.totalDistanceKm) ? Math.max(0, trip.totalDistanceKm) : 0;

  return {
    movingDurationMs: activeMs,
    avgSpeedKmh: hours > 0 ? distanceKm / hours : 0
  };
}

export function blankTrip(nowMs = Date.now()) {
  return {
    id: `trip-${nowMs}`,
    startTimeMs: nowMs,
    endTimeMs: null,
    movingDurationMs: 0,
    pausedDurationMs: 0,
    totalDistanceKm: 0,
    maxSpeedKmh: 0,
    avgSpeedKmh: 0,
    currentSpeedKmh: 0,
    elevationM: 0,
    minElevationM: null,
    maxElevationM: null,
    elevationDiffM: 0,
    startLocation: 'Unknown',
    endLocation: 'Unknown',
    points: [],
    timingResults: {
      zeroTo100: null,
      fiftyTo120: null,
      quarterMile: null
    },
    updatedAtMs: nowMs
  };
}
