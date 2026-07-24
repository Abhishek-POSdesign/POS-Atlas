/**
 * Theme Switcher Component
 * A single compact cycling button: Dark -> Auto -> Light -> Dark
 */

import { getTheme, setTheme } from '../theme.js';

export function themeSwitcher() {
    return {
        current: getTheme(),
        
        cycle() {
            if (this.current === 'dark') {
                this.set('auto');
            } else if (this.current === 'auto') {
                this.set('light');
            } else {
                this.set('dark');
            }
        },
        
        set(theme) {
            this.current = theme;
            setTheme(theme);
        },
        
        get icon() {
            // Placeholder SVG paths depending on state
            if (this.current === 'dark') {
                return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
            } else if (this.current === 'light') {
                return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
            } else {
                // Auto (OS)
                return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`;
            }
        },
        
        init() {
            // Listen for changes from other tabs/windows
            window.addEventListener('atlas-theme-changed', (e) => {
                this.current = e.detail.theme;
            });
        }
    };
}
