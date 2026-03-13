/**
 * Accordion Kinetic — Phase 6: Final Wiring
 * Integrates Motion Sensors, AMSynth Engine, and Touch UI.
 */

let synth = null;
let activeNote = null;
let bellowsSpeed = 0.5; // Starts at 0.5 so manual clicking still produces sound
let smoothed = 0.5;
let isStarted = false;  // CRITICAL: Required for orientation events to play audio

// Kick everything off from the mandatory start button tap
document.getElementById('start-btn').addEventListener('click', () => {
    // 1. iOS requires permission requests to be SYNCHRONOUS to the click event.
    // If we await Tone.start() first, Safari drops the user-gesture context.
    requestPermissionsAndStart();
});

async function requestPermissionsAndStart() {
    let sensorGranted = false;

    // Check for iOS 13+ permission API (Orientation)
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission === 'granted') {
                sensorGranted = true;
            }
        } catch (err) {
            console.error("Orientation permission request failed", err);
        }
    } else {
        // Non-iOS 13+ devices
        sensorGranted = true;
    }

    // Also check Motion Event just in case the browser categorizes them differently
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            await DeviceMotionEvent.requestPermission();
        } catch (err) {
            console.error("Motion permission request failed", err);
        }
    }

    try {
        // Initialize Audio after permissions
        await Tone.start();
        initAudio();
        setupKeys();
        isStarted = true;

        if (sensorGranted) {
            window.addEventListener('deviceorientation', onOrientation);
            document.querySelector('.status-indicator').textContent = 'SYSTEM ACTIVE — SHAKE & TILT DEVICE';
        } else {
            console.warn("Sensor request failed or denied. Defaulting to fixed volume.");
            document.querySelector('.status-indicator').textContent = 'SYSTEM ACTIVE — SENSORS UNAVAILABLE';
            alert("Motion Sensors unavailable. Check if your browser blocked the prompt, or if you need to clear website data in Settings to reset the permission prompt.");
        }

        // Hide overlay and setup initial visuals
        document.getElementById('permission-screen').style.display = 'none';
        updateVisuals(bellowsSpeed);

    } catch (err) {
        console.error("Audio Initialization failed:", err);
        alert("Audio initialization failed. Ensure your volume is up.");
    }
}

/**
 * 1. Audio Engine (PolySynth + EQ for Bass)
 */
function initAudio() {
    // 1. Massive bass boost to physically rattle the phone speaker
    const eq = new Tone.EQ3({
        low: 15,   // +15dB on lows (Max bass)
        mid: 2,
        high: 4
    }).toDestination();

    // 2. Thick compressor to glue the bass together without clipping
    const compressor = new Tone.Compressor(-15, 6).connect(eq);

    // 3. Lush Stereo Chorus for that rich, harmonized accordion width
    const chorus = new Tone.Chorus(4, 2.5, 0.5).connect(compressor).start();

    // 4. Algorithmic Reverb to place the instrument in a physical acoustic space
    const reverb = new Tone.Reverb({
        decay: 2.5,
        preDelay: 0.1,
        wet: 0.4
    }).connect(chorus);

    // 5. PolySynth emulates a French Musette accordion
    synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: {
            type: 'fatsawtooth',
            count: 3,        // 3 stacked reeds per note
            spread: 25       // detuned for the classic accordion wobble
        },
        envelope: {
            attack: 0.05,
            decay: 0.2,
            sustain: 0.9,
            release: 0.4
        }
    }).connect(reverb);

    // Start heavily down to prevent initial pops
    synth.volume.value = -40;
}

// Automatically create a massive chord (Sub-bass, Root, Perfect 5th)
function getHarmonicChord(baseNote) {
    const freq = Tone.Frequency(baseNote);
    return [
        freq.transpose(-12).toNote(), // Deep sub octave
        baseNote,                     // Root note
        freq.transpose(7).toNote()    // Harmonizing Perfect Fifth
    ];
}

function playNote(note) {
    if (!synth) return;
    activeNote = note;
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

    // Pushed up the master volume mapping. 
    // Old max was -5dB. New max is +5dB (10dB louder overall)
    const db = -35 + speed * 40;
    synth.volume.rampTo(db, 0.05); // smooth 50ms ramp

    const statusVal = document.getElementById('val-status');
    if (statusVal) statusVal.textContent = speed > 0.1 ? 'RESONATING' : 'IDLE';
}

/**
 * 2. Visual Layer
 */
