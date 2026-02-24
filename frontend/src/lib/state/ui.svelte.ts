export type TabId = 'repos' | 'worktrees';

let sidebarOpen = $state(false);
let activeTab = $state<TabId>('repos');
let rootFilter = $state('');
let repoFilter = $state('');
let searchFilter = $state('');

export function getUi() {
  return {
    get sidebarOpen() { return sidebarOpen; },
    set sidebarOpen(v: boolean) { sidebarOpen = v; },
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
