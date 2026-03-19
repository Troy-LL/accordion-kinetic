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
let chordTimer       = null;    // the 30ms debounce timer
let pendingNotes     = new Set(); // notes waiting to be voiced
let activeVoicing    = [];      // currently triggered notes in Tone.js
let currentChordType = 'none';

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
    const detail = err && err.message ? `\n\nDetails: ${err.message}` : '';
    alert('Audio init failed. Make sure volume is up and try again.' + detail);
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
  pendingNotes.clear();
  activeVoicing = [];
  currentChordType = 'none';
  if (chordTimer) {
    clearTimeout(chordTimer);
    chordTimer = null;
  }
  if (activeKeys.size > 0) {
    activeKeys.forEach(key => key.classList.remove('playing'));
    activeKeys.clear();
  }
  if (synth) synth.releaseAll();
  window.removeEventListener('deviceorientation', onOrientation);
  window.addEventListener('deviceorientation', onOrientationCalibrate);
  updateRecalibrateVisibility();
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

// Release everything if the tab loses visibility (prevents hanging notes).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;

  if (chordTimer) {
    clearTimeout(chordTimer);
    chordTimer = null;
  }

  pendingNotes.clear();
  activeVoicing = [];
  currentChordType = 'none';

  if (activeKeys.size > 0) {
    activeKeys.forEach(key => key.classList.remove('playing'));
    activeKeys.clear();
  }

  if (synth) synth.releaseAll();
  updateRecalibrateVisibility();
});

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
    updateTimbre(bellowsDirection, currentChordType);
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
let pushGain       = null; // crossfade gain: push path
let pullGain       = null; // crossfade gain: pull path
let reverb         = null; // reused for chord-aware wetness
let reverbWetBase  = 0.4;
let currentTimbre  = 'pull';

function initAudio() {
  const eq = new Tone.EQ3({ low: 15, mid: 2, high: 4 }).toDestination();
  const compressor = new Tone.Compressor(-15, 6).connect(eq);
  const chorus = new Tone.Chorus(4, 2.5, 0.5).connect(compressor).start();

  reverb = new Tone.Reverb({ decay: 2.5, preDelay: 0.1, wet: 0.4 });
  reverb.connect(chorus);
  reverbWetBase = 0.4;

  // Highpass — used for PUSH (bright), chord-dependent cutoff
  highpassFilter = new Tone.Filter(400, 'highpass');
  highpassFilter.rolloff = -12;
  highpassFilter.connect(reverb);

  // Lowpass — used for PULL (warm), chord-dependent cutoff
  lowpassFilter = new Tone.Filter(1200, 'lowpass');
  lowpassFilter.rolloff = -12;
  lowpassFilter.connect(reverb);

  // Crossfade between push/pull paths to avoid clicks.
  pushGain = new Tone.Gain(0);
  pullGain = new Tone.Gain(1);
  pushGain.connect(highpassFilter);
  pullGain.connect(lowpassFilter);

  // PolySynth — French Musette accordion character
  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 25 },
    envelope:   { attack: 0.05, decay: 0.2, sustain: 0.9, release: 0.4 }
  });
  synth.connect(pushGain);
  synth.connect(pullGain);
  synth.maxPolyphony = 16; // 3 keys × up to 5 voiced notes + headroom

  synth.volume.value = -40;
}

function getChordTimbreParams(chordType) {
  // Defaults: treat as "major-ish" open tone.
  const chord = (chordType === 'unknown' || chordType === 'none') ? 'major' : chordType;

  if (chord === 'single') {
    return {
      highpassFreq: 500, // push
      lowpassFreq:  1000, // pull
      detunePushCents: 0,
      reverbWetPullDelta: 0
    };
  }

  if (chord === 'major') {
    return {
      highpassFreq: 400,
      lowpassFreq:  1200,
      detunePushCents: 0,
      reverbWetPullDelta: 0
    };
  }

  if (chord === 'minor') {
    return {
      highpassFreq: 600,
      lowpassFreq:  800,
      detunePushCents: 5,
      reverbWetPullDelta: 0.1
    };
  }

  if (chord === 'power') {
    // "Flat/neutral": effectively no cutoff for the active filter.
    return {
      highpassFreq: 20,   // push: very low cutoff => nearly flat
      lowpassFreq:  20000, // pull: very high cutoff => nearly flat
      detunePushCents: 0,
      reverbWetPullDelta: 0
    };
  }

  if (chord === 'dom7') {
    return {
      highpassFreq: 450,
      lowpassFreq:  1100,
      detunePushCents: 0,
      reverbWetPullDelta: 0
    };
  }

  if (chord === 'min7') {
    return {
      highpassFreq: 550,
      lowpassFreq:  700,
      detunePushCents: 3,
      reverbWetPullDelta: 0.15
    };
  }

  return {
    highpassFreq: 400,
    lowpassFreq:  1200,
    detunePushCents: 0,
    reverbWetPullDelta: 0
  };
}

