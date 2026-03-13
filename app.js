/**
 * Accordion Kinetic — Phase 6: Final Wiring
 * Integrates Motion Sensors, AMSynth Engine, and Touch UI.
 */

let synth = null;
let activeNote = null;
let bellowsSpeed = 0.5; // Starts at 0.5 so manual clicking still produces sound
let smoothed = 0.5;

// Kick everything off from the mandatory start button tap
document.getElementById('start-btn').addEventListener('click', async () => {
    try {
        await Tone.start();
        initAudio();
        setupKeys();

        // Attempt to request sensors, but don't block the app if they fail or are on HTTP
        try {
            await requestSensors();
        } catch (sensorErr) {
            console.warn("Sensor request failed (HTTPS required or hardware missing).", sensorErr);
        }

        // Hide overlay
        document.getElementById('permission-screen').style.display = 'none';
        document.querySelector('.status-indicator').textContent = 'SYSTEM ACTIVE';

        // Initial visual update so the fallback volume is reflected
        updateVisuals(bellowsSpeed);
    } catch (err) {
        console.error("Audio Initialization failed:", err);
        alert("Audio initialization failed. Ensure you have interacted with the document.");
    }
});

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
async function requestSensors() {
    // iOS 13+ requires explicit permission request
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const permission = await DeviceMotionEvent.requestPermission();
        if (permission !== 'granted') {
            alert('Motion permission denied — tilt controls won\'t work.');
            return;
        }
    }
    window.addEventListener('devicemotion', onMotion);
}

function onMotion(e) {
    const accel = e.accelerationIncludingGravity;
    if (!accel || accel.y === null) return;

    // Combine X and Y axes so the motion detects tilting regardless
    // of whether the phone is held in portrait or landscape mathematically.
    const magnitude = Math.sqrt((accel.x * accel.x) + (accel.y * accel.y));
    const raw = Math.min(magnitude / 9.8, 1.0);

    // Exponential smoothing (Low-pass filter)
    smoothed = 0.3 * raw + 0.7 * smoothed;
    bellowsSpeed = Math.min(smoothed, 1.0);

    updateVisuals(bellowsSpeed);

    // If a note is playing, update its volume live
    if (activeNote) {
        setVolume(bellowsSpeed);
    }
}
