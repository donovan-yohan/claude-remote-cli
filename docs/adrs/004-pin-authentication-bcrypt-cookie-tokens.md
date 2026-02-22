# ADR-004: PIN Authentication with Bcrypt and Cookie Tokens

## Status
Accepted

## Date
2026-02-21

## Decider(s)
Donovan Yohan

## Context
claude-remote-cli exposes Claude Code CLI sessions over HTTP/WebSocket, which means anyone who can reach the server's port could read terminal output or send input to active sessions. The application needs an authentication mechanism that is simple enough for a personal tool (no user accounts, no OAuth) but strong enough to prevent unauthorized access. Since the tool is designed for mobile access over a network, brute-force protection is also necessary.

## Decision

### PIN Setup
- On first run, the server MUST prompt the user to set a PIN via the terminal (using readline)
- The PIN MUST be hashed using bcrypt with 10 salt rounds before storage
- The bcrypt hash MUST be stored in the config file under the `pinHash` key
- To reset the PIN, the user MUST delete the `pinHash` field from the config file and restart the server

### PIN Verification
- The frontend MUST present a PIN gate that blocks access to the main application until a valid PIN is submitted
- PIN verification MUST use `bcrypt.compare` against the stored hash
- On successful verification, the server MUST generate a session token using `crypto.randomBytes(32).toString('hex')` (64-character hex string)
- The token MUST be set as an `httpOnly`, `sameSite: strict` cookie with a configurable TTL (default: 24 hours)
- Authenticated tokens MUST be stored in an in-memory `Set` on the server; token validity expires via `setTimeout` based on the configured `cookieTTL`

### Rate Limiting
- Failed PIN attempts MUST be tracked per IP address using an in-memory `Map`
- After 5 failed attempts from a single IP, that IP MUST be locked out for 15 minutes
- A successful authentication MUST clear the rate limit counter for that IP
- Rate limit state is in-memory and resets on server restart

### WebSocket Authentication
- WebSocket upgrade requests MUST be authenticated by checking the `token` cookie from the HTTP upgrade headers
- Unauthenticated WebSocket connections MUST be rejected with a 401 response before the upgrade completes

## Consequences

### Positive
- Single shared PIN is simple to set up and appropriate for a personal/small-team tool
- Bcrypt hashing protects the PIN even if the config file is compromised
- Cookie-based tokens mean the browser automatically includes credentials on every request and WebSocket upgrade without custom client-side token management
- Rate limiting prevents brute-force PIN guessing over the network

### Negative
- No multi-user support; everyone who accesses the server uses the same PIN
- Token storage is in-memory, so all authenticated sessions are invalidated on server restart
- No CSRF token (mitigated by `sameSite: strict` cookies and JSON-only endpoints)
- No HTTPS enforcement at the application level; the PIN and cookie travel in plaintext unless a reverse proxy provides TLS

### Risks
- If the server is exposed to the public internet without TLS, the PIN can be intercepted in transit
- The 15-minute lockout applies per IP, so an attacker behind a NAT or VPN could affect all users sharing that IP
- In-memory rate limiting does not persist across restarts, allowing a fresh set of 5 attempts after each server restart
