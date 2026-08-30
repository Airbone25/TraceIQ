import { cloudClient } from './cloud-client.js';

// Active cloud session for this app instance. A desktop install serves one
// signed-in user at a time, so a single module-level token covers both
// foreground requests (set by requireAuth) and background agent jobs that
// persist to the cloud on the user's behalf.

let activeToken = null;

export function setActiveToken(token) {
  activeToken = token || null;
}

export function getActiveToken() {
  return activeToken;
}

export function clearActiveToken() {
  activeToken = null;
}

// A cloud client bound to the current active token. Calling an authenticated
// method when no user is signed in throws immediately.
export function cloudSession() {
  if (!activeToken) {
    throw new Error('Not signed in');
  }
  return cloudClient.forToken(activeToken);
}

export function cloudSessionToken() {
  return activeToken;
}
