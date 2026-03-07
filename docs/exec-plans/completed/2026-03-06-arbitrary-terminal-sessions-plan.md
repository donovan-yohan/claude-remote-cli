# Execution Plan: Arbitrary Terminal Sessions

## Steps

### 1. Backend type changes
- [ ] Add `'terminal'` to `SessionType` in `server/types.ts`
- [ ] Add terminal counter in `server/sessions.ts`

### 2. Backend endpoint
- [ ] Add `POST /sessions/terminal` endpoint in `server/index.ts`

### 3. Frontend type changes
- [ ] Add `'terminal'` to `SessionSummary.type` in `frontend/src/lib/types.ts`
- [ ] Add `'terminals'` to `TabId` in `frontend/src/lib/state/ui.svelte.ts`
- [ ] Add `createTerminalSession()` in `frontend/src/lib/api.ts`

### 4. Frontend UI
- [ ] Add Terminals tab in `SessionList.svelte` with "+" button and terminal list
- [ ] Update `SessionItem.svelte` to handle terminal sessions (shell icon, no agent badge)
- [ ] Hide root/repo filters on Terminals tab in `SessionFilters.svelte`
- [ ] Filter terminal sessions from attention tracking in `sessions.svelte.ts`

### 5. Build & test
- [ ] Run `npm run build` and fix any type errors
- [ ] Run `npm test` and verify existing tests pass

### 6. Commit
- [ ] Commit all changes
