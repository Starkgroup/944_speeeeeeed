import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIMING_MODES,
  aggregateAllTimeRecords,
  createLearningProfile,
  createTimingState,
  deriveTripMetrics,
  shouldAutoPause,
  shouldAutoResume,
  stepTimingEngine
} from '../logic.js';

function makeSample({
  speedKmh,
  deltaSpeedKmh = 0,
  accelMps2 = 0,
  accelAbsMps2 = Math.abs(accelMps2),
  speedStdKmh = 0,
  lookbackMs = 0
}) {
  return {
    speedKmh,
    deltaSpeedKmh,
    accelMps2,
    accelAbsMps2,
    speedStdKmh,
    lookbackMs
  };
}

test('auto pause: standstill more than one minute', () => {
  const paused = shouldAutoPause({
    stationaryMs: 61000,
    speedKmh: 0.4,
    motionClassification: { isWalkLike: false },
    distanceFromPauseAnchorM: 0
  });

  assert.equal(paused, true);
});

test('auto pause: walk-like slow movement away from stop anchor', () => {
  const paused = shouldAutoPause({
    stationaryMs: 4000,
    speedKmh: 5,
    motionClassification: { isWalkLike: true },
    distanceFromPauseAnchorM: 52
  });

  assert.equal(paused, true);
});

test('auto resume: requires anchor radius and car-like movement', () => {
  const nowMs = 10_000;

  assert.equal(shouldAutoResume({
    distanceToAnchorM: 60,
    motionClassification: { isCarLike: true },
    speedKmh: 11,
    pausedAtMs: nowMs - 30_000,
    nowMs
  }), true);

  assert.equal(shouldAutoResume({
    distanceToAnchorM: 160,
    motionClassification: { isCarLike: true },
    speedKmh: 11,
    pausedAtMs: nowMs - 30_000,
    nowMs
  }), false);

  assert.equal(shouldAutoResume({
    distanceToAnchorM: 60,
    motionClassification: { isCarLike: true },
    speedKmh: 11,
    pausedAtMs: nowMs - 3_700_000,
    nowMs
  }), false);
});

test('timing engine: fifty-to-120 starts after steady 50 and completes', () => {
  let timingState = createTimingState();
  const learningProfile = createLearningProfile();
  let nowMs = 0;
  let event = null;

  for (let i = 0; i < 12; i += 1) {
    nowMs += 100;
    ({ timingState, event } = stepTimingEngine({
      timingState,
      mode: TIMING_MODES.FIFTY_TO_120,
      sample: makeSample({ speedKmh: 50, speedStdKmh: 1.2, accelMps2: 0.12 }),
      nowMs,
      learningProfile,
      distanceKm: 1
    }));
  }

  assert.equal(timingState[TIMING_MODES.FIFTY_TO_120].phase, 'ready');
  assert.equal(event, null);

  nowMs += 100;
  ({ timingState } = stepTimingEngine({
    timingState,
    mode: TIMING_MODES.FIFTY_TO_120,
    sample: makeSample({ speedKmh: 52, speedStdKmh: 1.3, accelMps2: 2.2, deltaSpeedKmh: 2 }),
    nowMs,
    learningProfile,
    distanceKm: 1
  }));

  assert.equal(timingState[TIMING_MODES.FIFTY_TO_120].phase, 'tracking');

  for (let speed = 60; speed <= 124; speed += 8) {
    nowMs += 120;
    ({ timingState, event } = stepTimingEngine({
      timingState,
      mode: TIMING_MODES.FIFTY_TO_120,
      sample: makeSample({
        speedKmh: speed,
        deltaSpeedKmh: 4,
        accelMps2: 1.6,
        speedStdKmh: 4
      }),
      nowMs,
      learningProfile,
      distanceKm: 1
    }));

    if (event?.type === 'finished') {
      break;
    }
  }

  assert.equal(event?.type, 'finished');
  assert.equal(event?.mode, TIMING_MODES.FIFTY_TO_120);
  assert.equal(event?.better, true);
  assert.ok(event?.seconds > 0);
});

test('timing engine: tracking aborts on hard speed drop', () => {
  let timingState = createTimingState();
  const learningProfile = createLearningProfile();
  let nowMs = 0;

  for (let i = 0; i < 12; i += 1) {
    nowMs += 100;
    ({ timingState } = stepTimingEngine({
      timingState,
      mode: TIMING_MODES.FIFTY_TO_120,
      sample: makeSample({ speedKmh: 50, speedStdKmh: 1.1, accelMps2: 0.1 }),
      nowMs,
      learningProfile,
      distanceKm: 0.2
    }));
  }

  nowMs += 100;
  ({ timingState } = stepTimingEngine({
    timingState,
    mode: TIMING_MODES.FIFTY_TO_120,
    sample: makeSample({ speedKmh: 53, speedStdKmh: 1.4, accelMps2: 2.0, deltaSpeedKmh: 2.3 }),
    nowMs,
    learningProfile,
    distanceKm: 0.2
  }));

  nowMs += 120;
  ({ timingState } = stepTimingEngine({
    timingState,
    mode: TIMING_MODES.FIFTY_TO_120,
    sample: makeSample({ speedKmh: 80, speedStdKmh: 4, accelMps2: 2.4, deltaSpeedKmh: 8 }),
    nowMs,
    learningProfile,
    distanceKm: 0.3
  }));

  nowMs += 120;
  const result = stepTimingEngine({
    timingState,
    mode: TIMING_MODES.FIFTY_TO_120,
    sample: makeSample({ speedKmh: 66, speedStdKmh: 2.1, accelMps2: -2.6, deltaSpeedKmh: -14 }),
    nowMs,
    learningProfile,
    distanceKm: 0.32
  });

  assert.equal(result.event?.type, 'aborted');
  assert.equal(result.timingState[TIMING_MODES.FIFTY_TO_120].phase, 'idle');
});