function rampToneSignal(signal, value, rampSeconds) {
  if (signal && typeof signal.rampTo === 'function') {
    signal.rampTo(value, rampSeconds);
    return true;
  }

  if (signal && typeof signal.value === 'number') {
    signal.value = value;
    return true;
  }

  return false;
}

function rampSynthDetune(detuneCents, rampSeconds) {
  // Tone's exposed shape can vary: prefer rampTo when available.
  if (rampToneSignal(synth?.detune, detuneCents, rampSeconds)) return;
  if (synth && typeof synth.set === 'function') synth.set({ detune: detuneCents });
}

function rampReverbWet(wetValue, rampSeconds) {
  if (rampToneSignal(reverb?.wet, wetValue, rampSeconds)) return;
  if (reverb) {
    try { reverb.wet.value = wetValue; } catch (_) {}
  }
}

function updateTimbre(direction, chordType) {
  if (!synth || !pushGain || !pullGain || !highpassFilter || !lowpassFilter || !reverb) return;

  const bellowsEl = document.getElementById('bellows-inner');
  const rampSeconds = 0.08; // 80ms smooth transition

  const isMinorQuality = chordType === 'minor' || chordType === 'min7';
  if (bellowsEl) {
    bellowsEl.classList.toggle('chord-minor', isMinorQuality);

    // Keep existing behavior: only update the push/pull class when direction is explicit.
    if (direction === 'push' || direction === 'pull') {
      bellowsEl.classList.toggle('push', direction === 'push');
      bellowsEl.classList.toggle('pull', direction === 'pull');
    }
  }

  const audioDirection = (direction === 'push' || direction === 'pull') ? direction : currentTimbre;
  const params = getChordTimbreParams(chordType);

  // Update cutoffs (so a direction reversal mid-note stays musically aligned).
  highpassFilter.frequency.rampTo(params.highpassFreq, rampSeconds);
  lowpassFilter.frequency.rampTo(params.lowpassFreq, rampSeconds);

  // Crossfade between push/pull paths.
  const pushTarget = audioDirection === 'push' ? 1 : 0;
  const pullTarget = audioDirection === 'pull' ? 1 : 0;
  pushGain.gain.rampTo(pushTarget, rampSeconds);
  pullGain.gain.rampTo(pullTarget, rampSeconds);

  // Chord-dependent detune / reverb wetness while the corresponding path is active.
  const detuneTarget = audioDirection === 'push' ? params.detunePushCents : 0;
  rampSynthDetune(detuneTarget, rampSeconds);

  const wetTarget = reverbWetBase + (audioDirection === 'pull' ? params.reverbWetPullDelta : 0);
  rampReverbWet(wetTarget, rampSeconds);

  currentTimbre = audioDirection;
}

function playNote(note) {
  if (!synth) return;
  synth.triggerAttack(note);
  setVolume(bellowsSpeed);
}

function stopNote(note) {
  if (!synth) return;
  synth.triggerRelease(note);
}

function setVolume(speed) {
  if (!synth) return;
  const db = -35 + speed * 40;
  synth.volume.rampTo(db, 0.05);
}

// ─── CHORD RECOGNITION ───────────────────────────────────────────────────────
// Converts note names to MIDI, sorts, computes intervals from root
// Returns: 'major' | 'minor' | 'power' | 'dom7' | 'min7' | 'single' | 'unknown'
function identifyChord(noteNames) {
  if (!Array.isArray(noteNames) || noteNames.length === 0) {
    return 'unknown';
  }

  const midiNotes = noteNames
    .map(toMidi)
    .filter(n => typeof n === 'number')
    .sort((a, b) => a - b);

  if (midiNotes.length === 0) {
    return 'unknown';
  }

  const uniqueNotes = [...new Set(midiNotes)];
  if (uniqueNotes.length === 1) {
    return 'single';
  }

  const root = uniqueNotes[0];
  const intervals = uniqueNotes
    .slice(1)
    .map(n => (n - root + 120) % 12)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort((a, b) => a - b);

  if (intervals.length === 0) {
    return 'single';
  }

  if (arraysEqual(intervals, [7])) return 'power';

  if (arraysEqual(intervals, [4]) || arraysEqual(intervals, [4, 7])) {
    return 'major';
  }

  if (arraysEqual(intervals, [3]) || arraysEqual(intervals, [3, 7])) {
    return 'minor';
  }

  if (arraysEqual(intervals, [4, 7, 10])) return 'dom7';
  if (arraysEqual(intervals, [3, 7, 10])) return 'min7';

  return 'unknown';
}

