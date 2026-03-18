/**
 * Accordion Kinetic
 * Phases: Calibration → Audio → Keys → Sensors → Push/Pull timbre
 */

// ─── STATE ────────────────────────────────────────────────────────────────────
let synth        = null;
let bellowsSpeed = 0;
let smoothed     = 0;
let isStarted    = false;

// Calibration baseline
let baseline     = { beta: null, gamma: null };
let isCalibrated = false;

// Push/pull direction tracking
let bellowsDirection = 'neutral'; // 'push' | 'pull' | 'neutral'
let lastCombinedTilt = null;

// Stability detection for calibration ring
let stabilityReadings = [];
const STABILITY_WINDOW  = 12;   // number of readings to average
const STABILITY_THRESH  = 0.8;  // max variance to be considered "still"

// Active keys (multi-touch chords)
const activeKeys = new Set();

// Wake lock reference
let wakeLock = null;

// ─── BOOT: Start button ───────────────────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', () => {
  requestPermissionsAndStart();
});

async function requestPermissionsAndStart() {
  let sensorGranted = false;

  // iOS 13+ DeviceOrientation permission — must be synchronous to click
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      sensorGranted = res === 'granted';
    } catch (err) {
      console.error('Orientation permission failed', err);
    }
  } else {
    sensorGranted = true;
  }

  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    try { await DeviceMotionEvent.requestPermission(); } catch (_) {}
  }

  try {
    await Tone.start();
    initAudio();
    setupKeys();
    isStarted = true;

    if (sensorGranted) {
      // Begin listening — calibration happens inside onOrientation
      window.addEventListener('deviceorientation', onOrientationCalibrate);
    }

    // Acquire wake lock so screen doesn't sleep mid-play
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) {}

    // Show play UI, hide permission screen
    document.getElementById('permission-screen').style.display = 'none';
    document.getElementById('play-ui').style.display = 'flex';
    updateVisuals(0);

  } catch (err) {
    console.error('Init failed:', err);
    alert('Audio init failed. Make sure volume is up and try again.');
  }
}

// ─── CALIBRATION ─────────────────────────────────────────────────────────────
// Listens for stable readings, fills the ring, then captures baseline.
function onOrientationCalibrate(e) {
  if (e.beta === null || e.gamma === null) return;

  stabilityReadings.push({ beta: e.beta, gamma: e.gamma });
  if (stabilityReadings.length > STABILITY_WINDOW) {
    stabilityReadings.shift();
  }

  const progress = stabilityReadings.length / STABILITY_WINDOW;
  updateStabilityRing(progress);

  if (stabilityReadings.length < STABILITY_WINDOW) return;

  // Calculate variance of recent readings
  const betas  = stabilityReadings.map(r => r.beta);
  const gammas = stabilityReadings.map(r => r.gamma);
  const variance = getVariance(betas) + getVariance(gammas);

  if (variance < STABILITY_THRESH) {
    // Phone is steady — lock in the baseline
    baseline.beta  = average(betas);
    baseline.gamma = average(gammas);
    lastCombinedTilt = Math.abs(baseline.beta) + Math.abs(baseline.gamma);
    isCalibrated = true;

    // Swap to the live orientation handler
    window.removeEventListener('deviceorientation', onOrientationCalibrate);
    window.addEventListener('deviceorientation', onOrientation);

    updateStabilityRing(1, true); // fill ring fully, show LOCKED
  }
}

function updateStabilityRing(progress, locked = false) {
  const circumference = 2 * Math.PI * 42; // r=42
  const arc = document.getElementById('stability-arc');
  const label = document.getElementById('stability-label');
  if (!arc || !label) return;
  arc.setAttribute('stroke-dasharray', `${progress * circumference} ${circumference}`);
  if (locked) label.textContent = 'LOCKED';
}

// Recalibrate button — resets baseline from current position
document.getElementById('recalibrate-btn').addEventListener('click', () => {
  isCalibrated = false;
  stabilityReadings = [];
  window.removeEventListener('deviceorientation', onOrientation);
  window.addEventListener('deviceorientation', onOrientationCalibrate);
});

// Hide recalibrate button while notes are playing
function updateRecalibrateVisibility() {
  const btn = document.getElementById('recalibrate-btn');
  if (activeKeys.size > 0) {
    btn.classList.add('hidden');
  } else {
    btn.classList.remove('hidden');
  }
}

// ─── LIVE SENSOR HANDLER ──────────────────────────────────────────────────────
function onOrientation(e) {
  if (!isCalibrated || e.beta === null || e.gamma === null) return;

  // Delta from calibrated baseline
  const deltaBeta  = e.beta  - baseline.beta;
  const deltaGamma = e.gamma - baseline.gamma;

  // Combined tilt magnitude from baseline
  const combinedTilt = Math.abs(deltaBeta) + Math.abs(deltaGamma);

  // ── PUSH / PULL DIRECTION ──────────────────────────────────────────────────
  // Positive delta = tilting toward you (push), negative = away (pull)
  if (lastCombinedTilt !== null) {
    const tiltDelta = combinedTilt - lastCombinedTilt;
    if (Math.abs(tiltDelta) > 0.3) { // dead zone
      bellowsDirection = tiltDelta > 0 ? 'push' : 'pull';
    }
    updateBellowsTimbre(bellowsDirection);
  }
  lastCombinedTilt = combinedTilt;

  // ── VOLUME via tilt speed (shaking / pumping effort) ──────────────────────
  const magnitude = Math.min(combinedTilt / 45, 1.0); // 45° = full volume
  const DEAD_ZONE = 0.04;
  const raw = magnitude < DEAD_ZONE ? 0 : magnitude;

  // Exponential smoothing — slightly faster attack, slower decay
  smoothed = 0.35 * raw + 0.65 * smoothed;
  bellowsSpeed = Math.min(smoothed, 1.0);

  updateVisuals(bellowsSpeed);

  if (activeKeys.size > 0) {
    setVolume(bellowsSpeed);
  }
}

