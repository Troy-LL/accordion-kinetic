/**
 * Accordion Kinetic Logic
 * Handles interaction, motion sensors, and physics-based feedback.
 */

document.addEventListener('DOMContentLoaded', () => {
    initAccordion();
    initSensors();
});

/**
 * Basic Accordion Interaction
 */
function initAccordion() {
    const items = document.querySelectorAll('.accordion-item');
    
    items.forEach(item => {
        const trigger = item.querySelector('.accordion-trigger');
        
        trigger.addEventListener('click', () => {
            const isActive = item.classList.contains('active');
            
            // Close all others
            items.forEach(i => i.classList.remove('active'));
            
            // Toggle current
            if (!isActive) {
                item.classList.add('active');
            }
        });
    });
}

/**
 * Motion Sensor Integration
 */
function initSensors() {
    const btnPermission = document.getElementById('request-permission');
    const alphaDisp = document.getElementById('val-alpha');
    const betaDisp = document.getElementById('val-beta');
    const gammaDisp = document.getElementById('val-gamma');
    const container = document.querySelector('.app-container');

    // Handle sensor data
    const handleOrientation = (event) => {
        const { alpha, beta, gamma } = event;
        
        // Update Displays
        alphaDisp.textContent = alpha ? alpha.toFixed(2) : '0.00';
        betaDisp.textContent = beta ? beta.toFixed(2) : '0.00';
        gammaDisp.textContent = gamma ? gamma.toFixed(2) : '0.00';

        // Kinetic Effect: Tilt the active panel or container slightly
        // Beta is front-back (approx -180 to 180)
        // Gamma is left-right (approx -90 to 90)
        
        const tiltX = (beta / 10).toFixed(2);
        const tiltY = (gamma / 10).toFixed(2);
        
        const activeItem = document.querySelector('.accordion-item.active');
        if (activeItem) {
            activeItem.style.transform = `perspective(1000px) rotateX(${-tiltX}deg) rotateY(${tiltY}deg)`;
        }
    };

    // Permission request logic for iOS
    btnPermission.addEventListener('click', async () => {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permissionState = await DeviceOrientationEvent.requestPermission();
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation);
                    btnPermission.textContent = "SENSORS ACTIVE";
                    btnPermission.style.opacity = "0.5";
                } else {
                    alert('Sensor access denied.');
                }
            } catch (error) {
                console.error('Permission error:', error);
                alert('Sensor request failed. Ensure you are on HTTPS.');
            }
        } else {
            // Non-iOS or older browser
            window.addEventListener('deviceorientation', handleOrientation);
            btnPermission.textContent = "SENSORS ACTIVE";
            btnPermission.style.opacity = "0.5";
        }
    });
}