function updateVisuals(speed) {
    // Bellows scale: 0.3 (collapsed) to 1.0 (fully open)
    const scale = 0.3 + speed * 0.7;
    document.getElementById('bellows-inner').style.transform = `scaleY(${scale})`;

    // Meter fill
    document.getElementById('meter-fill').style.width = `${speed * 100}%`;

    // Numerical display
    const valInt = document.getElementById('val-intensity');
    if (valInt) valInt.textContent = speed.toFixed(2);
}

/**
 * 3. Interaction Layer (Mobile Optimized Glissando)
 */
const activeKeys = new Set();

function setupKeys() {
    const keysContainer = document.getElementById('keys-container');

    // Global Touch Events for Glissando (Sliding)
    keysContainer.addEventListener('touchstart', handleTouch, { passive: false });
    keysContainer.addEventListener('touchmove', handleTouch, { passive: false });
    keysContainer.addEventListener('touchend', handleTouchEnd, { passive: false });
    keysContainer.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    // Desktop events
    document.querySelectorAll('.key').forEach(key => {
        key.addEventListener('mousedown', () => triggerKey(key));
        key.addEventListener('mouseenter', (e) => {
            if (e.buttons > 0) triggerKey(key);
        });
        key.addEventListener('mouseleave', () => releaseKey(key));
        key.addEventListener('mouseup', () => releaseKey(key));
    });
}

function handleTouch(e) {
    e.preventDefault(); // crucial for no-scroll
    const currentTouches = new Set();

    for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        if (el && el.classList.contains('key')) {
            currentTouches.add(el);
            triggerKey(el);
        }
    }

    // Release keys no longer being touched
    activeKeys.forEach(key => {
        if (!currentTouches.has(key)) {
            releaseKey(key);
        }
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

    const valNote = document.getElementById('val-note');
    if (valNote) valNote.textContent = key.dataset.note;
}

function releaseKey(key) {
    if (!activeKeys.has(key)) return;
    activeKeys.delete(key);
    key.classList.remove('playing');
    stopNote(key.dataset.note);

    if (activeKeys.size === 0) {
        activeNote = null;
        const valNote = document.getElementById('val-note');
        if (valNote) valNote.textContent = '—';
    } else {
        const remaining = Array.from(activeKeys)[0];
        const valNote = document.getElementById('val-note');
        if (valNote && remaining) valNote.textContent = remaining.dataset.note;
    }
}

/**
 * 4. Sensor Reading
 */

// Track previous orientation to simulate 'velocity' / effort mapping.
let lastBeta = null;
let lastGamma = null;
let smoothedPitch = 0;

function onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;

    // --- PITCH MAPPING via Absolute Tilt ---
    // In forced landscape, lifting your phone up towards you shifts Gamma or Beta wildly depending on exact holding angle.
    // Combining them gives a robust "tilt off the flat axis" metric.
    const combinedTilt = Math.max(0, Math.min(Math.abs(e.beta) + Math.abs(e.gamma), 90));

    // Map 0-90 tilt to -1200 (low octave) to +1200 (high octave) cents
    const targetPitch = ((combinedTilt / 90) * 2400) - 1200;

    // Smooth the pitch glissando so it sings instead of glitching
    smoothedPitch = 0.2 * targetPitch + 0.8 * smoothedPitch;

    if (synth && isStarted) {
        synth.set({ detune: smoothedPitch });
    }

    // --- VOLUME MAPPING via "Shaking" ---
    if (lastBeta === null) {
        lastBeta = e.beta;
        lastGamma = e.gamma;
        return;
    }

    // Calculate the angular delta (rate of change = "shaking" effort)
    const deltaBeta = Math.abs(e.beta - lastBeta);
    const deltaGamma = Math.abs(e.gamma - lastGamma);

    // Create an intensity scalar from the rotation speed
    // 5 degrees of movement per frame represents very fast movement.
    const magnitude = (deltaBeta + deltaGamma) / 5;
    const raw = Math.min(magnitude, 1.0);

    // Update tracking
    lastBeta = e.beta;
    lastGamma = e.gamma;

    // Exponential smoothing (Low-pass filter but with a slightly faster decay so it 'breathes')
    smoothed = 0.4 * raw + 0.6 * smoothed;
    bellowsSpeed = Math.min(smoothed, 1.0);

    updateVisuals(bellowsSpeed);

    // If a note is playing, update its volume live
    if (activeNote || activeKeys.size > 0) {
        setVolume(bellowsSpeed);
    }
}
