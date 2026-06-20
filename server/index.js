const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const config = require('./config');

const PORT = config.PORT;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.CORS_ORIGIN, methods: ['GET', 'POST'] } });
const wss = new WebSocketServer({ server, path: config.WS_PATH });

app.use(express.static('public'));

// WebSocket clients: raw WebSocket for Unity
const wsClients = new Map(); // wsClientId -> { ws, name, gameRef }

const ROOMS = [
  { id: 'command', name: '指揮中心', x: 400, y: 80 },
  { id: 'medical', name: '醫療室', x: 150, y: 240 },
  { id: 'hall', name: '中央大廳', x: 400, y: 240 },
  { id: 'comms', name: '通訊室', x: 650, y: 240 },
  { id: 'power', name: '發電室', x: 400, y: 400 },
  { id: 'warehouse', name: '倉庫', x: 250, y: 510 },
  { id: 'dorm', name: '宿舍', x: 550, y: 510 },
];

const CONNECTIONS = {
  command: ['hall'],
  medical: ['hall'],
  hall: ['command', 'medical', 'comms', 'power'],
  comms: ['hall'],
  power: ['hall', 'warehouse', 'dorm'],
  warehouse: ['power'],
  dorm: ['power'],
};

const ALL_ROLES = {
  invisible: { name: '隱身人', team: 'bad', desc: '可隱身 5 秒並加速刀人，冷卻 40 秒', skill: '隱身' },
  fool: { name: '傻人', team: 'neutral', desc: '被投票出局即獲勝', skill: '無' },
  heartfelt: { name: '真心人', team: 'good', desc: '接觸玩家 5 秒得知陣營，冷卻 30 秒', skill: '真心感應' },
  invincible: { name: '無敵人', team: 'good', desc: '護盾抵擋第一次刀擊', skill: '護盾' },
  police: { name: '警察', team: 'good', desc: '執法：刀壞蛋->壞蛋死、刀好人->自殺', skill: '執法' },
};

const ALPHA_CONFIG = ['invisible', 'fool', 'heartfelt', 'invincible', 'police'];

