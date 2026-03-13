import * as api from '../api.js';

export const configState = $state({
  defaultContinue: true,
  defaultYolo: false,
  launchInTmux: false,
  defaultAgent: 'claude',
  defaultNotifications: true,
});

export function getConfigState() {
  return configState;
}

export async function refreshConfig(): Promise<void> {
  const [cont, yolo, tmux, agent, notif] = await Promise.all([
    api.fetchDefaultContinue().catch(() => configState.defaultContinue),
    api.fetchDefaultYolo().catch(() => configState.defaultYolo),
    api.fetchLaunchInTmux().catch(() => configState.launchInTmux),
    api.fetchDefaultAgent().catch(() => configState.defaultAgent),
    api.fetchDefaultNotifications().catch(() => configState.defaultNotifications),
  ]);
  configState.defaultContinue = cont;
  configState.defaultYolo = yolo;
  configState.launchInTmux = tmux;
  configState.defaultAgent = agent;
  configState.defaultNotifications = notif;
}
