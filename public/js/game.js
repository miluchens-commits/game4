const socket = io();

let state = null;
let myId = null;
let discussionTimer = 60;
let votingTimer = 30;
let timerInterval = null;
let chatMessages = [];
let myVote = null;
let r3dReady = false;

const COLORS = ['#e53935','#43a047','#1e88e5','#fb8c00','#8e24aa','#00acc1','#6d4c41','#546e7a'];

function $(id) { return document.getElementById(id); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const el = $(id);
  if (el) el.classList.remove('hidden');
}

function showToast(msg, type = 'info', duration = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

// ====== SOCKET EVENTS ======
socket.on('connect', () => {
  myId = socket.id;
  showToast('已連線至伺服器', 'success');
});

socket.on('disconnect', () => {
  showToast('連線中斷', 'error');
});

socket.on('error', (msg) => {
  $('lobbyError').textContent = msg;
  showToast(msg, 'error');
});

socket.on('gameState', (data) => {
  state = data;
  handleState();
});

socket.on('chat', (data) => {
  chatMessages.push(data);
  renderChat();
});

// ====== STATE HANDLER ======
function handleState() {
  if (!state) return;
  const me = state.players.find(p => p.id === myId);
  if (!me && state.phase !== 'lobby') return;

  switch (state.phase) {
    case 'lobby':
      showScreen('lobbyScreen');
      renderLobby();
      break;
    case 'roleReveal':
      showScreen('roleScreen');
      renderRoleReveal();
      break;
    case 'playing':
      showScreen('gameScreen');
      renderGame();
      break;
    case 'discussion':
      showScreen('discussionScreen');
      renderDiscussion();
      break;
    case 'voting':
      showScreen('votingScreen');
      renderVoting();
      break;
    case 'voting_result':
      showScreen('resultScreen');
      renderResult();
      break;
    case 'ended':
      showScreen('endScreen');
      renderEnd();
      break;
  }
}

// ====== LOBBY ======
function renderLobby() {
  const list = $('playersList');
  const players = state.players || [];
  const startBtn = $('startBtn');

  if (players.length === 0) {
    list.innerHTML = '<div class="empty-hint">等待玩家加入...</div>';
  } else {
    list.innerHTML = players.map((p, i) => `
      <div class="player-item">
        <div class="player-number" style="background:${COLORS[i % COLORS.length]}">${i + 1}</div>
        <div class="player-name">${p.name}</div>
        <div class="player-status">✓ 已加入</div>
      </div>
    `).join('');
  }

  const joined = players.some(p => p.id === myId);
  $('joinBtn').disabled = joined || players.length >= 5;
  $('nameInput').disabled = joined;

  startBtn.disabled = players.length < 5;
  startBtn.textContent = players.length === 5 ? '開始遊戲！' : `開始遊戲 (需 ${5 - players.length} 人)`;
}

$('joinBtn').addEventListener('click', () => {
  const name = $('nameInput').value.trim();
  if (!name) { showToast('請輸入名稱', 'error'); return; }
  socket.emit('join', name);
});

$('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('joinBtn').click();
});

$('startBtn').addEventListener('click', () => {
  socket.emit('startGame');
});

// ====== ROLE REVEAL ======
function renderRoleReveal() {
  const me = state.players.find(p => p.id === myId);
  if (!me || !me.role) return;
  const roleData = {
    invisible: { team: 'bad', teamName: '壞蛋陣營', name: '隱身人', desc: '暗殺型角色，可隱身 5 秒並加速移動，於隱身期間刀人', skill: '隱身 · 冷卻 40 秒' },
    fool: { team: 'neutral', teamName: '中立陣營', name: '傻人', desc: '被投票出局即可獲勝，讓大家懷疑你吧！', skill: '無技能' },
    heartfelt: { team: 'good', teamName: '好人陣營', name: '真心人', desc: '持續接觸玩家 5 秒得知對方陣營（好人/壞人/中立）', skill: '真心感應 · 冷卻 30 秒' },
    invincible: { team: 'good', teamName: '好人陣營', name: '無敵人', desc: '護盾抵擋第一次刀擊，討論期間可查看護盾狀態', skill: '護盾 · 被動' },
    police: { team: 'good', teamName: '好人陣營', name: '警察', desc: '執法：刀到壞蛋/中立則對方淘汰；刀到好人則自己淘汰', skill: '執法 · 每局限一次' },
  };
  const rd = roleData[me.role];
  if (rd) {
    $('roleTeamBadge').textContent = rd.teamName;
    $('roleTeamBadge').className = 'role-team-badge ' + rd.team;
    $('roleName').textContent = rd.name;
    $('roleDesc').textContent = rd.desc;
    $('roleSkill').textContent = rd.skill;
  }
}

