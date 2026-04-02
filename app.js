import {
  APP_STATES,
  TIMING_MODES,
  aggregateAllTimeRecords,
  blankTrip,
  calculateDistanceMeters,
  classifyMotion,
  computeAccelMps2,
  computeSpeedKmhFromPoints,
  createLearningProfile,
  createTimingState,
  deriveTripMetrics,
  formatDuration,
  isSnapshotStale,
  shouldAutoPause,
  shouldAutoResume,
  stepTimingEngine,
  updateLearningProfile
} from './logic.js';

import {
  clearActiveSnapshot,
  clearAllStoredData,
  clearBestTimes,
  loadActiveSnapshot,
  loadBestTimes,
  loadLastElevation,
  loadLearningProfile,
  loadTrips,
  saveActiveSnapshot,
  saveBestTimes,
  saveLastElevation,
  saveLearningProfile,
  saveTrips
} from './storage.js';

const PROCESSING_HZ = 24;
const PROCESSING_INTERVAL_MS = Math.round(1000 / PROCESSING_HZ);
const SNAPSHOT_INTERVAL_MS = 15000;
const MAX_GPS_BUFFER = 300;
const MAX_PROCESSED_BUFFER = 240;
const MAX_TRIP_POINTS = 3000;
const ENABLED_TIMING_MODES = [TIMING_MODES.FIFTY_TO_120];

class SpeedometerApp {
  constructor() {
    this.state = APP_STATES.IDLE;
    this.gpsPermissionGranted = false;
    this.motionEnabled = false;
    this.watchId = null;
    this.processingTimer = null;
    this.snapshotTimer = null;

    this.trips = loadTrips();
    this.bestTimes = loadBestTimes();
    this.learningProfile = loadLearningProfile() || createLearningProfile();
    this.lastKnownElevationM = loadLastElevation();

    this.trip = null;
    this.lastFinishedTrip = null;

    this.gpsSamples = [];
    this.processedSamples = [];
    this.latestPosition = null;
    this.lastProcessedSpeedKmh = 0;
    this.lastProcessedTs = Date.now();
    this.stationarySinceMs = null;

    this.pauseStartedAtMs = null;
    this.pauseAnchor = null;
    this.autoPauseReference = null;

    this.timingState = createTimingState();

    this.motionData = {
      x: 0,
      y: 0,
      z: 0,
      magnitude: 0,
      extremaG: { n: 0, s: 0, e: 0, w: 0 }
    };

    this.runtimeStats = {
      gpsTicks: 0,
      uiTicks: 0,
      gpsHz: 0,
      uiHz: 0,
      gpsIntervalMsMin: null,
      gpsIntervalMsMax: null,
      lastGpsTickAtMs: null,
      lastMeasuredAtMs: Date.now()
    };

    this.flashTimers = new Map();

    this.cacheDom();
    this.bindEvents();
    this.restoreSnapshot();
    this.startPassiveSensors();
    this.startLoops();
    this.render();
  }

  cacheDom() {
    this.dom = {
      startBtn: document.getElementById('startBtn'),
      resetBtn: document.getElementById('resetBtn'),
      endBtn: document.getElementById('endBtn'),
      historyBtn: document.getElementById('historyBtn'),
      closeModalBtn: document.getElementById('closeModalBtn'),
      clearAllBtn: document.getElementById('clearAllBtn'),
      clearBestTimesBtn: document.getElementById('clearBestTimesBtn'),
      historyModal: document.getElementById('historyModal'),
      historyList: document.getElementById('historyList'),
      status: document.getElementById('status'),

      currentSpeed: document.getElementById('currentSpeed'),
      avgSpeed: document.getElementById('avgSpeed'),
      maxSpeed: document.getElementById('maxSpeed'),
      distance: document.getElementById('distance'),
      duration: document.getElementById('duration'),
      elevation: document.getElementById('elevation'),
      minElevation: document.getElementById('minElevation'),
      maxElevation: document.getElementById('maxElevation'),
      elevationGain: document.getElementById('elevationGain'),

      timing0to100Card: document.getElementById('timing0to100'),
      timing50to120Card: document.getElementById('timing50to120'),
      timingQuarterCard: document.getElementById('timingQuarterMile'),
      timing0to100Value: document.getElementById('timing0to100Value'),
      timing50to120Value: document.getElementById('timing50to120Value'),
      timingQuarterValue: document.getElementById('timingQuarterMileValue'),

      speedometer: document.querySelector('.speedometer'),
      speedProgress: document.getElementById('speedProgress'),
      motionBlob: document.getElementById('motionBlob'),
      gyroButton: document.getElementById('enable'),
      gyroN: document.getElementById('gyroNorthMax'),
      gyroS: document.getElementById('gyroSouthMax'),
      gyroE: document.getElementById('gyroEastMax'),
      gyroW: document.getElementById('gyroWestMax')
    };
  }

