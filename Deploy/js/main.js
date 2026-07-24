import { themeSwitcher } from './components/theme-switcher.js';

// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(err => {
            console.error('ServiceWorker registration failed: ', err);
        });
    });
}

// Setup Alpine
document.addEventListener('alpine:init', () => {
    // Register components
    Alpine.data('themeSwitcher', themeSwitcher);
    
    // Main App Data
    Alpine.data('app', () => ({
        init() {
            console.log('Atlas initialized.');
        }
    }));
});