$('roleConfirmBtn').addEventListener('click', () => {
  showScreen('gameScreen');
  // Wait for server to transition phase to 'playing', then init 3D
  var checkPhase = function () {
    if (state && state.phase === 'playing') {
      handleState();
    } else {
      setTimeout(checkPhase, 200);
    }
  };
  checkPhase();
});

// ====== GAME (3D) ======

function init3D() {
  if (r3dReady) return;
  const container = document.getElementById('mapContainer3d');
  if (!container || !window.R3D) return;
  R3D.init(container);
  R3D.setClickCallback(function(roomId) {
    // E key interaction
    const me = state.players.find(p => p.id === myId);
    if (!me || !me.alive || state.phase !== 'playing') return;
    const myRoom = state.rooms[roomId];
    if (myRoom && myRoom.deadBodies) socket.emit('reportBody');
    if (roomId === 'hall') socket.emit('emergencyMeeting');
  });
  R3D.animate();
  // Poll for room changes from R3D (WASD movement through doorways)
  setInterval(function() {
    if (!R3D || !state) return;
    const r3dRoom = R3D.getCurrentRoom();
    const me = state.players.find(p => p.id === myId);
    if (me && me.alive && r3dRoom && r3dRoom !== me.room) {
      socket.emit('move', r3dRoom);
    }
  }, 500);
  r3dReady = true;
}

function renderGame() {
  if (!state) return;
  const me = state.players.find(p => p.id === myId);
  if (!me) return;

  init3D();
  if (window.R3D && r3dReady) {
    R3D.setRoom(me.room);
  }

  if (me.role) {
    $('phaseInfo').textContent = `第 ${state.round || 1} 回合 · ${getRoleName(me.role)}`;
  }
  $('roundNum').textContent = state.round || 1;

  R3D.setPowerOutage(state.powerOutage && state.powerOutage.active, me.team);
  const ot = document.getElementById('outageText3d');
  if (ot) ot.classList.toggle('hidden', !(state.powerOutage && state.powerOutage.active && me.team !== 'bad'));
  const roomDisp = document.getElementById('currentRoomDisplay');
  if (roomDisp && state.rooms[me.room]) roomDisp.textContent = state.rooms[me.room].name;

  R3D.updatePlayers(state.players, myId);
  R3D.updateRoomBodies(state.rooms);
  R3D.resize();

  // Room players list (sidebar)
  const roomPlayers = state.players.filter(p => p.alive && p.room === me.room);
  if (roomPlayers.length === 0) {
    $('roomPlayers').innerHTML = '<div style="color:#666">無</div>';
  } else {
    $('roomPlayers').innerHTML = roomPlayers.map(p => {
      const isMe = p.id === myId;
      const num = state.players.findIndex(x => x.id === p.id) + 1;
      const color = COLORS[(num - 1) % COLORS.length];
      return `
        <div class="player-in-room">
          <div class="player-dot" style="background:${color}">${num}</div>
          <span>${p.name}${isMe ? ' (我)' : ''}</span>
          <div class="player-actions">
            ${renderPlayerActions(p)}
          </div>
        </div>
      `;
    }).join('');
  }

  renderSkills();

  const myRoom = state.rooms[me.room];
  $('reportBtn').classList.toggle('hidden', !(myRoom && myRoom.deadBodies));
  $('reportBtn').onclick = () => socket.emit('reportBody');

  $('emergencyBtn').classList.toggle('hidden', me.room !== 'hall');
  $('emergencyBtn').disabled = state.emergencyUsed;
  $('emergencyBtn').textContent = state.emergencyUsed ? '已使用拉鈴' : '緊急拉鈴';
  $('emergencyBtn').onclick = () => socket.emit('emergencyMeeting');
}

function getRoleName(roleKey) {
  const names = {
    invisible: '隱身人', fool: '傻人', heartfelt: '真心人',
    invincible: '無敵人', police: '警察'
  };
  return names[roleKey] || roleKey;
}

function getTeamName(team) {
  const names = { good: '好人', bad: '壞蛋', neutral: '中立' };
  return names[team] || team;
}

