(function () {
  'use strict';

  // State
  var activeSessionId = null;
  var ws = null;
  var term = null;
  var fitAddon = null;
  var reconnectTimer = null;
  var reconnectAttempt = 0;

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
  var customPath = document.getElementById('custom-path-input');
  var dialogCancel = document.getElementById('dialog-cancel');
  var dialogStart = document.getElementById('dialog-start');
  var menuBtn = document.getElementById('menu-btn');
  var sidebarOverlay = document.getElementById('sidebar-overlay');
  var sessionTitle = document.getElementById('session-title');
  var sessionFilter = document.getElementById('session-filter');
  var sidebarRootFilter = document.getElementById('sidebar-root-filter');
  var sidebarRepoFilter = document.getElementById('sidebar-repo-filter');
  var dialogRootSelect = document.getElementById('dialog-root-select');
  var dialogRepoSelect = document.getElementById('dialog-repo-select');
  var dialogYolo = document.getElementById('dialog-yolo');
  var dialogBranchInput = document.getElementById('dialog-branch-input');
  var dialogBranchList = document.getElementById('dialog-branch-list');
  var dialogContinue = document.getElementById('dialog-continue');
  var dialogContinueField = document.getElementById('dialog-continue-field');
  var contextMenu = document.getElementById('context-menu');
  var ctxResumeYolo = document.getElementById('ctx-resume-yolo');
  var ctxDeleteWorktree = document.getElementById('ctx-delete-worktree');
  var deleteWtDialog = document.getElementById('delete-worktree-dialog');
  var deleteWtName = document.getElementById('delete-wt-name');
  var deleteWtCancel = document.getElementById('delete-wt-cancel');
  var deleteWtConfirm = document.getElementById('delete-wt-confirm');
  var updateToast = document.getElementById('update-toast');
  var updateToastText = document.getElementById('update-toast-text');
  var updateToastBtn = document.getElementById('update-toast-btn');
  var updateToastDismiss = document.getElementById('update-toast-dismiss');
  var imageToast = document.getElementById('image-toast');
  var imageToastText = document.getElementById('image-toast-text');
  var imageToastInsert = document.getElementById('image-toast-insert');
  var imageToastDismiss = document.getElementById('image-toast-dismiss');
  var imageFileInput = document.getElementById('image-file-input');
  var uploadImageBtn = document.getElementById('upload-image-btn');
  var terminalScrollbar = document.getElementById('terminal-scrollbar');
  var terminalScrollbarThumb = document.getElementById('terminal-scrollbar-thumb');
  var mobileInput = document.getElementById('mobile-input');
  var mobileHeader = document.getElementById('mobile-header');
  var sidebarTabs = document.querySelectorAll('.sidebar-tab');
  var tabReposCount = document.getElementById('tab-repos-count');
  var tabWorktreesCount = document.getElementById('tab-worktrees-count');
  var activeTab = 'repos';
  var isMobileDevice = 'ontouchstart' in window;

  // Context menu state
  var contextMenuTarget = null; // stores { worktreePath, repoPath, name }
  var longPressTimer = null;
  var longPressFired = false;

  function showContextMenu(x, y, wt) {
    contextMenuTarget = { worktreePath: wt.path, repoPath: wt.repoPath, name: wt.name };
    contextMenu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    contextMenu.style.top = Math.min(y, window.innerHeight - 60) + 'px';
    contextMenu.hidden = false;
  }

  function hideContextMenu() {
    contextMenu.hidden = true;
    contextMenuTarget = null;
  }

  document.addEventListener('click', function () {
    hideContextMenu();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideContextMenu();
  });

  // Session / worktree / repo state
  var cachedSessions = [];
  var cachedWorktrees = [];
  var allRepos = [];
  var allBranches = [];
  var cachedRepos = [];
  var attentionSessions = {};

  function loadBranches(repoPath) {
    allBranches = [];
    dialogBranchList.innerHTML = '';
    dialogBranchList.hidden = true;
    if (!repoPath) return;

    fetch('/branches?repo=' + encodeURIComponent(repoPath))
      .then(function (res) {
        if (!res.ok) return [];
        return res.json();
      })
      .then(function (data) {
        allBranches = data || [];
      })
      .catch(function () {
        allBranches = [];
      });
  }

  function filterBranches(query) {
    dialogBranchList.innerHTML = '';
    if (!query) {
      dialogBranchList.hidden = true;
      return;
    }

    var lower = query.toLowerCase();
    var matches = allBranches.filter(function (b) {
      return b.toLowerCase().indexOf(lower) !== -1;
    }).slice(0, 10);

    var exactMatch = allBranches.some(function (b) { return b === query; });

    if (!exactMatch) {
      var createLi = document.createElement('li');
      createLi.className = 'branch-create-new';
      createLi.textContent = 'Create new: ' + query;
      createLi.addEventListener('click', function () {
        dialogBranchInput.value = query;
        dialogBranchList.hidden = true;
      });
      dialogBranchList.appendChild(createLi);
    }

    matches.forEach(function (branch) {
      var li = document.createElement('li');
      li.textContent = branch;
      li.addEventListener('click', function () {
        dialogBranchInput.value = branch;
        dialogBranchList.hidden = true;
      });
      dialogBranchList.appendChild(li);
    });

    dialogBranchList.hidden = dialogBranchList.children.length === 0;
  }

  dialogBranchInput.addEventListener('input', function () {
    filterBranches(dialogBranchInput.value.trim());
  });

  dialogBranchInput.addEventListener('focus', function () {
    if (dialogBranchInput.value.trim()) {
      filterBranches(dialogBranchInput.value.trim());
    }
  });

  document.addEventListener('click', function (e) {
    if (!dialogBranchInput.contains(e.target) && !dialogBranchList.contains(e.target)) {
      dialogBranchList.hidden = true;
    }
  });

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
    loadRepos();
    refreshAll();
    connectEventSocket();
    checkForUpdates();
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

    term.onScroll(updateScrollbar);
    term.onWriteParsed(updateScrollbar);

    var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
    term.attachCustomKeyEventHandler(function (e) {
      if (isMobileDevice) {
        return false;
      }

      if (!isMac && e.type === 'keydown' && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey &&
          (e.key === 'v' || e.key === 'V')) {
        if (navigator.clipboard && navigator.clipboard.read) {
          navigator.clipboard.read().then(function (clipboardItems) {
            var imageBlob = null;
            var imageType = null;

            for (var i = 0; i < clipboardItems.length; i++) {
              var types = clipboardItems[i].types;
              for (var j = 0; j < types.length; j++) {
                if (types[j].indexOf('image/') === 0) {
                  imageType = types[j];
                  imageBlob = clipboardItems[i];
                  break;
                }
              }
              if (imageBlob) break;
            }

            if (imageBlob) {
              imageBlob.getType(imageType).then(function (blob) {
                uploadImage(blob, imageType);
              });
            } else {
              navigator.clipboard.readText().then(function (text) {
                if (text) term.paste(text);
              });
            }
          }).catch(function () {
            if (navigator.clipboard.readText) {
              navigator.clipboard.readText().then(function (text) {
                if (text) term.paste(text);
              }).catch(function () {});
            }
          });
          return false;
        }
      }

      return true;
    });

    term.onData(function (data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    var resizeObserver = new ResizeObserver(function () {
      fitAddon.fit();
      sendResize();
      updateScrollbar();
    });
    resizeObserver.observe(terminalContainer);
  }

  function sendResize() {
    if (ws && ws.readyState === WebSocket.OPEN && term) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  // ── Terminal Scrollbar ──────────────────────────────────────────────────────

  var scrollbarDragging = false;
  var scrollbarDragStartY = 0;
  var scrollbarDragStartTop = 0;

  function updateScrollbar() {
    if (!term || !terminalScrollbar || terminalScrollbar.style.display === 'none') return;
    var buf = term.buffer.active;
    var totalLines = buf.baseY + term.rows;
    var viewportTop = buf.viewportY;
    var trackHeight = terminalScrollbar.clientHeight;

    if (totalLines <= term.rows) {
      terminalScrollbarThumb.style.display = 'none';
      return;
    }

    terminalScrollbarThumb.style.display = 'block';
    var thumbHeight = Math.max(isMobileDevice ? 44 : 20, (term.rows / totalLines) * trackHeight);
    var thumbTop = (viewportTop / (totalLines - term.rows)) * (trackHeight - thumbHeight);

    terminalScrollbarThumb.style.height = thumbHeight + 'px';
    terminalScrollbarThumb.style.top = thumbTop + 'px';
  }

  function scrollbarScrollToY(clientY) {
    var rect = terminalScrollbar.getBoundingClientRect();
    var buf = term.buffer.active;
    var totalLines = buf.baseY + term.rows;
    if (totalLines <= term.rows) return;

    var thumbHeight = Math.max(isMobileDevice ? 44 : 20, (term.rows / totalLines) * terminalScrollbar.clientHeight);
    var trackUsable = terminalScrollbar.clientHeight - thumbHeight;
    var relativeY = clientY - rect.top - thumbHeight / 2;
    var ratio = Math.max(0, Math.min(1, relativeY / trackUsable));
    var targetLine = Math.round(ratio * (totalLines - term.rows));

    term.scrollToLine(targetLine);
  }

  terminalScrollbarThumb.addEventListener('touchstart', function (e) {
    e.preventDefault();
    scrollbarDragging = true;
    scrollbarDragStartY = e.touches[0].clientY;
    scrollbarDragStartTop = parseInt(terminalScrollbarThumb.style.top, 10) || 0;
  });

  if (isMobileDevice) {
    document.addEventListener('touchmove', function (e) {
      if (!scrollbarDragging) return;
      e.preventDefault();
      var deltaY = e.touches[0].clientY - scrollbarDragStartY;
      var buf = term.buffer.active;
      var totalLines = buf.baseY + term.rows;
      if (totalLines <= term.rows) return;

      var thumbHeight = Math.max(isMobileDevice ? 44 : 20, (term.rows / totalLines) * terminalScrollbar.clientHeight);
      var trackUsable = terminalScrollbar.clientHeight - thumbHeight;
      var newTop = Math.max(0, Math.min(trackUsable, scrollbarDragStartTop + deltaY));
      var ratio = newTop / trackUsable;
      var targetLine = Math.round(ratio * (totalLines - term.rows));

      term.scrollToLine(targetLine);
    }, { passive: false });

    document.addEventListener('touchend', function () {
      scrollbarDragging = false;
    });
  }

  terminalScrollbar.addEventListener('click', function (e) {
    if (e.target === terminalScrollbarThumb) return;
    scrollbarScrollToY(e.clientY);
  });

  // ── WebSocket / Session Connection ──────────────────────────────────────────

  function connectToSession(sessionId) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempt = 0;

    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }

    activeSessionId = sessionId;
    delete attentionSessions[sessionId];
    noSessionMsg.hidden = true;
    term.clear();
    if (isMobileDevice) {
      mobileInput.value = '';
      mobileInput.dispatchEvent(new Event('sessionchange'));
      mobileInput.focus();
    } else {
      term.focus();
    }
    closeSidebar();
    updateSessionTitle();
    highlightActiveSession();

    openPtyWebSocket(sessionId);
  }

  function openPtyWebSocket(sessionId) {
    var url = wsProtocol + '//' + location.host + '/ws/' + sessionId;
    var socket = new WebSocket(url);

    socket.onopen = function () {
      ws = socket;
      reconnectAttempt = 0;
      sendResize();
    };

    socket.onmessage = function (event) {
      term.write(event.data);
    };

    socket.onclose = function (event) {
      if (event.code === 1000) {
        term.write('\r\n[Session ended]\r\n');
        ws = null;
        return;
      }

      if (activeSessionId !== sessionId) return;

      ws = null;
      if (reconnectAttempt === 0) {
        term.write('\r\n[Reconnecting...]\r\n');
      }
      scheduleReconnect(sessionId);
    };

    socket.onerror = function () {};
  }

  var MAX_RECONNECT_ATTEMPTS = 30;

  function scheduleReconnect(sessionId) {
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      term.write('\r\n[Gave up reconnecting after ' + MAX_RECONNECT_ATTEMPTS + ' attempts]\r\n');
      return;
    }
    var delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 10000);
    reconnectAttempt++;

    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      if (activeSessionId !== sessionId) return;
      fetch('/sessions').then(function (res) {
        return res.json();
      }).then(function (sessions) {
        var exists = sessions.some(function (s) { return s.id === sessionId; });
        if (!exists || activeSessionId !== sessionId) {
          term.write('\r\n[Session ended]\r\n');
          return;
        }
        term.clear();
        openPtyWebSocket(sessionId);
      }).catch(function () {
        if (activeSessionId === sessionId) {
          scheduleReconnect(sessionId);
        }
      });
    }, delay);
  }

  // ── Sessions & Worktrees ────────────────────────────────────────────────────

  var eventWs = null;

  function connectEventSocket() {
    if (eventWs) {
      eventWs.close();
      eventWs = null;
    }

    var url = wsProtocol + '//' + location.host + '/ws/events';
    eventWs = new WebSocket(url);

    eventWs.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        if (msg.type === 'worktrees-changed') {
          loadRepos();
          refreshAll();
        } else if (msg.type === 'session-idle-changed') {
          if (msg.idle && msg.sessionId !== activeSessionId) {
            attentionSessions[msg.sessionId] = true;
          }
          if (!msg.idle) {
            delete attentionSessions[msg.sessionId];
          }
          renderUnifiedList();
        }
      } catch (_) {}
    };

    eventWs.onclose = function () {
      setTimeout(function () {
        connectEventSocket();
      }, 3000);
    };

    eventWs.onerror = function () {};
  }

  function refreshAll() {
    Promise.all([
      fetch('/sessions').then(function (res) { return res.json(); }),
      fetch('/worktrees').then(function (res) { return res.json(); }),
      fetch('/repos').then(function (res) { return res.json(); }),
    ])
      .then(function (results) {
        cachedSessions = results[0] || [];
        cachedWorktrees = results[1] || [];
        cachedRepos = results[2] || [];

        // Prune attention flags for sessions that no longer exist
        var activeIds = {};
        cachedSessions.forEach(function (s) { activeIds[s.id] = true; });
        Object.keys(attentionSessions).forEach(function (id) {
          if (!activeIds[id]) delete attentionSessions[id];
        });

        populateSidebarFilters();
        renderUnifiedList();
      })
      .catch(function () {});
  }

  function populateSidebarFilters() {
    var currentRoot = sidebarRootFilter.value;
    var roots = {};
    cachedSessions.forEach(function (s) {
      if (s.root) roots[s.root] = true;
    });
    cachedWorktrees.forEach(function (wt) {
      if (wt.root) roots[wt.root] = true;
    });

    sidebarRootFilter.innerHTML = '<option value="">All roots</option>';
    Object.keys(roots).sort().forEach(function (root) {
      var opt = document.createElement('option');
      opt.value = root;
      opt.textContent = rootShortName(root);
      sidebarRootFilter.appendChild(opt);
    });
    if (currentRoot && roots[currentRoot]) {
      sidebarRootFilter.value = currentRoot;
    }

    updateRepoFilter();
  }

  function updateRepoFilter() {
    var selectedRoot = sidebarRootFilter.value;
    var currentRepo = sidebarRepoFilter.value;
    var repos = {};

    cachedSessions.forEach(function (s) {
      if (!selectedRoot || s.root === selectedRoot) {
        if (s.repoName) repos[s.repoName] = true;
      }
    });
    cachedWorktrees.forEach(function (wt) {
      if (!selectedRoot || wt.root === selectedRoot) {
        if (wt.repoName) repos[wt.repoName] = true;
      }
    });

    sidebarRepoFilter.innerHTML = '<option value="">All repos</option>';
    Object.keys(repos).sort().forEach(function (repoName) {
      var opt = document.createElement('option');
      opt.value = repoName;
      opt.textContent = repoName;
      sidebarRepoFilter.appendChild(opt);
    });
    if (currentRepo && repos[currentRepo]) {
      sidebarRepoFilter.value = currentRepo;
    }
  }

  sidebarRootFilter.addEventListener('change', function () {
    updateRepoFilter();
    renderUnifiedList();
  });

  sidebarRepoFilter.addEventListener('change', function () {
    renderUnifiedList();
  });

  sessionFilter.addEventListener('input', function () {
    renderUnifiedList();
  });

  sidebarTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      activeTab = tab.dataset.tab;
      sidebarTabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      newSessionBtn.textContent = activeTab === 'repos' ? '+ New Session' : '+ New Worktree';
      renderUnifiedList();
    });
  });

  function rootShortName(path) {
    return path.split('/').filter(Boolean).pop() || path;
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return '';
    var now = Date.now();
    var then = new Date(isoString).getTime();
    var diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 60) return 'just now';
    var diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + ' min ago';
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + (diffHr === 1 ? ' hour ago' : ' hours ago');
    var diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return 'yesterday';
    if (diffDay < 7) return diffDay + ' days ago';
    var d = new Date(isoString);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate();
  }

  function renderUnifiedList() {
    var rootFilter = sidebarRootFilter.value;
    var repoFilter = sidebarRepoFilter.value;
    var textFilter = sessionFilter.value.toLowerCase();

    // Split sessions by type
    var repoSessions = cachedSessions.filter(function (s) { return s.type === 'repo'; });
    var worktreeSessions = cachedSessions.filter(function (s) { return s.type !== 'repo'; });

    // Filtered repo sessions
    var filteredRepoSessions = repoSessions.filter(function (s) {
      if (rootFilter && s.root !== rootFilter) return false;
      if (repoFilter && s.repoName !== repoFilter) return false;
      if (textFilter) {
        var name = (s.displayName || s.repoName || s.id).toLowerCase();
        if (name.indexOf(textFilter) === -1) return false;
      }
      return true;
    });

    // Idle repos: all repos without an active repo session
    var activeRepoPathSet = new Set();
    repoSessions.forEach(function (s) { activeRepoPathSet.add(s.repoPath); });

    var filteredIdleRepos = cachedRepos.filter(function (r) {
      if (activeRepoPathSet.has(r.path)) return false;
      if (rootFilter && r.root !== rootFilter) return false;
      if (repoFilter && r.name !== repoFilter) return false;
      if (textFilter) {
        var name = (r.name || '').toLowerCase();
        if (name.indexOf(textFilter) === -1) return false;
      }
      return true;
    });

    filteredIdleRepos.sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });

    // Filtered worktree sessions
    var filteredWorktreeSessions = worktreeSessions.filter(function (s) {
      if (rootFilter && s.root !== rootFilter) return false;
      if (repoFilter && s.repoName !== repoFilter) return false;
      if (textFilter) {
        var name = (s.displayName || s.repoName || s.worktreeName || s.id).toLowerCase();
        if (name.indexOf(textFilter) === -1) return false;
      }
      return true;
    });

    // Inactive worktrees (deduped against active sessions)
    var activeWorktreePaths = new Set();
    worktreeSessions.forEach(function (s) {
      if (s.repoPath) activeWorktreePaths.add(s.repoPath);
    });

    var filteredWorktrees = cachedWorktrees.filter(function (wt) {
      if (activeWorktreePaths.has(wt.path)) return false;
      if (rootFilter && wt.root !== rootFilter) return false;
      if (repoFilter && wt.repoName !== repoFilter) return false;
      if (textFilter) {
        var name = (wt.name || '').toLowerCase();
        if (name.indexOf(textFilter) === -1) return false;
      }
      return true;
    });

    filteredWorktrees.sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });

    // Update tab counts
    tabReposCount.textContent = filteredRepoSessions.length + filteredIdleRepos.length;
    tabWorktreesCount.textContent = filteredWorktreeSessions.length + filteredWorktrees.length;

    // Render based on active tab
    sessionList.innerHTML = '';

    if (activeTab === 'repos') {
      filteredRepoSessions.forEach(function (session) {
        sessionList.appendChild(createActiveSessionLi(session));
      });
      if (filteredRepoSessions.length > 0 && filteredIdleRepos.length > 0) {
        sessionList.appendChild(createSectionDivider('Available'));
      }
      filteredIdleRepos.forEach(function (repo) {
        sessionList.appendChild(createIdleRepoLi(repo));
      });
    } else {
      filteredWorktreeSessions.forEach(function (session) {
        sessionList.appendChild(createActiveSessionLi(session));
      });
      if (filteredWorktreeSessions.length > 0 && filteredWorktrees.length > 0) {
        sessionList.appendChild(createSectionDivider('Available'));
      }
      filteredWorktrees.forEach(function (wt) {
        sessionList.appendChild(createInactiveWorktreeLi(wt));
      });
    }

    highlightActiveSession();
  }

  function getSessionStatus(session) {
    if (attentionSessions[session.id]) return 'attention';
    if (session.idle) return 'idle';
    return 'running';
  }

  function createActiveSessionLi(session) {
    var li = document.createElement('li');
    li.className = 'active-session';
    li.dataset.sessionId = session.id;

    var infoDiv = document.createElement('div');
    infoDiv.className = 'session-info';

    var nameSpan = document.createElement('span');
    nameSpan.className = 'session-name';
    var displayName = session.displayName || session.repoName || session.id;
    nameSpan.textContent = displayName;
    nameSpan.title = displayName;

    var subSpan = document.createElement('span');
    subSpan.className = 'session-sub';
    subSpan.textContent = (session.root ? rootShortName(session.root) : '') + ' · ' + (session.repoName || '');

    var status = getSessionStatus(session);
    var dot = document.createElement('span');
    dot.className = 'status-dot status-dot--' + status;
    infoDiv.appendChild(dot);
    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(subSpan);

    var timeSpan = document.createElement('span');
    timeSpan.className = 'session-time';
    timeSpan.textContent = formatRelativeTime(session.lastActivity);
    infoDiv.appendChild(timeSpan);

    var actionsDiv = document.createElement('div');
    actionsDiv.className = 'session-actions';

    var renameBtn = document.createElement('button');
    renameBtn.className = 'session-rename-btn';
    renameBtn.setAttribute('aria-label', 'Rename session');
    renameBtn.textContent = '✎';
    renameBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      startRename(li, session);
    });

    var killBtn = document.createElement('button');
    killBtn.className = 'session-kill';
    killBtn.setAttribute('aria-label', 'Kill session');
    killBtn.textContent = '×';
    killBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      killSession(session.id);
    });

    actionsDiv.appendChild(renameBtn);
    actionsDiv.appendChild(killBtn);

    li.appendChild(infoDiv);
    li.appendChild(actionsDiv);

    li.addEventListener('click', function () {
      connectToSession(session.id);
    });

    return li;
  }

  function createInactiveWorktreeLi(wt) {
    var li = document.createElement('li');
    li.className = 'inactive-worktree';

    var infoDiv = document.createElement('div');
    infoDiv.className = 'session-info';

    var nameSpan = document.createElement('span');
    nameSpan.className = 'session-name';
    var wtDisplayName = wt.displayName || wt.name;
    nameSpan.textContent = wtDisplayName;
    nameSpan.title = wtDisplayName;

    var subSpan = document.createElement('span');
    subSpan.className = 'session-sub';
    subSpan.textContent = (wt.root ? rootShortName(wt.root) : '') + ' · ' + (wt.repoName || '');

    var dot = document.createElement('span');
    dot.className = 'status-dot status-dot--inactive';
    infoDiv.appendChild(dot);
    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(subSpan);

    var timeSpan = document.createElement('span');
    timeSpan.className = 'session-time';
    timeSpan.textContent = formatRelativeTime(wt.lastActivity);
    infoDiv.appendChild(timeSpan);

    li.appendChild(infoDiv);

    // Click to resume (but not if context menu just opened or long-press fired)
    li.addEventListener('click', function () {
      if (longPressFired || !contextMenu.hidden) return;
      startSession(wt.repoPath, wt.path);
    });

    // Right-click context menu (desktop)
    li.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, wt);
    });

    // Long-press context menu (mobile)
    li.addEventListener('touchstart', function (e) {
      longPressFired = false;
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        longPressFired = true;
        var touch = e.touches[0];
        showContextMenu(touch.clientX, touch.clientY, wt);
      }, 500);
    }, { passive: true });

    li.addEventListener('touchend', function () {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    li.addEventListener('touchmove', function () {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    return li;
  }

  function createSectionDivider(label) {
    var divider = document.createElement('li');
    divider.className = 'session-divider';
    divider.textContent = label;
    return divider;
  }

  function createIdleRepoLi(repo) {
    var li = document.createElement('li');
    li.className = 'inactive-worktree';
    li.title = repo.path;

    var infoDiv = document.createElement('div');
    infoDiv.className = 'session-info';

    var nameSpan = document.createElement('span');
    nameSpan.className = 'session-name';
    nameSpan.textContent = repo.name;
    nameSpan.title = repo.name;

    var dot = document.createElement('span');
    dot.className = 'status-dot status-dot--inactive';

    var subSpan = document.createElement('span');
    subSpan.className = 'session-sub';
    subSpan.textContent = repo.root ? rootShortName(repo.root) : repo.path;

    infoDiv.appendChild(dot);
    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(subSpan);
    li.appendChild(infoDiv);

    li.addEventListener('click', function () {
      openNewSessionDialogForRepo(repo);
    });

    return li;
  }

  function startRename(li, session) {
    var nameSpan = li.querySelector('.session-name');
    if (!nameSpan) return;

    var currentName = nameSpan.textContent;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'session-rename-input';
    input.value = currentName;

    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    var committed = false;

    function commit() {
      if (committed) return;
      committed = true;
      var newName = input.value.trim();
      if (!newName || newName === currentName) {
        cancel();
        return;
      }
      fetch('/sessions/' + session.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: newName }),
      })
        .then(function () { refreshAll(); })
        .catch(function () { cancel(); });
    }

    function cancel() {
      committed = true;
      input.replaceWith(nameSpan);
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    input.addEventListener('blur', commit);
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
          updateSessionTitle();
        }
        refreshAll();
      })
      .catch(function () {});
  }

  // ── Context Menu Actions ──────────────────────────────────────────────────

  ctxResumeYolo.addEventListener('click', function (e) {
    e.stopPropagation();
    var target = contextMenuTarget;
    hideContextMenu();
    if (!target) return;
    startSession(
      target.repoPath,
      target.worktreePath,
      ['--dangerously-skip-permissions']
    );
  });

  ctxDeleteWorktree.addEventListener('click', function (e) {
    e.stopPropagation();
    var target = contextMenuTarget;
    hideContextMenu();
    if (!target) return;
    contextMenuTarget = target;
    deleteWtName.textContent = target.name;
    deleteWtDialog.showModal();
  });

  deleteWtCancel.addEventListener('click', function () {
    deleteWtDialog.close();
    contextMenuTarget = null;
  });

  deleteWtConfirm.addEventListener('click', function () {
    if (!contextMenuTarget) return;
    var target = contextMenuTarget;
    deleteWtDialog.close();
    contextMenuTarget = null;

    fetch('/worktrees', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worktreePath: target.worktreePath,
        repoPath: target.repoPath,
      }),
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (data) {
            alert(data.error || 'Failed to delete worktree');
          });
        }
        // UI will auto-update via worktrees-changed WebSocket event
      })
      .catch(function () {
        alert('Failed to delete worktree');
      });
  });

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

  function updateSessionTitle() {
    if (!activeSessionId) {
      sessionTitle.textContent = 'No session';
      return;
    }
    var activeLi = sessionList.querySelector('li.active .session-name');
    sessionTitle.textContent = activeLi ? activeLi.textContent : activeSessionId.slice(0, 8);
  }

  // ── Repos & New Session Dialog ──────────────────────────────────────────────

  function loadRepos() {
    fetch('/repos')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        allRepos = data.repos || data || [];
      })
      .catch(function () {});
  }

  function populateDialogRootSelect() {
    var roots = {};
    allRepos.forEach(function (repo) {
      var root = repo.root || 'Other';
      roots[root] = true;
    });
    dialogRootSelect.innerHTML = '<option value="">Select a root...</option>';
    Object.keys(roots).forEach(function (root) {
      var opt = document.createElement('option');
      opt.value = root;
      opt.textContent = rootShortName(root);
      dialogRootSelect.appendChild(opt);
    });
  }

  dialogRootSelect.addEventListener('change', function () {
    var root = dialogRootSelect.value;
    dialogRepoSelect.innerHTML = '<option value="">Select a repo...</option>';
    dialogBranchInput.value = '';
    allBranches = [];

    if (!root) {
      dialogRepoSelect.disabled = true;
      return;
    }

    var filtered = allRepos.filter(function (r) { return r.root === root; });
    filtered.sort(function (a, b) { return a.name.localeCompare(b.name); });
    filtered.forEach(function (repo) {
      var opt = document.createElement('option');
      opt.value = repo.path;
      opt.textContent = repo.name;
      dialogRepoSelect.appendChild(opt);
    });
    dialogRepoSelect.disabled = false;
  });

  dialogRepoSelect.addEventListener('change', function () {
    var repoPath = dialogRepoSelect.value;
    dialogBranchInput.value = '';
    loadBranches(repoPath);
  });

  function startSession(repoPath, worktreePath, claudeArgs, branchName) {
    var body = {
      repoPath: repoPath,
      repoName: repoPath.split('/').filter(Boolean).pop(),
    };
    if (worktreePath) body.worktreePath = worktreePath;
    if (claudeArgs) body.claudeArgs = claudeArgs;
    if (branchName) body.branchName = branchName;

    fetch('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (dialog.open) dialog.close();
        refreshAll();
        if (data.id) {
          connectToSession(data.id);
        }
      })
      .catch(function () {});
  }

  function resetDialogFields() {
    customPath.value = '';
    dialogYolo.checked = false;
    dialogContinue.checked = false;
    dialogBranchInput.value = '';
    dialogBranchList.hidden = true;
    allBranches = [];
    populateDialogRootSelect();
  }

  function showDialogForTab(tab) {
    var dialogBranchField = dialogBranchInput.closest('.dialog-field');
    if (tab === 'repos') {
      dialogBranchField.hidden = true;
      dialogContinueField.hidden = false;
      dialogStart.textContent = 'New Session';
    } else {
      dialogBranchField.hidden = false;
      dialogContinueField.hidden = true;
      dialogStart.textContent = 'New Worktree';
    }
  }

  function openNewSessionDialogForRepo(repo) {
    resetDialogFields();

    if (repo.root) {
      dialogRootSelect.value = repo.root;
      dialogRootSelect.dispatchEvent(new Event('change'));
      dialogRepoSelect.value = repo.path;
    }

    showDialogForTab('repos');
    dialog.showModal();
  }

  function startRepoSession(repoPath, continueSession, claudeArgs) {
    var body = { repoPath: repoPath };
    if (continueSession) body.continue = true;
    if (claudeArgs) body.claudeArgs = claudeArgs;

    fetch('/sessions/repo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (res.status === 409) {
          return res.json().then(function (data) {
            if (dialog.open) dialog.close();
            refreshAll();
            if (data.sessionId) connectToSession(data.sessionId);
            return null;
          });
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        if (dialog.open) dialog.close();
        refreshAll();
        if (data.id) connectToSession(data.id);
      })
      .catch(function () {});
  }

  newSessionBtn.addEventListener('click', function () {
    resetDialogFields();

    var sidebarRoot = sidebarRootFilter.value;
    if (sidebarRoot) {
      dialogRootSelect.value = sidebarRoot;
      dialogRootSelect.dispatchEvent(new Event('change'));
      var sidebarRepo = sidebarRepoFilter.value;
      if (sidebarRepo) {
        var matchingRepo = allRepos.find(function (r) {
          return r.root === sidebarRoot && r.name === sidebarRepo;
        });
        if (matchingRepo) {
          dialogRepoSelect.value = matchingRepo.path;
        }
      }
    } else {
      dialogRepoSelect.innerHTML = '<option value="">Select a repo...</option>';
      dialogRepoSelect.disabled = true;
    }

    showDialogForTab(activeTab);
    dialog.showModal();
  });

  dialogStart.addEventListener('click', function () {
    var repoPathValue = customPath.value.trim() || dialogRepoSelect.value;
    if (!repoPathValue) return;
    var args = dialogYolo.checked ? ['--dangerously-skip-permissions'] : undefined;

    if (activeTab === 'repos') {
      startRepoSession(repoPathValue, dialogContinue.checked, args);
    } else {
      var branch = dialogBranchInput.value.trim() || undefined;
      startSession(repoPathValue, undefined, args, branch);
    }
  });

  customPath.addEventListener('blur', function () {
    var pathValue = customPath.value.trim();
    if (pathValue) {
      loadBranches(pathValue);
    }
  });

  dialogCancel.addEventListener('click', function () {
    dialog.close();
  });

  // ── Sidebar Toggle ──────────────────────────────────────────────────────────

  function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('visible');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
  }

  menuBtn.addEventListener('click', openSidebar);
  sidebarToggle.addEventListener('click', closeSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);

  // ── Settings Dialog ────────────────────────────────────────────────────────

  var settingsBtn = document.getElementById('settings-btn');
  var settingsDialog = document.getElementById('settings-dialog');
  var settingsRootsList = document.getElementById('settings-roots-list');
  var addRootPath = document.getElementById('add-root-path');
  var addRootBtn = document.getElementById('add-root-btn');
  var settingsClose = document.getElementById('settings-close');

  function renderRoots(roots) {
    settingsRootsList.innerHTML = '';
    roots.forEach(function (rootPath) {
      var div = document.createElement('div');
      div.className = 'settings-repo-item';

      var pathSpan = document.createElement('span');
      pathSpan.className = 'repo-path';
      pathSpan.textContent = rootPath;

      var removeBtn = document.createElement('button');
      removeBtn.className = 'remove-repo';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', function () {
        fetch('/roots', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: rootPath }),
        })
          .then(function (res) { return res.json(); })
          .then(function (updated) {
            renderRoots(updated);
            loadRepos();
          })
          .catch(function () {});
      });

      div.appendChild(pathSpan);
      div.appendChild(removeBtn);
      settingsRootsList.appendChild(div);
    });
  }

  function openSettings() {
    fetch('/roots')
      .then(function (res) { return res.json(); })
      .then(function (roots) {
        renderRoots(roots);
        settingsDialog.showModal();
      })
      .catch(function () {});
  }

  settingsBtn.addEventListener('click', openSettings);

  addRootBtn.addEventListener('click', function () {
    var rootPath = addRootPath.value.trim();
    if (!rootPath) return;

    fetch('/roots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: rootPath }),
    })
      .then(function (res) { return res.json(); })
      .then(function (updated) {
        renderRoots(updated);
        addRootPath.value = '';
        loadRepos();
      })
      .catch(function () {});
  });

  addRootPath.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addRootBtn.click();
  });

  var settingsDevtools = document.getElementById('settings-devtools');

  // Initialize developer tools toggle from localStorage
  var devtoolsEnabled = localStorage.getItem('devtools-enabled') === 'true';
  settingsDevtools.checked = devtoolsEnabled;

  settingsDevtools.addEventListener('change', function () {
    devtoolsEnabled = settingsDevtools.checked;
    localStorage.setItem('devtools-enabled', devtoolsEnabled ? 'true' : 'false');
    // Update debug toggle visibility immediately
    var debugToggle = document.getElementById('debug-toggle');
    if (debugToggle) {
      debugToggle.style.display = devtoolsEnabled ? '' : 'none';
    }
  });

  settingsClose.addEventListener('click', function () {
    settingsDialog.close();
    loadRepos();
    refreshAll();
  });

  // ── Touch Toolbar ───────────────────────────────────────────────────────────

  function handleToolbarButton(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    // Skip the upload button (handled separately)
    if (btn.id === 'upload-image-btn') return;

    e.preventDefault();

    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    var text = btn.dataset.text;
    var key = btn.dataset.key;

    // Flush composed text before sending Enter/newline so pending input isn't lost
    if ((key === '\r' || key === '\x1b[13;2u') && mobileInput.flushComposedText) {
      mobileInput.flushComposedText();
    }

    if (text !== undefined) {
      ws.send(text);
    } else if (key !== undefined) {
      ws.send(key);
    }

    // Clear input after Enter/newline to reset state
    if ((key === '\r' || key === '\x1b[13;2u') && mobileInput.clearInput) {
      mobileInput.clearInput();
    }

    // Re-focus the mobile input to keep keyboard open
    if (isMobileDevice) {
      mobileInput.focus();
    }
  }

  toolbar.addEventListener('touchstart', handleToolbarButton, { passive: false });

  toolbar.addEventListener('click', function (e) {
    // On non-touch devices, handle normally
    if (isMobileDevice) return; // already handled by touchstart
    handleToolbarButton(e);
  });

  // ── Image Paste Handling ─────────────────────────────────────────────────────

  var imageUploadInProgress = false;
  var pendingImagePath = null;

  function showImageToast(text, showInsert) {
    imageToastText.textContent = text;
    imageToastInsert.hidden = !showInsert;
    imageToast.hidden = false;
  }

  function hideImageToast() {
    imageToast.hidden = true;
    pendingImagePath = null;
  }

  function autoDismissImageToast(ms) {
    setTimeout(function () {
      if (!pendingImagePath) {
        hideImageToast();
      }
    }, ms);
  }

  function uploadImage(blob, mimeType) {
    if (imageUploadInProgress) return;
    if (!activeSessionId) return;

    imageUploadInProgress = true;
    showImageToast('Pasting image\u2026', false);

    var reader = new FileReader();
    reader.onload = function () {
      var base64 = reader.result.split(',')[1];

      fetch('/sessions/' + activeSessionId + '/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: base64, mimeType: mimeType }),
      })
        .then(function (res) {
          if (res.status === 413) {
            showImageToast('Image too large (max 10MB)', false);
            autoDismissImageToast(4000);
            return;
          }
          if (!res.ok) {
            return res.json().then(function (data) {
              showImageToast(data.error || 'Image upload failed', false);
              autoDismissImageToast(4000);
            });
          }
          return res.json().then(function (data) {
            if (data.clipboardSet) {
              showImageToast('Image pasted', false);
              autoDismissImageToast(2000);
            } else {
              pendingImagePath = data.path;
              showImageToast(data.path, true);
            }
          });
        })
        .catch(function () {
          showImageToast('Image upload failed', false);
          autoDismissImageToast(4000);
        })
        .then(function () {
          imageUploadInProgress = false;
        });
    };

    reader.readAsDataURL(blob);
  }

  terminalContainer.addEventListener('paste', function (e) {
    if (!e.clipboardData || !e.clipboardData.items) return;

    var items = e.clipboardData.items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image/') === 0) {
        e.preventDefault();
        e.stopPropagation();
        var blob = items[i].getAsFile();
        if (blob) {
          uploadImage(blob, items[i].type);
        }
        return;
      }
    }
  });

  terminalContainer.addEventListener('dragover', function (e) {
    if (e.dataTransfer && e.dataTransfer.types.indexOf('Files') !== -1) {
      e.preventDefault();
      terminalContainer.classList.add('drag-over');
    }
  });

  terminalContainer.addEventListener('dragleave', function () {
    terminalContainer.classList.remove('drag-over');
  });

  terminalContainer.addEventListener('drop', function (e) {
    e.preventDefault();
    terminalContainer.classList.remove('drag-over');
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;

    var file = e.dataTransfer.files[0];
    if (file.type.indexOf('image/') === 0) {
      uploadImage(file, file.type);
    }
  });

  imageToastInsert.addEventListener('click', function () {
    if (pendingImagePath && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(pendingImagePath);
    }
    hideImageToast();
  });

  imageToastDismiss.addEventListener('click', function () {
    hideImageToast();
  });

  // ── Image Upload Button (mobile) ──────────────────────────────────────────

  uploadImageBtn.addEventListener('click', function (e) {
    e.preventDefault();
    if (!activeSessionId) return;
    imageFileInput.click();
    if (isMobileDevice) {
      mobileInput.focus();
    }
  });

  imageFileInput.addEventListener('change', function () {
    var file = imageFileInput.files[0];
    if (file && file.type.indexOf('image/') === 0) {
      uploadImage(file, file.type);
    }
    imageFileInput.value = '';
  });

  // ── Mobile Input Proxy ──────────────────────────────────────────────────────

  (function () {
    if (!isMobileDevice) return;

    // ── Debug Panel (hidden by default, toggle with button) ──
    var debugPanel = document.createElement('div');
    debugPanel.id = 'debug-panel';
    debugPanel.style.cssText = 'position:fixed;top:0;left:0;right:0;height:30vh;overflow-y:auto;background:rgba(0,0,0,0.92);color:#0f0;font:11px/1.4 monospace;padding:6px 6px 6px 40px;z-index:9999;display:none;';
    document.body.appendChild(debugPanel);

    var debugToggle = document.createElement('button');
    debugToggle.id = 'debug-toggle';
    debugToggle.textContent = 'dbg';
    debugToggle.style.cssText = 'position:fixed;bottom:60px;right:8px;z-index:10000;background:#333;color:#0f0;border:1px solid #0f0;border-radius:6px;font:12px monospace;padding:6px 10px;opacity:0.5;min-width:44px;min-height:44px;';
    // Hide debug toggle unless developer tools are enabled in settings
    if (localStorage.getItem('devtools-enabled') !== 'true') {
      debugToggle.style.display = 'none';
    }
    document.body.appendChild(debugToggle);

    var debugVisible = false;
    debugToggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      debugVisible = !debugVisible;
      debugPanel.style.display = debugVisible ? 'block' : 'none';
      debugToggle.style.opacity = debugVisible ? '1' : '0.6';
    });

    var debugLines = [];
    function dbg(msg) {
      var t = performance.now().toFixed(1);
      debugLines.push('[' + t + '] ' + msg);
      if (debugLines.length > 200) debugLines.shift();
      debugPanel.innerHTML = debugLines.join('<br>');
      debugPanel.scrollTop = debugPanel.scrollHeight;
    }

    var lastInputValue = '';
    var isComposing = false;

    function focusMobileInput() {
      if (document.activeElement !== mobileInput) {
        mobileInput.focus();
      }
    }

    // Tap on terminal area focuses the hidden input (opens keyboard)
    terminalContainer.addEventListener('touchend', function (e) {
      // Don't interfere with scrollbar drag or selection
      if (scrollbarDragging) return;
      if (e.target === terminalScrollbarThumb || e.target === terminalScrollbar) return;
      focusMobileInput();
    });

    // When xterm would receive focus, redirect to hidden input
    terminalContainer.addEventListener('focus', function () {
      focusMobileInput();
    }, true);

    // Compute the common prefix length between two strings
    function commonPrefixLength(a, b) {
      var len = 0;
      while (len < a.length && len < b.length && a[len] === b[len]) {
        len++;
      }
      return len;
    }

    // Count Unicode code points in a string (handles surrogate pairs)
    function codepointCount(str) {
      var count = 0;
      for (var i = 0; i < str.length; i++) {
        count++;
        if (str.charCodeAt(i) >= 0xD800 && str.charCodeAt(i) <= 0xDBFF) {
          i++; // skip low surrogate
        }
      }
      return count;
    }

    // Batched send: accumulates payload across rapid input events (e.g. autocorrect
    // fires deleteContentBackward + insertText ~2ms apart) and flushes in one
    // ws.send() so the PTY receives backspaces + replacement text atomically.
    var sendBuffer = '';
    var sendTimer = null;
    var SEND_DELAY = 10; // ms – enough to batch autocorrect pairs, imperceptible for typing

    function scheduleSend(data) {
      sendBuffer += data;
      if (sendTimer !== null) clearTimeout(sendTimer);
      sendTimer = setTimeout(flushSendBuffer, SEND_DELAY);
    }

    function flushSendBuffer() {
      sendTimer = null;
      if (sendBuffer && ws && ws.readyState === WebSocket.OPEN) {
        dbg('FLUSH: "' + sendBuffer.replace(/\x7f/g, '\u232b') + '" (' + sendBuffer.length + ' bytes)');
        ws.send(sendBuffer);
      }
      sendBuffer = '';
    }

    // Send the diff between lastInputValue and currentValue to the terminal.
    // Handles autocorrect expansions, deletions, and same-length replacements.
    function sendInputDiff(currentValue) {
      if (currentValue === lastInputValue) {
        dbg('sendInputDiff: NO-OP (same)');
        return;
      }

      var commonLen = commonPrefixLength(lastInputValue, currentValue);
      var deletedSlice = lastInputValue.slice(commonLen);
      var charsToDelete = codepointCount(deletedSlice);
      var newChars = currentValue.slice(commonLen);

      dbg('sendInputDiff: del=' + charsToDelete + ' "' + deletedSlice + '" add="' + newChars + '"');

      var payload = '';
      for (var i = 0; i < charsToDelete; i++) {
        payload += '\x7f';
      }
      payload += newChars;
      if (payload) {
        scheduleSend(payload);
      }
    }

    mobileInput.addEventListener('compositionstart', function (e) {
      dbg('COMP_START data="' + e.data + '" val="' + mobileInput.value + '" last="' + lastInputValue + '"');
      isComposing = true;
    });

    mobileInput.addEventListener('compositionupdate', function (e) {
      dbg('COMP_UPDATE data="' + e.data + '" val="' + mobileInput.value + '"');
    });

    mobileInput.addEventListener('compositionend', function (e) {
      dbg('COMP_END data="' + e.data + '" val="' + mobileInput.value + '" last="' + lastInputValue + '"');
      isComposing = false;
      if (ws && ws.readyState === WebSocket.OPEN) {
        var currentValue = mobileInput.value;
        sendInputDiff(currentValue);
        lastInputValue = currentValue;
      }
    });

    mobileInput.addEventListener('blur', function () {
      if (isComposing) {
        isComposing = false;
        lastInputValue = mobileInput.value;
      }
    });

    mobileInput.addEventListener('sessionchange', function () {
      isComposing = false;
      lastInputValue = '';
    });

    // Flush any pending composed text and buffered sends to the terminal.
    function flushComposedText() {
      isComposing = false;
      if (ws && ws.readyState === WebSocket.OPEN) {
        var currentValue = mobileInput.value;
        sendInputDiff(currentValue);
        lastInputValue = currentValue;
      }
      flushSendBuffer();
    }
    function clearInput() {
      mobileInput.value = '';
      lastInputValue = '';
    }
    // Expose for toolbar handler
    mobileInput.flushComposedText = flushComposedText;
    mobileInput.clearInput = clearInput;

    // ── Form submit handler for reliable Enter on mobile ──
    // On Android Chrome with Gboard, keydown fires with key="Unidentified" and
    // keyCode=229 during active composition/prediction (which is nearly always).
    // Wrapping the input in a <form> ensures the browser fires a "submit" event
    // when Enter is pressed, regardless of composition state.
    var inputForm = document.getElementById('mobile-input-form');
    if (inputForm) {
      inputForm.addEventListener('submit', function (e) {
        e.preventDefault();
        dbg('FORM_SUBMIT composing=' + isComposing + ' val="' + mobileInput.value + '"');
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        flushComposedText();
        ws.send('\r');
        mobileInput.value = '';
        lastInputValue = '';
      });
    }

    // Handle text input with autocorrect
    var clearTimer = null;
    mobileInput.addEventListener('beforeinput', function (e) {
      dbg('BEFORE_INPUT type="' + e.inputType + '" data="' + (e.data || '') + '" composing=' + isComposing);
    });

    mobileInput.addEventListener('input', function (e) {
      dbg('INPUT type="' + e.inputType + '" composing=' + isComposing + ' val="' + mobileInput.value + '" last="' + lastInputValue + '"');

      // Reset the auto-clear timer to prevent unbounded growth
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(function () {
        dbg('TIMER_CLEAR val="' + mobileInput.value + '"');
        mobileInput.value = '';
        lastInputValue = '';
      }, 5000);

      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      if (isComposing) {
        dbg('  INPUT: skipped (composing)');
        return;
      }

      var currentValue = mobileInput.value;
      sendInputDiff(currentValue);
      lastInputValue = currentValue;
    });

    // Handle special keys (Enter, Backspace, Escape, arrows, Tab)
    mobileInput.addEventListener('keydown', function (e) {
      dbg('KEYDOWN key="' + e.key + '" shift=' + e.shiftKey + ' composing=' + isComposing + ' val="' + mobileInput.value + '"');
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      var handled = true;

      switch (e.key) {
        case 'Enter':
          flushComposedText();
          if (e.shiftKey) {
            ws.send('\x1b[13;2u'); // kitty protocol: Shift+Enter (newline)
          } else {
            ws.send('\r');
          }
          mobileInput.value = '';
          lastInputValue = '';
          break;
        case 'Backspace':
          if (mobileInput.value.length === 0) {
            // Input is empty, send backspace directly
            ws.send('\x7f');
          }
          // Otherwise, let the input event handle it via diff
          handled = false;
          break;
        case 'Escape':
          ws.send('\x1b');
          mobileInput.value = '';
          lastInputValue = '';
          break;
        case 'Tab':
          ws.send('\t');
          break;
        case 'ArrowUp':
          ws.send('\x1b[A');
          break;
        case 'ArrowDown':
          ws.send('\x1b[B');
          break;
        default:
          handled = false;
      }

      if (handled) {
        e.preventDefault();
      }
    });

  })();

  // ── Keyboard-Aware Viewport ─────────────────────────────────────────────────

  (function () {
    if (!window.visualViewport) return;

    var vv = window.visualViewport;

    function onViewportResize() {
      var keyboardHeight = window.innerHeight - vv.height;
      if (keyboardHeight > 50) {
        mainApp.style.height = vv.height + 'px';
        mobileHeader.style.display = 'none';
      } else {
        mainApp.style.height = '';
        mobileHeader.style.display = '';
      }
      if (fitAddon) {
        fitAddon.fit();
        sendResize();
      }
    }

    vv.addEventListener('resize', onViewportResize);
    vv.addEventListener('scroll', onViewportResize);
  })();

  // ── Update Toast ─────────────────────────────────────────────────────────────

  function checkForUpdates() {
    fetch('/version')
      .then(function (res) {
        if (!res.ok) return;
        return res.json();
      })
      .then(function (data) {
        if (data && data.updateAvailable) {
          showUpdateToast(data.current, data.latest);
        }
      })
      .catch(function () {
        // Silently ignore version check errors
      });
  }

  function showUpdateToast(current, latest) {
    updateToastText.textContent = 'Update available: v' + current + ' \u2192 v' + latest;
    updateToast.hidden = false;
    updateToastBtn.disabled = false;
    updateToastBtn.textContent = 'Update Now';

    updateToastBtn.onclick = function () {
      triggerUpdate(latest);
    };
  }

  function triggerUpdate(latest) {
    updateToastBtn.disabled = true;
    updateToastBtn.textContent = 'Updating\u2026';

    fetch('/update', { method: 'POST' })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok && result.data.restarting) {
          updateToastText.textContent = 'Updated! Restarting server\u2026';
          updateToastBtn.hidden = true;
          updateToastDismiss.hidden = true;
          setTimeout(function () {
            location.reload();
          }, 5000);
        } else if (result.ok) {
          updateToastText.textContent = 'Updated! Please restart the server manually.';
          updateToastBtn.hidden = true;
        } else {
          updateToastText.textContent = 'Update failed: ' + (result.data.error || 'Unknown error');
          updateToastBtn.disabled = false;
          updateToastBtn.textContent = 'Retry';
        }
      })
      .catch(function () {
        updateToastText.textContent = 'Update failed. Please try again.';
        updateToastBtn.disabled = false;
        updateToastBtn.textContent = 'Retry';
      });
  }

  updateToastDismiss.addEventListener('click', function () {
    updateToast.hidden = true;
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
