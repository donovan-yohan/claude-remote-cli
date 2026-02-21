(function () {
  'use strict';

  // State
  var activeSessionId = null;
  var ws = null;
  var term = null;
  var fitAddon = null;
  var selectedRepo = null;

  var wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

  // DOM refs
  var pinGate = document.getElementById('pin-gate');
  var pinInput = document.getElementById('pin-input');
  var pinSubmit = document.getElementById('pin-submit');
  var pinError = document.getElementById('pin-error');
  var mainApp = document.getElementById('main-app');
  var sidebar = document.getElementById('sidebar');
  var sidebarToggle = document.getElementById('sidebar-toggle');
  var sessionList = document.getElementById('session-list');
  var newSessionBtn = document.getElementById('new-session-btn');
  var terminalContainer = document.getElementById('terminal-container');
  var noSessionMsg = document.getElementById('no-session-msg');
  var toolbar = document.getElementById('toolbar');
  var dialog = document.getElementById('new-session-dialog');
  var repoListEl = document.getElementById('repo-list');
  var customPath = document.getElementById('custom-path-input');
  var dialogCancel = document.getElementById('dialog-cancel');
  var dialogStart = document.getElementById('dialog-start');

  // ── PIN Auth ────────────────────────────────────────────────────────────────

  function submitPin() {
    var pin = pinInput.value.trim();
    if (!pin) return;

    fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin }),
    })
      .then(function (res) {
        if (res.ok) {
          pinGate.hidden = true;
          mainApp.hidden = false;
          initApp();
        } else {
          return res.json().then(function (data) {
            showPinError(data.error || 'Incorrect PIN');
          });
        }
      })
      .catch(function () {
        showPinError('Connection error. Please try again.');
      });
  }

  function showPinError(msg) {
    pinError.textContent = msg;
    pinError.hidden = false;
    pinInput.value = '';
    pinInput.focus();
  }

  pinSubmit.addEventListener('click', submitPin);
  pinInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submitPin();
  });

  // ── App Init ────────────────────────────────────────────────────────────────

  function initApp() {
    initTerminal();
    refreshSessions();
    loadRepos();
  }

  // ── Terminal ────────────────────────────────────────────────────────────────

  function initTerminal() {
    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalContainer);
    fitAddon.fit();

    term.onData(function (data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    var resizeObserver = new ResizeObserver(function () {
      fitAddon.fit();
      sendResize();
    });
    resizeObserver.observe(terminalContainer);
  }

  function sendResize() {
    if (ws && ws.readyState === WebSocket.OPEN && term) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  // ── WebSocket / Session Connection ──────────────────────────────────────────

  function connectToSession(sessionId) {
    if (ws) {
      ws.close();
      ws = null;
    }

    activeSessionId = sessionId;
    noSessionMsg.hidden = true;
    term.clear();
    term.focus();

    var url = wsProtocol + '//' + location.host + '/ws/' + sessionId;
    ws = new WebSocket(url);

    ws.onopen = function () {
      sendResize();
    };

    ws.onmessage = function (event) {
      term.write(event.data);
    };

    ws.onclose = function () {
      term.write('\r\n[Connection closed]\r\n');
    };

    ws.onerror = function () {
      term.write('\r\n[WebSocket error]\r\n');
    };

    highlightActiveSession();
  }

  // ── Sessions ────────────────────────────────────────────────────────────────

  function refreshSessions() {
    fetch('/sessions')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        renderSessionList(data.sessions || data || []);
      })
      .catch(function () {
        // silently fail; user can retry by opening the sidebar
      });
  }

  function renderSessionList(sessions) {
    sessionList.innerHTML = '';
    sessions.forEach(function (session) {
      var li = document.createElement('li');
      li.dataset.sessionId = session.id;

      var nameSpan = document.createElement('span');
      nameSpan.className = 'session-name';
      nameSpan.textContent = session.repoName || session.name || session.id;

      var killBtn = document.createElement('button');
      killBtn.className = 'session-kill icon-btn';
      killBtn.setAttribute('aria-label', 'Kill session');
      killBtn.textContent = '×';
      killBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        killSession(session.id);
      });

      li.appendChild(nameSpan);
      li.appendChild(killBtn);

      li.addEventListener('click', function () {
        connectToSession(session.id);
      });

      sessionList.appendChild(li);
    });

    highlightActiveSession();
  }

  function killSession(sessionId) {
    fetch('/sessions/' + sessionId, { method: 'DELETE' })
      .then(function () {
        if (sessionId === activeSessionId) {
          if (ws) {
            ws.close();
            ws = null;
          }
          activeSessionId = null;
          term.clear();
          noSessionMsg.hidden = false;
        }
        refreshSessions();
      })
      .catch(function () {});
  }

  function highlightActiveSession() {
    var items = sessionList.querySelectorAll('li');
    items.forEach(function (li) {
      if (li.dataset.sessionId === activeSessionId) {
        li.classList.add('active');
      } else {
        li.classList.remove('active');
      }
    });
  }

  // ── New Session Dialog ──────────────────────────────────────────────────────

  function loadRepos() {
    fetch('/repos')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var repos = data.repos || data || [];
        repoListEl.innerHTML = '';
        repos.forEach(function (repo) {
          var btn = document.createElement('button');
          btn.className = 'repo-item';
          btn.textContent = repo.name || repo;
          btn.dataset.path = repo.path || repo;
          btn.addEventListener('click', function () {
            // Deselect all, select this one
            repoListEl.querySelectorAll('.repo-item').forEach(function (b) {
              b.classList.remove('selected');
            });
            btn.classList.add('selected');
            selectedRepo = btn.dataset.path;
            customPath.value = '';
          });
          repoListEl.appendChild(btn);
        });
      })
      .catch(function () {});
  }

  newSessionBtn.addEventListener('click', function () {
    // Reset dialog state
    selectedRepo = null;
    customPath.value = '';
    repoListEl.querySelectorAll('.repo-item').forEach(function (b) {
      b.classList.remove('selected');
    });
    dialog.showModal();
  });

  dialogStart.addEventListener('click', function () {
    var path = customPath.value.trim() || selectedRepo;
    if (!path) return;

    fetch('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath: path, repoName: path.split('/').pop() }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        dialog.close();
        refreshSessions();
        if (data.id || data.sessionId) {
          connectToSession(data.id || data.sessionId);
        }
      })
      .catch(function () {});
  });

  dialogCancel.addEventListener('click', function () {
    dialog.close();
  });

  // ── Sidebar Toggle ──────────────────────────────────────────────────────────

  sidebarToggle.addEventListener('click', function () {
    sidebar.classList.toggle('open');
  });

  // ── Touch Toolbar ───────────────────────────────────────────────────────────

  toolbar.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;

    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    var text = btn.dataset.text;
    var key = btn.dataset.key;

    if (text !== undefined) {
      ws.send(text);
    } else if (key !== undefined) {
      ws.send(key);
    }
  });

  // ── Auto-auth Check ─────────────────────────────────────────────────────────

  fetch('/sessions')
    .then(function (res) {
      if (res.ok) {
        // Already authenticated — skip PIN gate
        pinGate.hidden = true;
        mainApp.hidden = false;
        initApp();
      }
      // If not ok (401/403), stay on PIN gate — no action needed
    })
    .catch(function () {
      // Network error — stay on PIN gate
    });
})();