function renderPlayerActions(p) {
  if (!state) return '';
  const me = state.players.find(x => x.id === myId);
  if (!me || p.id === myId || !p.alive) return '';

  let actions = '';
  if (me.role === 'heartfelt') {
    actions += `<button class="action-btn" onclick="doSkill('sense','${p.id}')">感應</button>`;
  }
  if (me.role === 'police' && !state.policeUsed) {
    actions += `<button class="action-btn" onclick="doSkill('execute','${p.id}')">執法</button>`;
  }
  if (me.team === 'bad' && p.team !== 'bad') {
    actions += `<button class="action-btn" onclick="doKill('${p.id}')">🔪</button>`;
  }
  return actions;
}

function renderSkills() {
  const panel = $('skillPanel');
  const me = state.players.find(p => p.id === myId);
  if (!me) return;

  const cds = state.skillCooldowns || {};

  switch (me.role) {
    case 'invisible':
      panel.innerHTML = `
        <button class="skill-btn" onclick="doSkill('invisibility')" ${cds.invisibility ? 'disabled' : ''}>
          <div class="skill-name">隱身</div>
          <div style="font-size:0.8em;color:#aaa">隱身 5 秒 · 加速 20% · 可潛行刀人</div>
          ${cds.invisibility ? `<div class="skill-cd">冷卻中</div>` : ''}
        </button>
      `;
      break;
    case 'heartfelt':
      panel.innerHTML = `
        <div style="font-size:0.85em;color:#aaa;margin-bottom:8px">對同區域玩家使用「感應」按鈕</div>
        ${cds.sense ? `<div class="skill-cd">冷卻中</div>` : ''}
      `;
      break;
    case 'invincible':
      panel.innerHTML = `
        <div class="skill-btn" style="cursor:default">
          <div class="skill-name">護盾</div>
          <div style="font-size:0.8em;color:${state.invincibleShield ? '#4caf50' : '#f44336'}">
            ${state.invincibleShield ? '✓ 護盾存在' : '✗ 護盾已破碎'}
          </div>
        </div>
      `;
      break;
    case 'police':
      panel.innerHTML = `
        <div style="font-size:0.85em;color:#aaa;margin-bottom:8px">
          對同區域玩家使用「執法」按鈕
          ${state.policeUsed ? '<br><span style="color:#f44336">已使用過</span>' : ''}
        </div>
      `;
      break;
    case 'fool':
      panel.innerHTML = `
        <div class="no-skill">被投票出局即可獲勝</div>
      `;
      break;
    default:
      panel.innerHTML = '<div class="no-skill">無可用技能</div>';
  }

  if (me.team === 'bad') {
    const outageBtn = document.createElement('button');
    outageBtn.className = 'skill-btn';
    outageBtn.innerHTML = `<div class="skill-name">⚡ 全區停電</div><div style="font-size:0.8em;color:#aaa">所有非壞蛋視野縮小 15 秒</div>`;
    if (state.powerOutage && state.powerOutage.active) {
      outageBtn.disabled = true;
      outageBtn.innerHTML += '<div class="skill-cd">執行中</div>';
    }
    outageBtn.onclick = () => socket.emit('powerOutage');
    panel.appendChild(outageBtn);
  }
}

function doSkill(action, targetId) {
  socket.emit('useSkill', { action, targetId });
}

function doKill(targetId) {
  if (confirm('確定要刀掉此玩家？')) {
    socket.emit('kill', targetId);
  }
}



// ====== DISCUSSION ======
function renderDiscussion() {
  startDiscussionTimer();
  renderChat();
  $('startVoteBtn').onclick = () => {
    clearInterval(timerInterval);
    socket.emit('requestVote');
  };
}

$('chatSendBtn').addEventListener('click', () => {
  const input = $('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat', msg);
  input.value = '';
});

$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('chatSendBtn').click();
});

