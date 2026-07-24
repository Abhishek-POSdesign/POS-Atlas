// auth.js
// Single owner of profile identity.

import { CONFIG } from './config.js';

let currentProfileId = null;

export function getProfileId() {
    return currentProfileId;
}

export function setProfileId(id) {
    currentProfileId = id;
}

export function isAuthenticated() {
    return currentProfileId !== null;
}