const roomState = {
  clients: {},
  playerNames: {},
  game: null,
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Game {
  constructor() {
    this.phase = 'lobby';
    this.players = [];
    this.rooms = {};
    this.votes = {};
    this.timers = {};
    this.powerOutage = { active: false, remaining: 0, cooldown: 0 };
    this.emergencyUsed = {};
    this.skillCooldowns = {};
    this.round = 0;
    this.contactTimers = {};
    this.invisibleState = {};
    this.invincibleShields = {};
    this.foolWon = false;
    this.prophetConsecutiveCorrect = 0;
    this.policeUsed = {};
    ROOMS.forEach(r => {
      this.rooms[r.id] = { ...r, players: [], deadBodies: false };
    });
  }

  getAlivePlayers() {
    return this.players.filter(p => p.alive);
  }

  getBadPlayers() {
    return this.players.filter(p => p.team === 'bad' && p.alive);
  }

  getGoodPlayers() {
    return this.players.filter(p => p.team === 'good' && p.alive);
  }

  getNeutralPlayers() {
    return this.players.filter(p => p.team === 'neutral' && p.alive);
  }

  getPlayer(socketId) {
    return this.players.find(p => p.id === socketId);
  }

  getPlayersInRoom(roomId) {
    return this.players.filter(p => p.alive && p.room === roomId);
  }

  getAliveCount() {
    return this.getAlivePlayers().length;
  }

  addPlayer(id, name) {
    if (this.players.length >= 5) return false;
    if (this.players.find(p => p.id === id)) return false;
    this.players.push({
      id, name, number: this.players.length + 1,
      room: 'hall', alive: true, team: null, role: null,
    });
    return true;
  }

  removePlayer(id) {
    this.players = this.players.filter(p => p.id !== id);
  }

  assignRoles() {
    const shuffled = shuffle(ALPHA_CONFIG);
    const spawnRooms = ['hall', 'command', 'medical', 'comms', 'power'];
    this.players.forEach((p, i) => {
      const roleKey = shuffled[i];
      const role = ALL_ROLES[roleKey];
      p.role = roleKey;
      p.team = role.team;
      p.room = spawnRooms[i % spawnRooms.length];
      p.alive = true;
    });
    this.skillCooldowns = {};
    this.emergencyUsed = {};
    this.contactTimers = {};
    this.invisibleState = {};
    this.invincibleShields = {};
    this.policeUsed = {};
    this.players.forEach(p => {
      this.skillCooldowns[p.id] = {};
      this.emergencyUsed[p.id] = false;
      this.invincibleShields[p.id] = true;
      this.policeUsed[p.id] = false;
    });
    this.powerOutage = { active: false, remaining: 0, cooldown: 0 };
    this.round = 1;
    this.foolWon = false;
    this.prophetConsecutiveCorrect = 0;
  }

  startGame() {
    if (this.players.length !== 5) return;
    this.assignRoles();
    this.phase = 'roleReveal';
    this.clearRoomBodies();
    ROOMS.forEach(r => {
      this.rooms[r.id].players = [];
    });
    this.players.forEach(p => {
      if (p.alive) this.rooms[p.room].players.push(p.id);
    });
    this.broadcast();
    this.timers.roleReveal = setTimeout(() => {
      this.phase = 'playing';
      this.broadcast({ type: 'phaseChange', phase: 'playing' });
    }, 4000);
  }

  clearRoomBodies() {
    Object.keys(this.rooms).forEach(k => { this.rooms[k].deadBodies = false; });
  }

  movePlayer(id, targetRoom) {
    const player = this.getPlayer(id);
    if (!player || !player.alive || this.phase !== 'playing') return false;
    const conns = CONNECTIONS[player.room];
    if (!conns || !conns.includes(targetRoom)) return false;
    const idx = this.rooms[player.room].players.indexOf(id);
    if (idx >= 0) this.rooms[player.room].players.splice(idx, 1);
    player.room = targetRoom;
    this.rooms[targetRoom].players.push(id);
    this.broadcast();
    return true;
  }

  killAction(killerId, targetId) {
    const killer = this.getPlayer(killerId);
    const target = this.getPlayer(targetId);
    if (!killer || !target || !killer.alive || !target.alive) return false;
    if (killer.room !== target.room) return false;
    if (this.phase !== 'playing') return false;

    if (killer.team === 'bad') {
      this.executeKill(targetId);
      return true;
    }

    if (killer.role === 'police' && !this.policeUsed[killerId]) {
      this.policeUsed[killerId] = true;
      if (target.team === 'bad' || target.team === 'neutral') {
        this.executeKill(targetId);
        this.broadcast({ type: 'policeResult', success: true, targetRole: ALL_ROLES[target.role].name });
      } else {
        this.executeKill(killerId);
        this.broadcast({ type: 'policeResult', success: false });
      }
      return true;
    }

    return false;
  }

  executeKill(targetId) {
    const target = this.getPlayer(targetId);
    if (!target || !target.alive) return;
    if (this.invincibleShields[targetId]) {
      this.invincibleShields[targetId] = false;
      this.broadcast({ type: 'shieldBreak', playerId: targetId });
      this.broadcast();
      return;
    }
    target.alive = false;
    this.rooms[target.room].deadBodies = true;
    const idx = this.rooms[target.room].players.indexOf(targetId);
    if (idx >= 0) this.rooms[target.room].players.splice(idx, 1);
    this.broadcast({ type: 'kill', targetId });
    this.checkWinCondition();
  }

  useSkill(id, data) {
    const player = this.getPlayer(id);
    if (!player || !player.alive || this.phase !== 'playing') return;
    const now = Date.now();
    const cds = this.skillCooldowns[id] || {};

    switch (player.role) {
      case 'invisible':
        if (data.action === 'invisibility') {
          if (cds.invisibility && cds.invisibility > now) return;
          this.invisibleState[id] = { active: true, remaining: config.INVISIBLE_DURATION };
          this.skillCooldowns[id].invisibility = now + config.INVISIBLE_COOLDOWN * 1000;
          this.broadcast({ type: 'invisibleStart', playerId: id });
          if (this.timers[`invis_${id}`]) clearTimeout(this.timers[`invis_${id}`]);
          this.timers[`invis_${id}`] = setTimeout(() => {
            this.invisibleState[id] = { active: false, remaining: 0 };
            this.broadcast({ type: 'invisibleEnd', playerId: id });
          }, config.INVISIBLE_DURATION * 1000);
        }
        break;

      case 'heartfelt':
        if (data.action === 'sense' && data.targetId) {
          if (cds.sense && cds.sense > now) return;
          const target = this.getPlayer(data.targetId);
          if (!target || !target.alive || target.room !== player.room) return;
          this.skillCooldowns[id].sense = now + 30000;
          const teamNames = { bad: '壞人', good: '好人', neutral: '中立' };
          io.to(id).emit('senseResult', { targetId, team: teamNames[target.team] });
          this.broadcast();
        }
        break;

      case 'police':
        if (data.action === 'execute' && data.targetId) {
          this.killAction(id, data.targetId);
        }
        break;
    }
  }

  reportBody(id) {
    const player = this.getPlayer(id);
    if (!player || !player.alive || this.phase !== 'playing') return;
    if (!this.rooms[player.room].deadBodies) return;
    this.startDiscussion(player.room);
  }

  emergencyMeeting(id) {
    const player = this.getPlayer(id);
    if (!player || !player.alive || this.phase !== 'playing') return;
    if (player.room !== 'hall') return;
    if (this.emergencyUsed[id]) return;
    this.emergencyUsed[id] = true;
    this.startDiscussion('hall');
  }

  startDiscussion(roomId) {
    if (this.phase !== 'playing') return;
    this.phase = 'discussion';
    this.votes = {};
    if (this.timers.discussion) clearTimeout(this.timers.discussion);
    this.broadcast({ type: 'discussionStart', roomId });
    this.timers.discussion = setTimeout(() => {
      this.startVoting();
    }, config.DISCUSSION_TIME * 1000);
  }

  startVoting() {
    if (this.phase !== 'discussion') return;
    this.phase = 'voting';
    this.votes = {};
    this.broadcast({ type: 'votingStart' });
    if (this.timers.voting) clearTimeout(this.timers.voting);
    this.timers.voting = setTimeout(() => {
      this.processVotes();
    }, config.VOTING_TIME * 1000);
  }

  castVote(id, targetId) {
    if (this.phase !== 'voting') return;
    const player = this.getPlayer(id);
    if (!player || !player.alive) return;
    if (this.votes[id]) return;
    this.votes[id] = targetId;
    this.broadcast({ type: 'voteCast', voterId: id });
    const alive = this.getAlivePlayers();
    if (Object.keys(this.votes).length >= alive.length) {
      this.processVotes();
    }
  }

  processVotes() {
    if (this.phase !== 'voting') return;
    if (this.timers.voting) clearTimeout(this.timers.voting);
    this.phase = 'voting_result';
    const tally = {};
    const alive = this.getAlivePlayers();
    alive.forEach(p => { tally[p.id] = 0; });
    tally.skip = 0;

    Object.values(this.votes).forEach(v => {
      if (tally[v] !== undefined) tally[v]++;
      else tally.skip = (tally.skip || 0) + 1;
    });

    let maxVotes = 0;
    let eliminated = null;
    let tie = false;
    Object.entries(tally).forEach(([pid, count]) => {
      if (pid === 'skip') return;
      if (count > maxVotes) {
        maxVotes = count;
        eliminated = pid;
        tie = false;
      } else if (count === maxVotes && count > 0) {
        tie = true;
      }
    });

    if (tie || maxVotes === 0) eliminated = null;

    if (eliminated) {
      const target = this.getPlayer(eliminated);
      if (target) {
        if (target.role === 'fool') {
          this.foolWon = true;
          this.endGame('fool');
          return;
        }
        target.alive = false;
        const idx = this.rooms[target.room].players.indexOf(eliminated);
        if (idx >= 0) this.rooms[target.room].players.splice(idx, 1);
        this.broadcast({ type: 'voteResult', eliminatedId: eliminated });
        this.checkWinCondition();
      }
    } else {
      this.broadcast({ type: 'voteResult', eliminatedId: null });
    }

    if (this.phase !== 'ended') {
      this.timers.result = setTimeout(() => {
        this.phase = 'playing';
        this.round++;
        this.broadcast({ type: 'phaseChange', phase: 'playing' });
      }, 4000);
    }
  }

  togglePowerOutage(id) {
    const player = this.getPlayer(id);
    if (!player || !player.alive) return;
    if (player.team !== 'bad') return;
    const now = Date.now();
    if (this.powerOutage.active) return;
    if (this.powerOutage.cooldown > now) return;
      this.powerOutage.active = true;
    this.powerOutage.remaining = config.POWER_OUTAGE_DURATION;
    this.powerOutage.cooldown = now + config.POWER_OUTAGE_COOLDOWN * 1000;
    this.broadcast({ type: 'powerOutageStart' });
    if (this.timers.powerOutage) clearTimeout(this.timers.powerOutage);
    this.timers.powerOutage = setTimeout(() => {
      this.powerOutage.active = false;
      this.broadcast({ type: 'powerOutageEnd' });
    }, config.POWER_OUTAGE_DURATION * 1000);
  }

  checkWinCondition() {
    const alive = this.getAlivePlayers();
    const bad = alive.filter(p => p.team === 'bad');
    const good = alive.filter(p => p.team === 'good');
    const neutral = alive.filter(p => p.team === 'neutral');

    if (bad.length === 0) {
      this.endGame('good');
      return;
    }
    if (bad.length >= alive.length - neutral.length) {
      this.endGame('bad');
      return;
    }
    if (good.length === 0) {
      this.endGame('bad');
      return;
    }
    if (alive.length === 0) {
      this.endGame('bad');
      return;
    }
    this.broadcast();
  }

  endGame(winner) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    const winnerNames = { good: '好人陣營', bad: '壞蛋陣營', fool: '傻人（中立）' };
    Object.keys(this.timers).forEach(k => {
      if (this.timers[k]) clearTimeout(this.timers[k]);
    });
    this.broadcast({ type: 'gameEnd', winner, winnerName: winnerNames[winner] || winner });
  }

  getStateForPlayer(id) {
    const player = this.getPlayer(id);
    const now = Date.now();
    const rawCds = this.skillCooldowns[id] || {};
    const cdsForClient = {};
    Object.keys(rawCds).forEach(k => {
      const remaining = Math.max(0, Math.ceil((rawCds[k] - now) / 1000));
      if (remaining > 0) cdsForClient[k] = remaining;
    });
    const state = {
      phase: this.phase,
      players: this.players.map(p => {
        const pdata = {
          id: p.id, name: p.name, number: p.number,
          room: p.alive ? p.room : null,
          alive: p.alive, team: null, role: null,
        };
        if (p.id === id) {
          pdata.team = p.team;
          pdata.role = p.role;
        }
        if (player && player.team === 'bad' && p.team === 'bad') {
          pdata.team = 'bad';
        }
        return pdata;
      }),
      rooms: Object.fromEntries(
        Object.entries(this.rooms).map(([k, v]) => {
          const roomData = {
            id: v.id,
            name: v.name,
            x: v.x,
            y: v.y,
            players: v.players.filter(pid => {
              const p = this.getPlayer(pid);
              return p && p.alive;
            }),
            deadBodies: v.deadBodies,
          };
          return [k, roomData];
        })
      ),
      connections: CONNECTIONS,
      powerOutage: {
        active: this.powerOutage.active,
        remaining: this.powerOutage.remaining,
      },
      emergencyUsed: this.emergencyUsed[id] || false,
      skillCooldowns: cdsForClient,
      round: this.round,
      invincibleShield: this.invincibleShields[id],
      policeUsed: this.policeUsed[id] || false,
      votes: this.phase === 'voting' ? Object.keys(this.votes).length : 0,
      totalAlive: this.getAliveCount(),
    };

    if (this.phase === 'voting_result') {
      state.voteResult = {
        votes: this.votes,
        eliminatedId: null,
      };
    }
    return state;
  }

  broadcast(extra) {
    this.players.forEach(p => {
      const state = this.getStateForPlayer(p.id);
      if (extra) Object.assign(state, extra);
      io.to(p.id).emit('gameState', state);
    });
  }
}