test('timing engine: zero-to-100 starts from standstill and completes', () => {
  let timingState = createTimingState();
  const learningProfile = createLearningProfile();
  let nowMs = 0;
  let event = null;

  for (let i = 0; i < 22; i += 1) {
    nowMs += 100;
    ({ timingState } = stepTimingEngine({
      timingState,
      mode: TIMING_MODES.ZERO_TO_100,
      sample: makeSample({ speedKmh: 0.5, accelMps2: 0.1, accelAbsMps2: 0.1 }),
      nowMs,
      learningProfile,
      distanceKm: 2
    }));
  }

  assert.equal(timingState[TIMING_MODES.ZERO_TO_100].phase, 'ready');

  nowMs += 100;
  ({ timingState } = stepTimingEngine({
    timingState,
    mode: TIMING_MODES.ZERO_TO_100,
    sample: makeSample({ speedKmh: 4, accelMps2: 1.9, deltaSpeedKmh: 4 }),
    nowMs,
    learningProfile,
    distanceKm: 2
  }));

  assert.equal(timingState[TIMING_MODES.ZERO_TO_100].phase, 'tracking');

  for (let speed = 20; speed <= 104; speed += 14) {
    nowMs += 120;
    ({ timingState, event } = stepTimingEngine({
      timingState,
      mode: TIMING_MODES.ZERO_TO_100,
      sample: makeSample({ speedKmh: speed, accelMps2: 1.5, deltaSpeedKmh: 5 }),
      nowMs,
      learningProfile,
      distanceKm: 2
    }));
    if (event?.type === 'finished') break;
  }

  assert.equal(event?.type, 'finished');
  assert.equal(event?.mode, TIMING_MODES.ZERO_TO_100);
});

test('timing engine: quarter-mile completes by distance threshold', () => {
  let timingState = createTimingState();
  const learningProfile = createLearningProfile();
  let nowMs = 0;
  let event = null;

  for (let i = 0; i < 22; i += 1) {
    nowMs += 100;
    ({ timingState } = stepTimingEngine({
      timingState,
      mode: TIMING_MODES.QUARTER_MILE,
      sample: makeSample({ speedKmh: 0.3, accelMps2: 0.08, accelAbsMps2: 0.08 }),
      nowMs,
      learningProfile,
      distanceKm: 5
    }));
  }

  nowMs += 100;
  ({ timingState } = stepTimingEngine({
    timingState,
    mode: TIMING_MODES.QUARTER_MILE,
    sample: makeSample({ speedKmh: 6, accelMps2: 2.1, deltaSpeedKmh: 6 }),
    nowMs,
    learningProfile,
    distanceKm: 5
  }));

  assert.equal(timingState[TIMING_MODES.QUARTER_MILE].phase, 'tracking');

  const increments = [0.06, 0.09, 0.13, 0.16];
  let distanceKm = 5;
  for (const inc of increments) {
    distanceKm += inc;
    nowMs += 220;
    ({ timingState, event } = stepTimingEngine({
      timingState,
      mode: TIMING_MODES.QUARTER_MILE,
      sample: makeSample({ speedKmh: 90, accelMps2: 1.2, deltaSpeedKmh: 3 }),
      nowMs,
      learningProfile,
      distanceKm
    }));
    if (event?.type === 'finished') break;
  }

  assert.equal(event?.type, 'finished');
  assert.equal(event?.mode, TIMING_MODES.QUARTER_MILE);
});

test('all-time record aggregation returns expected maxima and best times', () => {
  const records = aggregateAllTimeRecords({
    trips: [
      {
        maxSpeedKmh: 180,
        avgSpeedKmh: 95,
        totalDistanceKm: 34,
        movingDurationMs: 2_000_000,
        minElevationM: 121,
        maxElevationM: 405
      },
      {
        maxSpeedKmh: 197,
        avgSpeedKmh: 92,
        totalDistanceKm: 56,
        movingDurationMs: 3_400_000,
        minElevationM: 99,
        maxElevationM: 390
      }
    ],
    lastKnownElevationM: 210,
    bestTimes: {
      zeroTo100: 3.9,
      fiftyTo120: 4.7,
      quarterMile: 11.6
    }
  });

  assert.equal(records.maxSpeedKmh, 197);
  assert.equal(records.maxAvgSpeedKmh, 95);
  assert.equal(records.longestDistanceKm, 56);
  assert.equal(records.longestDistanceTripDurationMs, 3_400_000);
  assert.equal(records.currentElevationM, 210);
  assert.equal(records.minElevationEverM, 99);
  assert.equal(records.maxElevationEverM, 405);
  assert.equal(records.maxElevationDiffEverM, 291);
  assert.equal(records.bestFiftyTo120S, 4.7);
});

test('deriveTripMetrics excludes pause time from moving duration and average speed', () => {
  const startTimeMs = 1_000;
  const nowMs = startTimeMs + 4_000_000;
  const trip = {
    startTimeMs,
    pausedDurationMs: 1_000_000,
    totalDistanceKm: 90
  };

  const metrics = deriveTripMetrics(trip, nowMs);

  assert.equal(metrics.movingDurationMs, 3_000_000);
  const expectedAvg = 90 / (3_000_000 / 3_600_000);
  assert.ok(Math.abs(metrics.avgSpeedKmh - expectedAvg) < 1e-9);
});
