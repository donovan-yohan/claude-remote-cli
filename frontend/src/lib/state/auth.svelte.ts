import { authenticate as apiAuth, checkAuth } from '../api.js';

let authenticated = $state(false);
let pinError = $state<string | null>(null);
let checking = $state(true);

export function getAuth() {
  return {
    get authenticated() { return authenticated; },
    get pinError() { return pinError; },
    get checking() { return checking; },
  };
}

export async function checkExistingAuth(): Promise<void> {
  checking = true;
  try {
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
