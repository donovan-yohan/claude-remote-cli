(function () {
  'use strict';

  // State
  var activeSessionId = null;
  var ws = null;
  var term = null;
  var fitAddon = null;

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
    closeSidebar();
    updateSessionTitle();

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
    ])
      .then(function (results) {
        cachedSessions = results[0] || [];
        cachedWorktrees = results[1] || [];
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

  function rootShortName(path) {
    return path.split('/').filter(Boolean).pop() || path;
  }

  function renderUnifiedList() {
    var rootFilter = sidebarRootFilter.value;
    var repoFilter = sidebarRepoFilter.value;
    var textFilter = sessionFilter.value.toLowerCase();

    var filteredSessions = cachedSessions.filter(function (s) {
      if (rootFilter && s.root !== rootFilter) return false;
      if (repoFilter && s.repoName !== repoFilter) return false;
      if (textFilter) {
        var name = (s.displayName || s.repoName || s.worktreeName || s.id).toLowerCase();
        if (name.indexOf(textFilter) === -1) return false;
      }
      return true;
    });

    var activeWorktreePaths = new Set();
    cachedSessions.forEach(function (s) {
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

    sessionList.innerHTML = '';

    filteredSessions.forEach(function (session) {
      sessionList.appendChild(createActiveSessionLi(session));
    });

    if (filteredSessions.length > 0 && filteredWorktrees.length > 0) {
      var divider = document.createElement('li');
      divider.className = 'session-divider';
      divider.textContent = 'Available';
      sessionList.appendChild(divider);
    }

    filteredWorktrees.forEach(function (wt) {
      sessionList.appendChild(createInactiveWorktreeLi(wt));
    });

    highlightActiveSession();
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

    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(subSpan);

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
    nameSpan.textContent = wt.name;
    nameSpan.title = wt.name;

    var subSpan = document.createElement('span');
    subSpan.className = 'session-sub';
    subSpan.textContent = (wt.root ? rootShortName(wt.root) : '') + ' · ' + (wt.repoName || '');

    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(subSpan);

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
    hideContextMenu();
    if (!contextMenuTarget) return;
    startSession(
      contextMenuTarget.repoPath,
      contextMenuTarget.worktreePath,
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

  function startSession(repoPath, worktreePath, claudeArgs) {
    var body = {
      repoPath: repoPath,
      repoName: repoPath.split('/').filter(Boolean).pop(),
    };
    if (worktreePath) body.worktreePath = worktreePath;
    if (claudeArgs) body.claudeArgs = claudeArgs;

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

  newSessionBtn.addEventListener('click', function () {
    customPath.value = '';
    dialogYolo.checked = false;
    populateDialogRootSelect();

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

    dialog.showModal();
  });

  dialogStart.addEventListener('click', function () {
    var path = customPath.value.trim() || dialogRepoSelect.value;
    if (!path) return;
    var args = dialogYolo.checked ? ['--dangerously-skip-permissions'] : undefined;
    startSession(path, undefined, args);
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

  settingsClose.addEventListener('click', function () {
    settingsDialog.close();
    loadRepos();
    refreshAll();
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

  // ── Keyboard-Aware Viewport ─────────────────────────────────────────────────

  (function () {
    if (!window.visualViewport) return;

    var vv = window.visualViewport;

    function onViewportResize() {
      var keyboardHeight = window.innerHeight - vv.height;
      if (keyboardHeight > 50) {
        mainApp.style.height = vv.height + 'px';
      } else {
        mainApp.style.height = '';
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
