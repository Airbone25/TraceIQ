// In-memory registry mapping a local user id to the cloud JWT it authenticated
// with, so background agent jobs can persist progress to the cloud API on the
// user's behalf (the renderer's token lives in localStorage and is only sent on
// foreground requests). Volatile: repopulated on each authenticated request.
const byUserId = new Map();

export function setAuthToken(userId, token) {
  if (userId && token) byUserId.set(String(userId), token);
}

export function getAuthToken(userId) {
  return userId ? byUserId.get(String(userId)) || null : null;
}

export function clearAuthToken(userId) {
  if (userId) byUserId.delete(String(userId));
}

export function clearAllAuthTokens() {
  byUserId.clear();
}

export const authTokenCount = () => byUserId.size;
