/**
 * Accordion Kinetic — Phase 6: Final Wiring
 * Integrates Motion Sensors, AMSynth Engine, and Touch UI.
 */

let synth = null;
let activeNote = null;
let bellowsSpeed = 0.5; // Starts at 0.5 so manual clicking still produces sound
let smoothed = 0.5;

// Kick everything off from the mandatory start button tap
document.getElementById('start-btn').addEventListener('click', () => {
    // 1. iOS requires permission requests to be SYNCHRONOUS to the click event.
    // If we await Tone.start() first, Safari drops the user-gesture context.
    requestPermissionsAndStart();
});

async function requestPermissionsAndStart() {
    let sensorGranted = false;

    // Check for iOS 13+ permission API
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission === 'granted') {
                sensorGranted = true;
            } else {
                alert('Permission denied. Please allow motion sensors to use the accordion effect.');
            }
        } catch (err) {
            console.error("Permission request failed", err);
            alert("HTTPS is required for motion sensors. Are you accessing via localhost or HTTP?");
        }
    } else {
        // Non-iOS 13+ devices
        sensorGranted = true;
    }

    try {
        // Initialize Audio after permissions
        await Tone.start();
        initAudio();
        setupKeys();

        if (sensorGranted) {
            window.addEventListener('deviceorientation', onOrientation);
            document.querySelector('.status-indicator').textContent = 'SYSTEM ACTIVE — SHAKE DEVICE';
        } else {
            console.warn("Sensor request failed or denied. Defaulting to fixed volume.");
            document.querySelector('.status-indicator').textContent = 'SYSTEM ACTIVE — SENSORS UNAVAILABLE';
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
 * 1. Audio Engine (AMSynth)
 */
function initAudio() {
    synth = new Tone.AMSynth({
        oscillator: { type: 'sawtooth' },
        envelope: {
            attack: 0.02,
            decay: 0.1,
            sustain: 0.9,
            release: 0.3
        },
        volume: -40
    }).toDestination();
}

function playNote(note) {
    if (!synth) return;
    activeNote = note;
    synth.triggerAttack(note);
    setVolume(bellowsSpeed);
}

function stopNote(note) {
    if (!synth) return;
    synth.triggerRelease(note);
}

function setVolume(speed) {
    if (!synth) return;
    // Convert 0–1 speed to decibels: -40db (silent) to -5db (loud)
    const db = -40 + speed * 35;
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
    const keysContainer = document.getElementById('keys');

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

function onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;

    // In our forced landscape setup, beta represents the tilting motion
    // we want to track (tilting the phone back/forward relative to the user).

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