function getOrCreateGame() {
  if (!roomState.game || roomState.game.phase === 'ended') {
    roomState.game = new Game();
  }
  return roomState.game;
}

io.on('connection', (socket) => {
  console.log(`[連線] ${socket.id}`);

  socket.on('join', (name) => {
    if (!name || name.trim().length === 0) {
      socket.emit('error', '請輸入玩家名稱');
      return;
    }
    const game = getOrCreateGame();
    if (game.phase !== 'lobby') {
      socket.emit('error', '遊戲已開始');
      return;
    }
    if (game.addPlayer(socket.id, name.trim())) {
      roomState.clients[socket.id] = true;
      roomState.playerNames[socket.id] = name.trim();
      console.log(`[加入] ${name} (${socket.id})`);
      game.broadcast({ type: 'playerJoined' });
    } else {
      socket.emit('error', '遊戲已滿 (5/5)');
    }
  });

  socket.on('startGame', () => {
    const game = roomState.game;
    if (!game || game.phase !== 'lobby') return;
    game.startGame();
    console.log('[遊戲開始]');
  });

  socket.on('move', (roomId) => {
    const game = roomState.game;
    if (!game) return;
    const player = game.getPlayer(socket.id);
    if (!player || !player.alive) return;
    game.movePlayer(socket.id, roomId);
  });

  socket.on('kill', (targetId) => {
    const game = roomState.game;
    if (!game) return;
    game.killAction(socket.id, targetId);
  });

  socket.on('useSkill', (data) => {
    const game = roomState.game;
    if (!game) return;
    game.useSkill(socket.id, data);
  });

  socket.on('reportBody', () => {
    const game = roomState.game;
    if (!game) return;
    game.reportBody(socket.id);
  });

  socket.on('emergencyMeeting', () => {
    const game = roomState.game;
    if (!game) return;
    game.emergencyMeeting(socket.id);
  });

  socket.on('requestVote', () => {
    const game = roomState.game;
    if (!game || game.phase !== 'discussion') return;
    if (game.timers.discussion) clearTimeout(game.timers.discussion);
    game.startVoting();
  });

  socket.on('vote', (targetId) => {
    const game = roomState.game;
    if (!game) return;
    game.castVote(socket.id, targetId === '__skip' ? null : targetId);
  });

  socket.on('chat', (msg) => {
    const game = roomState.game;
    if (!game || (game.phase !== 'discussion' && game.phase !== 'voting')) return;
    const player = game.getPlayer(socket.id);
    if (!player) return;
    io.emit('chat', { playerId: socket.id, name: player.name, message: msg });
  });

  socket.on('powerOutage', () => {
    const game = roomState.game;
    if (!game) return;
    game.togglePowerOutage(socket.id);
  });

  socket.on('cooldownTick', () => {
    const game = roomState.game;
    if (!game) return;
    const player = game.getPlayer(socket.id);
    if (!player) return;
    const cds = game.skillCooldowns[socket.id] || {};
    const now = Date.now();
    Object.keys(cds).forEach(key => {
      if (cds[key] > 0 && cds[key] <= now + 1000) {
        cds[key] = 0;
      }
    });
  });

  socket.on('disconnect', () => {
    const game = roomState.game;
    console.log(`[離線] ${socket.id}`);
    if (game) {
      game.removePlayer(socket.id);
      if (game.players.length === 0 && game.phase !== 'lobby') {
        roomState.game = null;
      } else {
        game.broadcast({ type: 'playerLeft' });
      }
    }
    delete roomState.clients[socket.id];
    delete roomState.playerNames[socket.id];
  });
});