function renderChat() {
  const container = $('chatMessages');
  container.innerHTML = chatMessages.map(msg => {
    const cls = msg.playerId ? '' : 'system';
    return `<div class="chat-msg ${cls}">
      ${msg.playerId ? `<span class="chat-name">${msg.name}:</span>` : ''}
      ${msg.message}
    </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

// ====== VOTING ======
function renderVoting() {
  myVote = null;
  startVotingTimer();
  const container = $('votingPlayers');
  const alive = state.players.filter(p => p.alive);
  container.innerHTML = alive.map(p => {
    const num = state.players.findIndex(x => x.id === p.id) + 1;
    const color = COLORS[(num - 1) % COLORS.length];
    return `
      <div class="vote-card" data-id="${p.id}" onclick="selectVote('${p.id}')">
        <div class="vote-number" style="color:${color}">${num}</div>
        <div class="vote-name">${p.name}</div>
      </div>
    `;
  }).join('');
  $('skipVoteBtn').onclick = () => submitVote(null);
}

function selectVote(id) {
  myVote = id;
  document.querySelectorAll('.vote-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === id);
  });
  submitVote(id);
}

function submitVote(id) {
  socket.emit('vote', id || '__skip');
  showToast('已投票', 'info');
}

// ====== RESULT ======
function renderResult() {
  const eid = state.eliminatedId;
  if (eid) {
    const target = state.players.find(p => p.id === eid);
    if (target) {
      $('resultTitle').textContent = '投票結果';
      $('resultPlayer').textContent = `${target.name} 被淘汰`;
      $('resultDetail').textContent = `號碼牌 ${target.number} · ${getRoleName(target.role)}`;
    }
  } else {
    $('resultTitle').textContent = '投票結果';
    $('resultPlayer').textContent = '平局';
    $('resultDetail').textContent = '無人被淘汰';
  }
  $('continueBtn').onclick = () => {};
}

// ====== END GAME ======
function renderEnd() {
  $('endTitle').textContent = '遊戲結束';
  $('endWinner').textContent = state.winnerName || '---';
  $('endPlayers').innerHTML = state.players.map(p => {
    const num = state.players.findIndex(x => x.id === p.id) + 1;
    const color = COLORS[(num - 1) % COLORS.length];
    return `
      <div class="end-player-row">
        <div class="player-dot" style="background:${color}">${num}</div>
        <span>${p.name}</span>
        <span class="end-role">${getRoleName(p.role)} · ${getTeamName(p.team)}</span>
      </div>
    `;
  }).join('');
  $('playAgainBtn').onclick = () => {
    location.reload();
  };
}

// ====== TIMERS ======
function startDiscussionTimer() {
  discussionTimer = 60;
  $('discussionTimer').textContent = discussionTimer;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    discussionTimer--;
    $('discussionTimer').textContent = Math.max(0, discussionTimer);
    if (discussionTimer <= 0) clearInterval(timerInterval);
  }, 1000);
}

function startVotingTimer() {
  votingTimer = 30;
  $('votingTimer').textContent = votingTimer;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    votingTimer--;
    $('votingTimer').textContent = Math.max(0, votingTimer);
    if (votingTimer <= 0) clearInterval(timerInterval);
  }, 1000);
}

// ====== ROLE EVENTS FROM SERVER ======
socket.on('senseResult', (data) => {
  const target = state.players.find(p => p.id === data.targetId);
  if (target) {
    showToast(`真心感應：${target.name} 是 ${data.team}`, 'info', 4000);
  }
});

socket.on('policeResult', (data) => {
  if (data.success) {
    showToast(`執法成功！目標是 ${data.targetRole}`, 'success', 4000);
  } else {
    showToast('執法失敗！刀到好人了...', 'error', 4000);
  }
});

socket.on('shieldBreak', (data) => {
  if (data.playerId === myId) {
    showToast('你的護盾抵擋了一次攻擊！', 'warn', 4000);
  }
});

socket.on('kill', (data) => {
  const target = state.players.find(p => p.id === data.targetId);
  if (target) {
    showToast(`${target.name} 被淘汰了！`, 'error', 3000);
  }
});

socket.on('powerOutageStart', () => {
  showToast('⚡ 全區停電！持續 15 秒', 'warn', 3000);
});

socket.on('powerOutageEnd', () => {
  showToast('電力已恢復', 'info', 2000);
});

socket.on('discussionStart', (data) => {
  chatMessages = [];
  showToast('🔔 緊急討論開始！', 'warn', 3000);
});

socket.on('votingStart', () => {
  showToast('🗳️ 投票開始！', 'info', 3000);
});

socket.on('voteCast', (data) => {
  // Subtle indicator
});

socket.on('voteResult', (data) => {
  if (data.eliminatedId) {
    const target = state.players.find(p => p.id === data.eliminatedId);
    if (target) {
      showToast(`${target.name} 被投票淘汰！`, 'error', 4000);
    }
  } else {
    showToast('平局，無人被淘汰', 'info', 3000);
  }
});

socket.on('phaseChange', (data) => {
  showToast(`進入階段：${data.phase}`, 'info', 2000);
});

socket.on('invisibleStart', (data) => {
  if (data.playerId === myId) {
    showToast('你已進入隱身狀態！持續 5 秒', 'info', 3000);
  }
});

socket.on('invisibleEnd', (data) => {
  if (data.playerId === myId) {
    showToast('隱身狀態結束', 'info', 2000);
  }
});

socket.on('gameEnd', (data) => {
  // state updates handle this
});

// ====== WINDOW EVENTS ======
window.addEventListener('resize', () => {
  if (window.R3D) R3D.resize();
});


