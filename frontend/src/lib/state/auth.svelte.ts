import { authenticate as apiAuth, checkAuth, checkAuthStatus, setupPin as apiSetupPin } from '../api.js';

let authenticated = $state(false);
let pinError = $state<string | null>(null);
let checking = $state(true);
let needsSetup = $state(false);

export function getAuth() {
  return {
    get authenticated() { return authenticated; },
    get pinError() { return pinError; },
    get checking() { return checking; },
    get needsSetup() { return needsSetup; },
  };
}

export async function checkExistingAuth(): Promise<void> {
  checking = true;
  try {
    const status = await checkAuthStatus();
    if (!status.hasPIN) {
      needsSetup = true;
      checking = false;
      return;
    }
    needsSetup = false;
    authenticated = await checkAuth();
  } catch {
    authenticated = false;
  } finally {
    checking = false;
  }
}

export async function submitPin(pin: string): Promise<void> {
  pinError = null;
  try {
    await apiAuth(pin);
    authenticated = true;
  } catch (err) {
    pinError = err instanceof Error ? err.message : 'Authentication failed';
  }
}

export async function setupNewPin(pin: string, confirm: string): Promise<void> {
  pinError = null;
  try {
    await apiSetupPin(pin, confirm);
    needsSetup = false;
    authenticated = true;
  } catch (err) {
    pinError = err instanceof Error ? err.message : 'Failed to set PIN';
  }
}