// ─── AUDIO ENGINE ─────────────────────────────────────────────────────────────
// Two filter states for push/pull timbre switching
let highpassFilter = null;
let lowpassFilter  = null;
let currentTimbre  = 'neutral';

function initAudio() {
  const eq = new Tone.EQ3({ low: 15, mid: 2, high: 4 }).toDestination();
  const compressor = new Tone.Compressor(-15, 6).connect(eq);
  const chorus = new Tone.Chorus(4, 2.5, 0.5).connect(compressor).start();
  const reverb = new Tone.Reverb({ decay: 2.5, preDelay: 0.1, wet: 0.4 }).connect(chorus);

  // Highpass — used for PUSH (brighter)
  highpassFilter = new Tone.Filter(400, 'highpass').connect(reverb);
  highpassFilter.rolloff = -12;

  // Lowpass — used for PULL (warmer)
  lowpassFilter = new Tone.Filter(1200, 'lowpass').connect(reverb);
  lowpassFilter.rolloff = -12;

  // PolySynth — French Musette accordion character
  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 25 },
    envelope:   { attack: 0.05, decay: 0.2, sustain: 0.9, release: 0.4 }
  }).connect(lowpassFilter); // start connected to lowpass (warm/neutral)

  synth.volume.value = -40;
}

function updateBellowsTimbre(direction) {
  if (direction === currentTimbre || !synth) return;
  currentTimbre = direction;

  const bellowsEl = document.getElementById('bellows-inner');

  if (direction === 'push') {
    // Reconnect synth to highpass for brighter tone
    synth.disconnect();
    synth.connect(highpassFilter);
    bellowsEl.classList.remove('pull');
    bellowsEl.classList.add('push');
  } else if (direction === 'pull') {
    // Reconnect synth to lowpass for warmer tone
    synth.disconnect();
    synth.connect(lowpassFilter);
    bellowsEl.classList.remove('push');
    bellowsEl.classList.add('pull');
  }
}

function getHarmonicChord(baseNote) {
  const freq = Tone.Frequency(baseNote);
  return [
    freq.transpose(-12).toNote(), // sub octave
    baseNote,                     // root
    freq.transpose(7).toNote()    // perfect fifth
  ];
}

function playNote(note) {
  if (!synth) return;
  const chord = getHarmonicChord(note);
  synth.triggerAttack(chord);
  setVolume(bellowsSpeed);
}

function stopNote(note) {
  if (!synth) return;
  const chord = getHarmonicChord(note);
  synth.triggerRelease(chord);
}

function setVolume(speed) {
  if (!synth) return;
  const db = -35 + speed * 40;
  synth.volume.rampTo(db, 0.05);
}

// ─── VISUALS ──────────────────────────────────────────────────────────────────
function updateVisuals(speed) {
  const scale = 0.3 + speed * 0.7;
  document.getElementById('bellows-inner').style.transform = `scaleY(${scale})`;
  document.getElementById('meter-fill').style.width = `${speed * 100}%`;
}

// ─── KEYS & MULTI-TOUCH ───────────────────────────────────────────────────────
function setupKeys() {
  const container = document.getElementById('keys-container');

  container.addEventListener('touchstart',  handleTouch, { passive: false });
  container.addEventListener('touchmove',   handleTouch, { passive: false });
  container.addEventListener('touchend',    handleTouchEnd, { passive: false });
  container.addEventListener('touchcancel', handleTouchEnd, { passive: false });

  document.querySelectorAll('.key').forEach(key => {
    key.addEventListener('mousedown',  () => triggerKey(key));
    key.addEventListener('mouseenter', e => { if (e.buttons > 0) triggerKey(key); });
    key.addEventListener('mouseleave', () => releaseKey(key));
    key.addEventListener('mouseup',    () => releaseKey(key));
  });
}

function handleTouch(e) {
  e.preventDefault();
  const currentTouches = new Set();

  for (let i = 0; i < e.touches.length; i++) {
    const t   = e.touches[i];
    const el  = document.elementFromPoint(t.clientX, t.clientY);
    if (el && el.classList.contains('key')) {
      currentTouches.add(el);
      triggerKey(el);
    }
  }

  // Release any key no longer being touched
  activeKeys.forEach(key => {
    if (!currentTouches.has(key)) releaseKey(key);
  });
}

function handleTouchEnd(e) {
  e.preventDefault();
  if (e.touches.length === 0) {
    activeKeys.forEach(key => releaseKey(key));
  } else {
    handleTouch(e);
  }
}

function triggerKey(key) {
  if (activeKeys.has(key)) return;
  activeKeys.add(key);
  key.classList.add('playing');
  playNote(key.dataset.note);
  updateRecalibrateVisibility();
}

function releaseKey(key) {
  if (!activeKeys.has(key)) return;
  activeKeys.delete(key);
  key.classList.remove('playing');
  stopNote(key.dataset.note);
  updateRecalibrateVisibility();
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function getVariance(arr) {
  const avg = average(arr);
  return average(arr.map(v => (v - avg) ** 2));
}