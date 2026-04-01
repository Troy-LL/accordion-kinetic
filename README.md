# Accordion Kinetic

[![Aesthetic: Premium](https://img.shields.io/badge/Aesthetic-Premium-FF69B4.svg)](#)
[![JS: Vanilla](https://img.shields.io/badge/JS-Vanilla-F7DF1E.svg)](#)
[![Audio: Tone.js](https://img.shields.io/badge/Audio-Tone.js-000000.svg)](#)

A hardware-software integration project that transforms a mobile device into a living musical instrument. By leveraging the onboard **accelerometer** and **gyroscope**, Accordion Kinetic translates physical motion into the expressive "bellows" of an accordion.

This repository serves as my primary hub for mobile hardware experiments, exploring the intersection of web technology and physical interaction.

---

## ✨ Core Features

### 🌪️ Kinetic Bellows System
- **Motion-to-Volume:** The physical speed and magnitude of your tilt directly control the volume (amplitude) of the instrument, mimicking the airflow of a real accordion.
- **Push/Pull Dynamics:** Real-time orientation tracking detects whether you are "pushing" or "pulling" the bellows.
    - **Push:** Triggers a bright, high-passed timbre.
    - **Pull:** Triggers a warm, low-passed timbre with increased reverb.

### 🎹 Intelligent Audio Engine
- **Tone.js Core:** A custom PolySynth stack featuring a **Fatsawtooth** musette character, layered with chorus and spatial reverb.
- **Chord Recognition:** The engine automatically identifies and voices complex chords:
    - `Major` | `Minor` | `Dominant 7th` | `Minor 7th` | `Power Chords`
- **Dynamic Timbre:** The frequency cutoff and detune values shift based on the specific chord type being played, ensuring a rich, harmonically accurate sound.

### 🛠️ Hardware Integration
- **Precision Calibration:** A "Hold Still" calibration phase establishes a baseline for the phone's orientation, accounting for how you naturally hold your device.
- **Wake Lock API:** Prevents the device from sleeping during performance.
- **Multi-Touch Support:** Optimized for landscape-oriented mobile play with responsive touch handling.

---

## 🚀 Getting Started

1. **Launch:** Open the application in a mobile browser (Safari on iOS or Chrome on Android recommended).
2. **Permissions:** Grant access to **Motion & Orientation** sensors when prompted.
3. **Calibrate:** Hold your phone landscape, parallel to the floor, screen facing up. Wait for the ring to lock.
4. **Play:** Use your left thumb to play notes on the keyboard while tilting/pumping the device to "breathe" life into the sound.

## 🛠️ Tech Stack

- **Logic:** Vanilla JavaScript (ES6+)
- **Audio:** [Tone.js](https://tonejs.github.io/)
- **Style:** Modern CSS with glassmorphism and motion-based visual feedback.
- **API:** Web Motion API (Accelerometer/Gyroscope) & Wake Lock API.

---

## 🧪 About the Project
This project was born out of a desire to push the boundaries of what's possible with standard browser APIs. It is more than just a musical app; it is a sandbox for testing sensor latency, recursive smoothing algorithms (exponential moving averages), and the UX of "physicalized" web interfaces.

*Expect more hardware-software experiments to land in this repo.*

---
*Created by [Troy](https://github.com/Troy-LL)*