  bindEvents() {
    this.dom.startBtn?.addEventListener('click', () => this.handleStartPauseButton());
    this.dom.resetBtn?.addEventListener('click', () => this.handleResetButton());
    this.dom.endBtn?.addEventListener('click', () => this.handleEndButton());
    this.dom.historyBtn?.addEventListener('click', () => this.showHistory());
    this.dom.closeModalBtn?.addEventListener('click', () => this.hideHistory());
    this.dom.clearAllBtn?.addEventListener('click', () => this.clearAllTrips());
    this.dom.clearBestTimesBtn?.addEventListener('click', () => this.clearTimingRecords());
    this.dom.gyroButton?.addEventListener('click', (event) => {
      event.preventDefault();
      this.toggleMotionSensors();
    });

    this.dom.historyModal?.addEventListener('click', (event) => {
      if (event.target === this.dom.historyModal) this.hideHistory();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.hideHistory();
    });

    window.addEventListener('beforeunload', () => {
      this.persistSnapshot();
      this.stopLoops();
      this.stopGpsWatch();
      this.stopMotionSensors();
    });
  }

  restoreSnapshot() {
    const snapshot = loadActiveSnapshot();
    if (!snapshot) return;

    if (isSnapshotStale(snapshot)) {
      clearActiveSnapshot();
      return;
    }

    if (!snapshot.trip) return;

    this.trip = snapshot.trip;
    this.state = APP_STATES.PAUSED_AUTO;
    this.pauseAnchor = snapshot.pauseAnchor || (this.trip.points?.length
      ? {
        lat: this.trip.points[this.trip.points.length - 1].lat,
        lng: this.trip.points[this.trip.points.length - 1].lng
      }
      : null);
    this.pauseStartedAtMs = snapshot.pauseStartedAtMs || Date.now();

    this.updateStatus('Trip restored in auto-pause mode', 'tracking');
  }