function toMidi(noteName) {
  if (typeof noteName !== 'string') return null;

  const midi = Tone.Frequency(noteName).toMidi();
  if (!Number.isFinite(midi)) return null;

  return midi;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Takes chord type + root note name → returns array of voiced notes
// e.g. voiceChord('major', 'C4') → ['C3', 'C4', 'E4', 'G4']
function voiceChord(chordType, rootNote) {
  const rootMidi = toMidi(rootNote);
  if (typeof rootMidi !== 'number') {
    return [rootNote];
  }

  const voicingTable = {
    single: [-12, 0, 7],
    power: [-12, 0, 7, 12],
    major: [-12, 0, 4, 7],
    minor: [-12, 0, 3, 7],
    dom7: [-12, 0, 4, 7, 10],
    min7: [-12, 0, 3, 7, 10]
  };

  const intervals = voicingTable[chordType];
  if (!intervals) {
    return [rootNote];
  }

  return intervals
    .map(offset => midiToNote(rootMidi + offset))
    .filter(note => typeof note === 'string');
}

function midiToNote(midi) {
  if (typeof midi !== 'number' || !Number.isFinite(midi)) return null;

  const rounded = Math.round(midi);
  const semitone = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;

  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const letter = names[semitone];
  if (!letter) return null;

  return `${letter}${octave}`;
}

function findLowestNote(noteNames) {
  let lowest = null;
  let lowestMidi = Infinity;

  noteNames.forEach(note => {
    const midi = toMidi(note);
    if (typeof midi === 'number' && midi < lowestMidi) {
      lowestMidi = midi;
      lowest = note;
    }
  });

  return lowest || noteNames[0];
}

function scheduleChordUpdate() {
  if (chordTimer) {
    clearTimeout(chordTimer);
  }
  chordTimer = setTimeout(() => {
    chordTimer = null;
    applyChordVoicing();
  }, 30);
}

function applyChordVoicing() {
  if (!synth || pendingNotes.size === 0) return;

  const noteNames = Array.from(pendingNotes);
  const chordType = identifyChord(noteNames);

  let voicedNotes;
  if (chordType === 'unknown') {
    voicedNotes = noteNames;
  } else {
    const lowest = findLowestNote(noteNames);
    voicedNotes = voiceChord(chordType, lowest);
  }

  if (activeVoicing.length) {
    synth.triggerRelease(activeVoicing);
  }

  synth.triggerAttack(voicedNotes);
  setVolume(bellowsSpeed);

  activeVoicing = voicedNotes;
  currentChordType = chordType;
  updateTimbre(bellowsDirection, chordType);
}

// ─── VISUALS ──────────────────────────────────────────────────────────────────
function updateVisuals(speed) {
  const scale = 0.3 + speed * 0.7;

  const bellowsInner = document.getElementById('bellows-inner');
  if (bellowsInner) {
    bellowsInner.style.transform = `scaleY(${scale})`;
  }

  const meterFill = document.getElementById('meter-fill');
  if (meterFill) {
    meterFill.style.width = `${speed * 100}%`;
  }
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
  pendingNotes.add(key.dataset.note);
  scheduleChordUpdate();
  updateRecalibrateVisibility();
}

function releaseKey(key) {
  if (!activeKeys.has(key)) return;
  activeKeys.delete(key);
  key.classList.remove('playing');
  pendingNotes.delete(key.dataset.note);

  if (pendingNotes.size === 0) {
    if (activeVoicing.length && synth) {
      synth.triggerRelease(activeVoicing);
    }
    activeVoicing = [];
    currentChordType = 'none';
    updateTimbre(bellowsDirection, currentChordType);
    if (chordTimer) {
      clearTimeout(chordTimer);
      chordTimer = null;
    }
  } else {
    scheduleChordUpdate();
  }

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