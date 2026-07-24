/**
 * Theme logic: Auto (OS-based), Light, Dark
 */

const THEME_STORAGE_KEY = 'atlas-theme';

export function initTheme() {
    // Determine stored or default theme
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const initialTheme = storedTheme || 'auto';
    
    // Apply theme to HTML tag
    document.documentElement.setAttribute('data-theme', initialTheme);
}

export function setTheme(theme) {
    if (!['auto', 'light', 'dark'].includes(theme)) return;
    
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    
    // Dispatch event so components can update if needed
    window.dispatchEvent(new CustomEvent('atlas-theme-changed', { detail: { theme } }));
}

export function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'auto';
}
