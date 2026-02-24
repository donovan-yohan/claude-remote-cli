export type TabId = 'repos' | 'worktrees';

const SIDEBAR_WIDTH_KEY = 'claude-remote-sidebar-width';
const SIDEBAR_COLLAPSED_KEY = 'claude-remote-sidebar-collapsed';
export const DEFAULT_SIDEBAR_WIDTH = 240;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 500;
export const COLLAPSED_SIDEBAR_WIDTH = 44;

function loadSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) {
      const val = parseInt(stored, 10);
      if (val >= MIN_SIDEBAR_WIDTH && val <= MAX_SIDEBAR_WIDTH) return val;
    }
  } catch { /* localStorage unavailable */ }
  return DEFAULT_SIDEBAR_WIDTH;
}

function loadSidebarCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'; }
  catch { return false; }
}

let sidebarOpen = $state(false);
let sidebarWidth = $state(loadSidebarWidth());
let sidebarCollapsed = $state(loadSidebarCollapsed());
let activeTab = $state<TabId>('repos');
let rootFilter = $state('');
let repoFilter = $state('');
let searchFilter = $state('');

export function getUi() {
  return {
    get sidebarOpen() { return sidebarOpen; },
    set sidebarOpen(v: boolean) { sidebarOpen = v; },
    get sidebarWidth() { return sidebarWidth; },
    set sidebarWidth(v: number) { sidebarWidth = v; },
    get sidebarCollapsed() { return sidebarCollapsed; },
    set sidebarCollapsed(v: boolean) { sidebarCollapsed = v; },
    get activeTab() { return activeTab; },
    set activeTab(v: TabId) { activeTab = v; },
    get rootFilter() { return rootFilter; },
    set rootFilter(v: string) { rootFilter = v; },
    get repoFilter() { return repoFilter; },
    set repoFilter(v: string) { repoFilter = v; },
    get searchFilter() { return searchFilter; },
    set searchFilter(v: string) { searchFilter = v; },
  };
}

export function openSidebar(): void { sidebarOpen = true; }
export function closeSidebar(): void { sidebarOpen = false; }
export function saveSidebarWidth(): void {
  try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)); }
  catch { /* localStorage unavailable */ }
}
export function toggleSidebarCollapsed(): void {
  sidebarCollapsed = !sidebarCollapsed;
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed)); }
  catch { /* localStorage unavailable */ }
}
