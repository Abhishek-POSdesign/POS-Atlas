// auth.js
// Single owner of the auth session. Nothing else touches supabase.auth.

import { supabase } from './supabase-client.js';

let currentSession = null;
const listeners = new Set();

supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    for (const fn of listeners) fn(currentSession);
});

export async function initAuth() {
    const { data } = await supabase.auth.getSession();
    currentSession = data.session;
    return currentSession;
}

export function getSession() {
    return currentSession;
}

export function isAuthenticated() {
    return currentSession !== null;
}

export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    currentSession = data.session;
    return { ok: true };
}

export async function signOut() {
    await supabase.auth.signOut();
    currentSession = null;
}

// Call to be notified whenever the session changes (sign-in, sign-out, token refresh).
export function onSessionChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