  startPassiveSensors() {
    if (!navigator.geolocation) {
      this.updateStatus('Geolocation not supported', 'error');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => {
        this.gpsPermissionGranted = true;
        this.updateStatus('GPS permission granted', '');
      },
      (error) => this.handleGpsError(error),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );

    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handleRawPosition(position),
      (error) => this.handleGpsError(error),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 1000 }
    );
  }

  startLoops() {
    this.processingTimer = window.setInterval(() => this.processTick(), PROCESSING_INTERVAL_MS);
    this.snapshotTimer = window.setInterval(() => this.persistSnapshot(), SNAPSHOT_INTERVAL_MS);
  }

  stopLoops() {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  stopGpsWatch() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  handleGpsError(error) {
    if (error?.code === 1) {
      this.updateStatus('GPS permission denied', 'error');
      return;
    }
    this.updateStatus('GPS signal limited, retrying…', 'tracking');
  }

  handleRawPosition(position) {
    this.gpsPermissionGranted = true;
    const nowMs = Date.now();
    this.recordGpsTick(nowMs);
    const sample = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      altitudeM: Number.isFinite(position.coords.altitude) ? position.coords.altitude : this.lastKnownElevationM,
      accuracyM: position.coords.accuracy || 0,
      speedKmh: Number.isFinite(position.coords.speed)
        ? Math.max(0, position.coords.speed * 3.6)
        : 0,
      timestampMs: nowMs
    };

    const previous = this.gpsSamples[this.gpsSamples.length - 1];
    if (!Number.isFinite(sample.speedKmh) || sample.speedKmh <= 0) {
      sample.speedKmh = computeSpeedKmhFromPoints(previous, sample);
    }

    this.gpsSamples.push(sample);
    if (this.gpsSamples.length > MAX_GPS_BUFFER) this.gpsSamples.shift();
    this.latestPosition = sample;
    this.lastKnownElevationM = sample.altitudeM;
    saveLastElevation(this.lastKnownElevationM);

    if (this.state === APP_STATES.TRACKING && this.trip) {
      this.applyRawPointToTrip(sample);
    }
  }

  applyRawPointToTrip(sample) {
    const points = this.trip.points;
    const previous = points[points.length - 1];

    if (previous) {
      const meters = calculateDistanceMeters(previous.lat, previous.lng, sample.lat, sample.lng);
      this.trip.totalDistanceKm += meters / 1000;
    }

    points.push(sample);
    if (points.length > MAX_TRIP_POINTS) points.shift();

    this.trip.currentSpeedKmh = sample.speedKmh;
    this.trip.maxSpeedKmh = Math.max(this.trip.maxSpeedKmh, sample.speedKmh);
    this.trip.elevationM = sample.altitudeM;

    if (!Number.isFinite(this.trip.minElevationM) || sample.altitudeM < this.trip.minElevationM) {
      this.trip.minElevationM = sample.altitudeM;
    }
    if (!Number.isFinite(this.trip.maxElevationM) || sample.altitudeM > this.trip.maxElevationM) {
      this.trip.maxElevationM = sample.altitudeM;
    }

    if (Number.isFinite(this.trip.minElevationM) && Number.isFinite(this.trip.maxElevationM)) {
      this.trip.elevationDiffM = this.trip.maxElevationM - this.trip.minElevationM;
    }

    this.trip.updatedAtMs = Date.now();
  }

  processTick() {
    const nowMs = Date.now();
    this.recordUiTick(nowMs);
    const latest = this.gpsSamples[this.gpsSamples.length - 1];

    let speedKmh = latest?.speedKmh || 0;
    if (!Number.isFinite(speedKmh)) speedKmh = 0;

    const dtMs = Math.max(1, nowMs - this.lastProcessedTs);
    const deltaSpeedKmh = speedKmh - this.lastProcessedSpeedKmh;
    const accelMps2 = computeAccelMps2(this.lastProcessedSpeedKmh, speedKmh, dtMs);

    const windowSpeeds = this.gpsSamples.slice(-24).map((sample) => sample.speedKmh || 0);
    const speedMean = windowSpeeds.length
      ? windowSpeeds.reduce((sum, value) => sum + value, 0) / windowSpeeds.length
      : 0;
    const speedVariance = windowSpeeds.length
      ? windowSpeeds.reduce((sum, value) => sum + ((value - speedMean) ** 2), 0) / windowSpeeds.length
      : 0;
    const speedStdKmh = Math.sqrt(speedVariance);

    const processed = {
      timestampMs: nowMs,
      speedKmh,
      deltaSpeedKmh,
      accelMps2,
      accelAbsMps2: Math.abs(accelMps2),
      speedStdKmh,
      gyroMagnitude: this.motionData.magnitude,
      lookbackMs: latest ? nowMs - latest.timestampMs : 0
    };

    this.processedSamples.push(processed);
    if (this.processedSamples.length > MAX_PROCESSED_BUFFER) this.processedSamples.shift();

    if (speedKmh <= 1.2) {
      if (!this.stationarySinceMs) {
        this.stationarySinceMs = nowMs;
        this.autoPauseReference = this.latestPosition
          ? { lat: this.latestPosition.lat, lng: this.latestPosition.lng }
          : null;
      }
    } else {
      this.stationarySinceMs = null;
      this.autoPauseReference = null;
    }

    this.maybeAutoStart(speedKmh);
    this.syncLiveSpeedToUiSource(speedKmh);
    this.stepAutoPauseResume(nowMs, processed);
    this.stepTiming(nowMs, processed);
    this.updateTripDerivedStats(nowMs);

    this.lastProcessedSpeedKmh = speedKmh;
    this.lastProcessedTs = nowMs;

    this.render();
  }

  maybeAutoStart(speedKmh) {
    if (this.state !== APP_STATES.IDLE) return;
    if (!this.gpsPermissionGranted) return;
    if (speedKmh < 5) return;

    this.startNewTrip('auto');
    this.updateStatus('Trip auto-started after movement', 'tracking');
  }

  recordGpsTick(nowMs) {
    this.runtimeStats.gpsTicks += 1;
    if (Number.isFinite(this.runtimeStats.lastGpsTickAtMs)) {
      const intervalMs = nowMs - this.runtimeStats.lastGpsTickAtMs;
      if (intervalMs >= 0) {
        this.runtimeStats.gpsIntervalMsMin = this.runtimeStats.gpsIntervalMsMin === null
          ? intervalMs
          : Math.min(this.runtimeStats.gpsIntervalMsMin, intervalMs);
        this.runtimeStats.gpsIntervalMsMax = this.runtimeStats.gpsIntervalMsMax === null
          ? intervalMs
          : Math.max(this.runtimeStats.gpsIntervalMsMax, intervalMs);
      }
    }
    this.runtimeStats.lastGpsTickAtMs = nowMs;
  }

  recordUiTick(nowMs) {
    this.runtimeStats.uiTicks += 1;
    const elapsedMs = nowMs - this.runtimeStats.lastMeasuredAtMs;
    if (elapsedMs < 1000) return;

    const elapsedSec = elapsedMs / 1000;
    this.runtimeStats.gpsHz = this.runtimeStats.gpsTicks / elapsedSec;
    this.runtimeStats.uiHz = this.runtimeStats.uiTicks / elapsedSec;
    this.runtimeStats.gpsTicks = 0;
    this.runtimeStats.uiTicks = 0;
    this.runtimeStats.lastMeasuredAtMs = nowMs;
  }

  getRuntimeStats() {
    const latestGpsSample = this.gpsSamples[this.gpsSamples.length - 1];
    return {
      gpsHz: this.runtimeStats.gpsHz,
      uiHz: this.runtimeStats.uiHz,
      gpsIntervalMsMin: this.runtimeStats.gpsIntervalMsMin,
      gpsIntervalMsMax: this.runtimeStats.gpsIntervalMsMax,
      latestGpsSampleAgeMs: latestGpsSample ? Date.now() - latestGpsSample.timestampMs : null,
      gpsSampleCount: this.gpsSamples.length,
      processedSampleCount: this.processedSamples.length
    };
  }

  syncLiveSpeedToUiSource(speedKmh) {
    if (!this.trip || this.state !== APP_STATES.TRACKING) return;
    this.trip.currentSpeedKmh = speedKmh;
    if (Number.isFinite(speedKmh)) {
      this.trip.maxSpeedKmh = Math.max(this.trip.maxSpeedKmh, speedKmh);
    }
  }

  stepAutoPauseResume(nowMs, processed) {
    const motionWindow = this.processedSamples.slice(-30);
    const motionClassification = classifyMotion(motionWindow);

    const autoPauseDistanceM =
      this.autoPauseReference && this.latestPosition
        ? calculateDistanceMeters(this.autoPauseReference.lat, this.autoPauseReference.lng, this.latestPosition.lat, this.latestPosition.lng)
        : 0;

    const distanceFromPauseAnchorM =
      this.pauseAnchor && this.latestPosition
        ? calculateDistanceMeters(this.pauseAnchor.lat, this.pauseAnchor.lng, this.latestPosition.lat, this.latestPosition.lng)
        : 0;

    if (this.state === APP_STATES.TRACKING) {
      const stationaryMs = this.stationarySinceMs ? nowMs - this.stationarySinceMs : 0;
      const autoPause = shouldAutoPause({
        stationaryMs,
        speedKmh: processed.speedKmh,
        motionClassification,
        distanceFromPauseAnchorM: autoPauseDistanceM
      });

      if (autoPause) {
        this.pauseAnchor = this.latestPosition ? { lat: this.latestPosition.lat, lng: this.latestPosition.lng } : this.pauseAnchor;
        this.pauseTrip(true);
      }
    }

    if (this.state === APP_STATES.PAUSED_AUTO) {
      const autoResume = shouldAutoResume({
        distanceToAnchorM: distanceFromPauseAnchorM,
        motionClassification,
        speedKmh: processed.speedKmh,
        pausedAtMs: this.pauseStartedAtMs,
        nowMs
      });

      if (autoResume) {
        this.resumeTrip(true);
      }

      if (this.pauseStartedAtMs && nowMs - this.pauseStartedAtMs > 3600000 && processed.speedKmh >= 6) {
        this.endTrip('Pause older than 1h; closed automatically');
        this.startNewTrip('auto-after-stale');
      }
    }
  }

  stepTiming(nowMs, processed) {
    if (this.state !== APP_STATES.TRACKING || !this.trip) return;

    for (const mode of ENABLED_TIMING_MODES) {
      const { timingState, event } = stepTimingEngine({
        timingState: this.timingState,
        mode,
        sample: processed,
        nowMs,
        learningProfile: this.learningProfile,
        distanceKm: this.trip.totalDistanceKm
      });

      this.timingState = timingState;

      if (!event) continue;

      if (event.type === 'finished') {
        if (mode === TIMING_MODES.ZERO_TO_100) {
          this.trip.timingResults.zeroTo100 = event.seconds;
          if (event.better) this.bestTimes.zeroTo100 = event.seconds;
          this.flashElement(this.dom.timing0to100Card, event.better ? 'timing-better' : 'timing-worse', 10000);
        } else if (mode === TIMING_MODES.FIFTY_TO_120) {
          this.trip.timingResults.fiftyTo120 = event.seconds;
          if (event.better) this.bestTimes.fiftyTo120 = event.seconds;
          this.flashElement(this.dom.timing50to120Card, event.better ? 'timing-better' : 'timing-worse', 10000);
        } else if (mode === TIMING_MODES.QUARTER_MILE) {
          this.trip.timingResults.quarterMile = event.seconds;
          if (event.better) this.bestTimes.quarterMile = event.seconds;
          this.flashElement(this.dom.timingQuarterCard, event.better ? 'timing-better' : 'timing-worse', 10000);
        }

        saveBestTimes(this.bestTimes);
        this.learningProfile = updateLearningProfile(this.learningProfile, mode, event.launchAccelMps2);
        saveLearningProfile(this.learningProfile);
      }
    }
  }

  updateTripDerivedStats(nowMs) {
    if (!this.trip) return;

    if (this.state === APP_STATES.TRACKING) {
      const metrics = deriveTripMetrics(this.trip, nowMs);
      this.trip.movingDurationMs = metrics.movingDurationMs;
      this.trip.avgSpeedKmh = metrics.avgSpeedKmh;
      this.trip.updatedAtMs = nowMs;
    }

    if (this.state === APP_STATES.PAUSED_AUTO || this.state === APP_STATES.PAUSED_MANUAL) {
      this.trip.updatedAtMs = nowMs;
    }
  }

  handleStartPauseButton() {
    if (this.state === APP_STATES.TRACKING) {
      this.pauseTrip(false);
      return;
    }

    if (this.state === APP_STATES.PAUSED_MANUAL || this.state === APP_STATES.PAUSED_AUTO) {
      this.resumeTrip(false);
      return;
    }

    this.startNewTrip('manual');
  }

  handleResetButton() {
    if (this.state === APP_STATES.TRACKING) {
      this.startNewTrip('fresh-reset');
      this.flashElement(this.dom.resetBtn, 'btn-flash-green', 10000);
      this.updateStatus('Fresh start created', 'tracking');
      return;
    }

    this.state = APP_STATES.IDLE;
    this.trip = null;
    this.pauseStartedAtMs = null;
    this.pauseAnchor = null;
    this.timingState = createTimingState();
    clearActiveSnapshot();
    this.flashElement(this.dom.resetBtn, 'btn-flash-green', 10000);
    this.updateStatus('Reset to all-time overview', '');
    this.render();
  }

  handleEndButton() {
    if (!this.trip) return;
    this.endTrip('Trip finished manually');
  }

  startNewTrip(reason) {
    const nowMs = Date.now();

    if (this.trip && this.state === APP_STATES.TRACKING) {
      this.endTrip('Trip replaced by fresh start');
    }

    this.trip = blankTrip(nowMs);
    this.state = APP_STATES.TRACKING;
    this.pauseStartedAtMs = null;
    this.pauseAnchor = this.latestPosition
      ? { lat: this.latestPosition.lat, lng: this.latestPosition.lng }
      : null;
    this.autoPauseReference = null;
    this.timingState = createTimingState();

    if (this.latestPosition) {
      this.trip.startLocation = `${this.latestPosition.lat.toFixed(5)}, ${this.latestPosition.lng.toFixed(5)}`;
      this.trip.points.push(this.latestPosition);
    }

    if (reason === 'fresh-reset') {
      this.flashElement(this.dom.resetBtn, 'btn-flash-green', 10000);
    }

    this.persistSnapshot();
  }

  pauseTrip(auto) {
    if (!this.trip) return;

    this.pauseStartedAtMs = Date.now();
    this.state = auto ? APP_STATES.PAUSED_AUTO : APP_STATES.PAUSED_MANUAL;
    this.autoPauseReference = null;

    if (auto) {
      this.flashElement(this.dom.startBtn, 'btn-flash-orange', 10000);
      this.updateStatus('Auto-paused', 'tracking');
    } else {
      this.updateStatus('Paused', '');
    }

    this.persistSnapshot();
  }

  resumeTrip(autoResume) {
    if (!this.trip || !this.pauseStartedAtMs) return;

    this.trip.pausedDurationMs += Date.now() - this.pauseStartedAtMs;
    this.pauseStartedAtMs = null;
    this.state = APP_STATES.TRACKING;

    if (autoResume) {
      this.flashElement(this.dom.startBtn, 'btn-flash-green', 10000);
      this.updateStatus('Auto-resumed', 'tracking');
    } else {
      this.updateStatus('Resumed', 'tracking');
    }

    this.persistSnapshot();
  }

  endTrip(statusMessage) {
    if (!this.trip) return;

    const nowMs = Date.now();
    if (this.pauseStartedAtMs) {
      this.trip.pausedDurationMs += nowMs - this.pauseStartedAtMs;
      this.pauseStartedAtMs = null;
    }

    this.trip.endTimeMs = nowMs;
    this.trip.currentSpeedKmh = this.latestPosition?.speedKmh || 0;
    this.trip.endLocation = this.latestPosition
      ? `${this.latestPosition.lat.toFixed(5)}, ${this.latestPosition.lng.toFixed(5)}`
      : this.trip.endLocation;

    this.lastFinishedTrip = { ...this.trip };
    this.trips.unshift(this.lastFinishedTrip);
    if (this.trips.length > 500) this.trips.length = 500;

    saveTrips(this.trips);

    this.state = APP_STATES.ENDED;
    this.trip = null;
    this.autoPauseReference = null;
    clearActiveSnapshot();

    this.updateStatus(statusMessage, '');
    this.renderHistory();
    this.render();
  }

  persistSnapshot() {
    if (!this.trip) {
      clearActiveSnapshot();
      return;
    }

    const snapshot = {
      trip: this.trip,
      state: this.state,
      pauseAnchor: this.pauseAnchor,
      pauseStartedAtMs: this.pauseStartedAtMs,
      updatedAtMs: Date.now()
    };

    saveActiveSnapshot(snapshot);
  }

  clearAllTrips() {
    if (!window.confirm('Delete all trips and active snapshot?')) return;
    this.trips = [];
    this.lastFinishedTrip = null;
    this.trip = null;
    this.state = APP_STATES.IDLE;
    clearAllStoredData();
    this.bestTimes = { zeroTo100: null, fiftyTo120: null, quarterMile: null };
    this.learningProfile = createLearningProfile();
    this.renderHistory();
    this.render();
    this.updateStatus('All trips removed', '');
  }

  clearTimingRecords() {
    if (!window.confirm('Delete all best timing records?')) return;
    this.bestTimes = { zeroTo100: null, fiftyTo120: null, quarterMile: null };
    clearBestTimes();
    this.updateStatus('Best timing records cleared', '');
    this.render();
  }

  showHistory() {
    this.renderHistory();
    this.dom.historyModal?.classList.add('show');
  }

  hideHistory() {
    this.dom.historyModal?.classList.remove('show');
  }

  deleteTrip(tripId) {
    this.trips = this.trips.filter((trip) => trip.id !== tripId);
    saveTrips(this.trips);
    this.renderHistory();
    this.render();
  }

  renderHistory() {
    if (!this.dom.historyList) return;

    if (!this.trips.length) {
      this.dom.historyList.innerHTML = '<div class="no-trips">No saved trips</div>';
      return;
    }

    this.dom.historyList.innerHTML = this.trips.map((trip) => {
      const duration = formatDuration(trip.movingDurationMs || 0);
      return `
        <div class="trip-item">
          <div class="trip-header">
            <div class="trip-date">${new Date(trip.startTimeMs).toLocaleString()}</div>
            <button class="btn-delete" data-trip-id="${trip.id}" title="Delete trip">✕</button>
          </div>
          <div class="trip-route">${trip.startLocation} → ${trip.endLocation}</div>
          <div class="trip-stats">
            <div class="trip-stat"><div class="trip-stat-label">Distance</div><div class="trip-stat-value">${(trip.totalDistanceKm || 0).toFixed(2)} km</div></div>
            <div class="trip-stat"><div class="trip-stat-label">Duration</div><div class="trip-stat-value">${duration}</div></div>
            <div class="trip-stat"><div class="trip-stat-label">V.Max</div><div class="trip-stat-value">${Math.round(trip.maxSpeedKmh || 0)} km/h</div></div>
            <div class="trip-stat"><div class="trip-stat-label">V.Avg</div><div class="trip-stat-value">${Math.round(trip.avgSpeedKmh || 0)} km/h</div></div>
          </div>
        </div>
      `;
    }).join('');

    this.dom.historyList.querySelectorAll('.btn-delete').forEach((button) => {
      button.addEventListener('click', () => this.deleteTrip(button.dataset.tripId));
    });
  }

  async toggleMotionSensors() {
    if (this.motionEnabled) {
      this.stopMotionSensors();
      return;
    }

    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const permission = await DeviceMotionEvent.requestPermission();
        if (permission !== 'granted') {
          this.updateStatus('Gyro permission denied', 'error');
          return;
        }
      }

      const onMotion = (event) => {
        const ax = event.acceleration?.x ?? 0;
        const ay = event.acceleration?.y ?? 0;
        const az = event.acceleration?.z ?? 0;

        this.motionData.x = ax;
        this.motionData.y = ay;
        this.motionData.z = az;

        const magnitude = Math.sqrt((ax * ax) + (ay * ay) + (az * az)) / 9.81;
        this.motionData.magnitude = magnitude;

        const xG = ax / 9.81;
        const zG = az / 9.81;
        if (zG > 0) this.motionData.extremaG.n = Math.max(this.motionData.extremaG.n, zG);
        if (zG < 0) this.motionData.extremaG.s = Math.max(this.motionData.extremaG.s, Math.abs(zG));
        if (xG > 0) this.motionData.extremaG.e = Math.max(this.motionData.extremaG.e, xG);
        if (xG < 0) this.motionData.extremaG.w = Math.max(this.motionData.extremaG.w, Math.abs(xG));

        this.updateBlobVisual();
      };

      this.motionListener = onMotion;
      window.addEventListener('devicemotion', onMotion);
      this.motionEnabled = true;
      this.dom.gyroButton?.classList.add('hidden');
      this.updateStatus('Gyro enabled', 'tracking');
    } catch (error) {
      console.error(error);
      this.updateStatus('Failed to enable gyro', 'error');
    }
  }

  stopMotionSensors() {
    if (this.motionListener) {
      window.removeEventListener('devicemotion', this.motionListener);
      this.motionListener = null;
    }

    this.motionEnabled = false;
    this.motionData.magnitude = 0;
    this.dom.gyroButton?.classList.remove('hidden');
    this.updateBlobVisual();
  }

  updateBlobVisual() {
    const blob = this.dom.motionBlob;
    if (!blob) return;

    const strength = Math.min(1, this.motionData.magnitude * 1.4);
    const size = 18 + (strength * 88);
    const x = Math.max(-220, Math.min(220, this.motionData.x * -16));
    const y = Math.max(-220, Math.min(220, this.motionData.z * 16));

    blob.style.width = `${size}px`;
    blob.style.height = `${size}px`;
    blob.style.opacity = `${0.06 + (strength * 0.66)}`;
    blob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  flashElement(element, className, durationMs = 10000) {
    if (!element) return;

    const key = `${element.id || element.className}-${className}`;
    const current = this.flashTimers.get(key);
    if (current) clearTimeout(current);

    element.classList.add(className);
    const timer = window.setTimeout(() => {
      element.classList.remove(className);
      this.flashTimers.delete(key);
    }, durationMs);

    this.flashTimers.set(key, timer);
  }

  updateStatus(message, type = '') {
    if (!this.dom.status) return;
    this.dom.status.textContent = message;
    this.dom.status.className = `status ${type}`;
  }

  render() {
    const allTimeRecords = aggregateAllTimeRecords({
      trips: this.trips,
      lastKnownElevationM: this.lastKnownElevationM,
      bestTimes: this.bestTimes
    });

    const renderAllTime = this.state === APP_STATES.IDLE;
    const renderEnded = this.state === APP_STATES.ENDED && this.lastFinishedTrip;
    const source = renderAllTime
      ? {
        currentSpeedKmh: 0,
        avgSpeedKmh: allTimeRecords.maxAvgSpeedKmh,
        maxSpeedKmh: allTimeRecords.maxSpeedKmh,
        totalDistanceKm: allTimeRecords.longestDistanceKm,
        movingDurationMs: allTimeRecords.longestDistanceTripDurationMs,
        elevationM: allTimeRecords.currentElevationM,
        minElevationM: allTimeRecords.minElevationEverM,
        maxElevationM: allTimeRecords.maxElevationEverM,
        elevationDiffM: allTimeRecords.maxElevationDiffEverM
      }
      : (renderEnded ? this.lastFinishedTrip : this.trip) || {
        currentSpeedKmh: 0,
        avgSpeedKmh: 0,
        maxSpeedKmh: 0,
        totalDistanceKm: 0,
        movingDurationMs: 0,
        elevationM: this.lastKnownElevationM,
        minElevationM: 0,
        maxElevationM: 0,
        elevationDiffM: 0
      };

    const speedKmh = source.currentSpeedKmh || 0;
    const speedColor = this.getSpeedColor(speedKmh);

    this.dom.currentSpeed.textContent = Math.round(speedKmh);
    this.dom.currentSpeed.style.color = speedColor;
    this.dom.currentSpeed.style.textShadow = `0 0 18px ${speedColor}`;
    this.dom.avgSpeed.innerHTML = `${Math.round(source.avgSpeedKmh || 0)} <span class="unit">km/h</span>`;
    this.dom.maxSpeed.innerHTML = `${Math.round(source.maxSpeedKmh || 0)} <span class="unit">km/h</span>`;
    this.dom.distance.innerHTML = `${(source.totalDistanceKm || 0).toFixed(2)} <span class="unit">km</span>`;
    this.dom.duration.textContent = formatDuration(source.movingDurationMs || 0);
    this.dom.elevation.innerHTML = `${Math.round(source.elevationM || 0)} <span class="unit">m</span>`;
    this.dom.minElevation.innerHTML = `${Math.round(source.minElevationM || 0)} <span class="unit">m</span>`;
    this.dom.maxElevation.innerHTML = `${Math.round(source.maxElevationM || 0)} <span class="unit">m</span>`;
    this.dom.elevationGain.innerHTML = `+${Math.round(source.elevationDiffM || 0)} <span class="unit">m</span>`;

    this.renderTimingCards();
    this.renderButtons();
    this.renderGyroCompass();
    this.renderSpeedRing(speedKmh, speedColor);
  }

  renderButtons() {
    const isTracking = this.state === APP_STATES.TRACKING;
    const isPaused = this.state === APP_STATES.PAUSED_AUTO || this.state === APP_STATES.PAUSED_MANUAL;

    this.dom.startBtn.disabled = !this.gpsPermissionGranted && !isPaused;
    this.dom.resetBtn.disabled = false;
    this.dom.endBtn.disabled = !(isTracking || isPaused);

    if (isTracking) {
      this.dom.startBtn.innerHTML = '<div class="pause-icon"><div class="pause-bar"></div><div class="pause-bar"></div></div>';
      this.dom.startBtn.title = 'Pause';
    } else if (isPaused) {
      this.dom.startBtn.textContent = '▶';
      this.dom.startBtn.title = 'Resume';
    } else {
      this.dom.startBtn.textContent = '▶';
      this.dom.startBtn.title = 'Start';
    }
  }

  renderGyroCompass() {
    const { n, s, e, w } = this.motionData.extremaG;
    this.dom.gyroN.textContent = `${n.toFixed(2)}g`;
    this.dom.gyroS.textContent = `${s.toFixed(2)}g`;
    this.dom.gyroE.textContent = `${e.toFixed(2)}g`;
    this.dom.gyroW.textContent = `${w.toFixed(2)}g`;
  }

  getSpeedColor(speedKmh) {
    const clamped = Math.max(0, Math.min(300, speedKmh || 0));
    const hue = 205 - (clamped / 300) * 205;
    return `hsl(${hue}, 95%, 62%)`;
  }

  renderSpeedRing(speedKmh, speedColor) {
    if (!this.dom.speedProgress) return;
    const clamped = Math.max(0, Math.min(300, speedKmh));
    const deg = (clamped / 300) * 360;
    this.dom.speedProgress.style.background = `conic-gradient(from 0deg, ${speedColor} 0deg, ${speedColor} ${deg}deg, #1a1a1a ${deg}deg, #1a1a1a 360deg)`;
  }

  renderTimingCards() {
    this.renderDisabledTimingCard(this.dom.timing0to100Card, this.dom.timing0to100Value);
    this.renderTimingCard(this.dom.timing50to120Card, this.dom.timing50to120Value, TIMING_MODES.FIFTY_TO_120, this.bestTimes.fiftyTo120);
    this.renderDisabledTimingCard(this.dom.timingQuarterCard, this.dom.timingQuarterValue);
  }

  renderDisabledTimingCard(card, valueEl) {
    if (!card || !valueEl) return;
    card.classList.remove('timing-ready', 'timing-tracking', 'timing-better', 'timing-worse');
    valueEl.innerHTML = '-- <span class="unit">s</span>';
  }

  renderTimingCard(card, valueEl, mode, bestFallback) {
    if (!card || !valueEl) return;

    card.classList.remove('timing-ready', 'timing-tracking');

    const state = this.timingState[mode];
    if (state.phase === 'ready') {
      card.classList.add('timing-ready');
      valueEl.innerHTML = 'Ready <span class="unit">s</span>';
      return;
    }

    if (state.phase === 'tracking') {
      card.classList.add('timing-tracking');
      const running = Math.max(0, (Date.now() - state.startedAtMs) / 1000);
      valueEl.innerHTML = `${running.toFixed(2)} <span class="unit">s</span>`;
      return;
    }

    const best = Number.isFinite(state.bestSeconds) ? state.bestSeconds : bestFallback;
    valueEl.innerHTML = Number.isFinite(best)
      ? `${best.toFixed(2)} <span class="unit">s</span>`
      : '-- <span class="unit">s</span>';
  }
}

const app = new SpeedometerApp();
window.app = app;
