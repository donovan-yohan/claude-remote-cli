import * as api from '../api.js';

let defaultContinue = $state(true);
let defaultYolo = $state(false);
let launchInTmux = $state(false);
let defaultAgent = $state('claude');

export function getConfigState() {
  return {
    get defaultContinue() { return defaultContinue; },
    set defaultContinue(v: boolean) { defaultContinue = v; },
    get defaultYolo() { return defaultYolo; },
    set defaultYolo(v: boolean) { defaultYolo = v; },
    get launchInTmux() { return launchInTmux; },
    set launchInTmux(v: boolean) { launchInTmux = v; },
    get defaultAgent() { return defaultAgent; },
    set defaultAgent(v: string) { defaultAgent = v; },
  };
}

export async function refreshConfig(): Promise<void> {
  try {
    const [cont, yolo, tmux, agent] = await Promise.all([
      api.fetchDefaultContinue().catch(() => true),
      api.fetchDefaultYolo().catch(() => false),
      api.fetchLaunchInTmux().catch(() => false),
      api.fetchDefaultAgent().catch(() => 'claude'),
    ]);
    defaultContinue = cont;
    defaultYolo = yolo;
    launchInTmux = tmux;
    defaultAgent = agent;
  } catch { /* use current values */ }
}