// ====== Raw WebSocket for Unity ======
function wsSend(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function wsBroadcast(data) {
  wsClients.forEach(c => wsSend(c.ws, data));
}

wss.on('connection', (ws) => {
  const wsId = crypto.randomUUID();
  const clientData = { ws, name: null, id: wsId };
  wsClients.set(wsId, clientData);
  console.log(`[WS連線] ${wsId}`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const game = getOrCreateGame();

    // Map WS message types to game actions
    switch (msg.type) {
      case 'join':
        if (!msg.name || msg.name.trim().length === 0) { wsSend(ws, { type: 'error', message: '請輸入玩家名稱' }); return; }
        if (game.phase !== 'lobby') { wsSend(ws, { type: 'error', message: '遊戲已開始' }); return; }
        if (game.addPlayer(wsId, msg.name.trim())) {
          clientData.name = msg.name.trim();
          console.log(`[WS加入] ${msg.name} (${wsId})`);
          wsSend(ws, { type: 'connected', id: wsId });
          game.broadcast({ type: 'playerJoined' });
        } else {
          wsSend(ws, { type: 'error', message: '遊戲已滿 (5/5)' });
        }
        break;

      case 'startGame':
        if (game.phase === 'lobby') {
          game.startGame();
          console.log('[WS遊戲開始]');
        }
        break;

      case 'move':
        if (msg.room) game.movePlayer(wsId, msg.room);
        break;

      case 'kill':
        if (msg.targetId) game.killAction(wsId, msg.targetId);
        break;

      case 'useSkill':
        game.useSkill(wsId, msg.data || {});
        break;

      case 'reportBody':
        game.reportBody(wsId);
        break;

      case 'emergencyMeeting':
        game.emergencyMeeting(wsId);
        break;

      case 'requestVote':
        if (game.phase === 'discussion') {
          if (game.timers.discussion) clearTimeout(game.timers.discussion);
          game.startVoting();
        }
        break;

      case 'vote':
        game.castVote(wsId, msg.targetId === '__skip' ? null : msg.targetId);
        break;

      case 'chat':
        if (msg.message && (game.phase === 'discussion' || game.phase === 'voting')) {
          const player = game.getPlayer(wsId);
          if (player) {
            io.emit('chat', { playerId: wsId, name: player.name, message: msg.message });
            wsBroadcast({ type: 'chat', playerId: wsId, name: player.name, message: msg.message });
          }
        }
        break;

      case 'powerOutage':
        game.togglePowerOutage(wsId);
        break;
    }
  });

  ws.on('close', () => {
    console.log(`[WS離線] ${wsId}`);
    const game = roomState.game;
    if (game) {
      game.removePlayer(wsId);
      if (game.players.length === 0 && game.phase !== 'lobby') {
        roomState.game = null;
      } else {
        game.broadcast({ type: 'playerLeft' });
      }
    }
    wsClients.delete(wsId);
  });
});

// Patch Game.broadcast to also send to WS clients
const origBroadcast = Game.prototype.broadcast;
Game.prototype.broadcast = function (extra) {
  origBroadcast.call(this, extra);
  // Send to WS clients
  this.players.forEach(p => {
    const wsc = wsClients.get(p.id);
    if (wsc && wsc.ws.readyState === 1) {
      const state = this.getStateForPlayer(p.id);
      if (extra) Object.assign(state, extra);
      wsSend(wsc.ws, { type: 'gameState', ...state });
    }
  });
};

server.listen(PORT, config.HOST, () => {
  const host = config.HOST === '0.0.0.0' ? 'localhost' : config.HOST;
  console.log(`\n  🚀 O.C 揪出搗蛋鬼 v1.0`);
  console.log(`  🌐 Web:  http://${host}:${PORT}`);
  console.log(`  🔌 WS:   ws://${host}:${PORT}${config.WS_PATH}`);
  console.log(`  👥 等待 ${config.MAX_PLAYERS} 位玩家加入...\n`);
});
