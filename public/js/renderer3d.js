var R3D = {};

(function () {
  var scene, camera, renderer, container;
  var yaw = 0, pitch = 0;
  var keys = {};
  var playerPos = new THREE.Vector3(0, 1.3, 0);
  var currentRoomId = 'hall';
  var roomMeshes = {}, playerMeshes = {};
  var clickCallback = null, animating = false;
  var moveSpeed = 5, mouseSens = 0.003;
  var isLocked = false;
  var spotLight, dirLight, ambLight, hemi;
  var transitionProgress = -1;
  var transitionFrom = null, transitionTo = null;
  var transitionStartPos = new THREE.Vector3(), transitionEndPos = new THREE.Vector3();
  var lockInstructionEl = null;
  var cssRenderer = null;
  var lastTime = 0;

  var ROOM_SIZE = 4, HALF_ROOM = 2, CLAMP = 1.95, WALL_H = 3;

  var ROOM_CFG = {
    command: { x: 0, z: -9 }, medical: { x: -6, z: 0 },
    hall: { x: 0, z: 0 }, comms: { x: 6, z: 0 },
    warehouse: { x: -6, z: 6 }, power: { x: 0, z: 6 }, dorm: { x: 6, z: 6 },
  };

  var SPAWN_ROOMS = {
    1: 'hall', 2: 'command', 3: 'medical', 4: 'comms', 5: 'power',
  };

  var RAINBOW = {
    command: 0xff1744, medical: 0xff9100, hall: 0xffea00,
    comms: 0x00e676, power: 0x2979ff, warehouse: 0x651fff, dorm: 0xd500f9,
  };

  var PLAYER_COLORS = [0xe53935, 0x43a047, 0x1e88e5, 0xfb8c00, 0x8e24aa];

  var ROOM_CONNS = {
    hall: ['command', 'medical', 'comms', 'power'],
    command: ['hall'], medical: ['hall'], comms: ['hall'],
    power: ['hall', 'warehouse', 'dorm'], warehouse: ['power'], dorm: ['power'],
  };

  var ROOM_NAMES = {
    command: '指揮中心', medical: '醫療室', hall: '中央大廳',
    comms: '通訊室', power: '發電室', warehouse: '倉庫', dorm: '宿舍',
  };

  R3D.init = function (el) {
    container = el;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);

    var w = container.clientWidth, h = container.clientHeight;
    camera = new THREE.PerspectiveCamera(75, w / h, 0.05, 40);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    container.appendChild(renderer.domElement);

    ambLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambLight);
    dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(10, 20, 5);
    scene.add(dirLight);
    hemi = new THREE.HemisphereLight(0x87ceeb, 0x98fb98, 0.6);
    scene.add(hemi);
    spotLight = new THREE.SpotLight(0x88bbff, 8, 15, Math.PI / 4, 0.5, 1);
    spotLight.position.set(0, 12, 0);
    spotLight.target.position.set(0, 0, 0);
    spotLight.visible = false;
    scene.add(spotLight);
    scene.add(spotLight.target);

    var groundMat = new THREE.MeshStandardMaterial({ color: 0x90ee90, roughness: 0.8 });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    R3D.buildMap();
    setupControls();
  };

  R3D.buildMap = function () {
    Object.entries(ROOM_CFG).forEach(function (_a) { buildRoom(_a[0], _a[1]); });
    // Build corridor paths between connected rooms
    Object.keys(ROOM_CONNS).forEach(function (from) {
      ROOM_CONNS[from].forEach(function (to) {
        if (from < to) buildPath(from, to);
      });
    });
  };

  function buildPath(from, to) {
    var a = ROOM_CFG[from], b = ROOM_CFG[to];
    var dx = b.x - a.x, dz = b.z - a.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 4.1) return;

    var pathW = 1.5;
    var pMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.7 });

    if (Math.abs(dx) > Math.abs(dz)) {
      var left = Math.min(a.x, b.x) + HALF_ROOM;
      var right = Math.max(a.x, b.x) - HALF_ROOM;
      var pLen = right - left;
      if (pLen < 0.3) return;
      var p = new THREE.Mesh(new THREE.BoxGeometry(pLen, 0.1, pathW), pMat);
      p.position.set((left + right) / 2, 0.05, a.z);
      p.receiveShadow = true;
      scene.add(p);
    } else {
      var bot = Math.min(a.z, b.z) + HALF_ROOM;
      var top = Math.max(a.z, b.z) - HALF_ROOM;
      var pLen = top - bot;
      if (pLen < 0.3) return;
      var p = new THREE.Mesh(new THREE.BoxGeometry(pathW, 0.1, pLen), pMat);
      p.position.set(a.x, 0.05, (bot + top) / 2);
      p.receiveShadow = true;
      scene.add(p);
    }
  }

  function buildRoom(id, pos) {
    var color = RAINBOW[id] || 0x888888;
    var cObj = new THREE.Color(color);
    var room = new THREE.Group();
    room.position.set(pos.x, 0, pos.z);

    var fMat = new THREE.MeshStandardMaterial({ color: cObj, roughness: 0.4, metalness: 0.1, emissive: cObj, emissiveIntensity: 0.15 });
    var floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE, 0.1, ROOM_SIZE), fMat);
    floor.position.y = 0.05;
    floor.receiveShadow = true;
    room.add(floor);

    var cMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.3, transparent: true, opacity: 0.15 });
    var ceil = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE + 0.4, 0.05, ROOM_SIZE + 0.4), cMat);
    ceil.position.y = WALL_H;
    room.add(ceil);

    var wallBright = cObj.clone().lerp(new THREE.Color(0xffffff), 0.3);
    var wMat = new THREE.MeshStandardMaterial({ color: wallBright, roughness: 0.4, metalness: 0.1 });
    var conns = ROOM_CONNS[id] || [];
    var dirs = [
      { axis: 'z', sign: -1, connCheck: function (to) { return ROOM_CFG[to] && ROOM_CFG[to].z < pos.z; } },
      { axis: 'z', sign: 1, connCheck: function (to) { return ROOM_CFG[to] && ROOM_CFG[to].z > pos.z; } },
      { axis: 'x', sign: -1, connCheck: function (to) { return ROOM_CFG[to] && ROOM_CFG[to].x < pos.x; } },
      { axis: 'x', sign: 1, connCheck: function (to) { return ROOM_CFG[to] && ROOM_CFG[to].x > pos.x; } },
    ];

    dirs.forEach(function (d) {
      var hasDoor = conns.some(d.connCheck);
      var doorW = 1.0, doorH = 2.0;
      var hdw = doorW / 2;
      if (d.axis === 'z') {
        var wz = d.sign * HALF_ROOM;
        if (hasDoor) {
          // Left piece: from -HALF_ROOM to -doorW/2
          addWall(room, new THREE.Vector3(-(HALF_ROOM + hdw) / 2, WALL_H / 2, wz), new THREE.Vector3(HALF_ROOM - hdw, WALL_H, 0.1), wMat);
          // Right piece: from doorW/2 to HALF_ROOM
          addWall(room, new THREE.Vector3((HALF_ROOM + hdw) / 2, WALL_H / 2, wz), new THREE.Vector3(HALF_ROOM - hdw, WALL_H, 0.1), wMat);
          // Top piece: above door
          addWall(room, new THREE.Vector3(0, (WALL_H + doorH) / 2, wz), new THREE.Vector3(doorW, WALL_H - doorH, 0.1), wMat);
        } else {
          addWall(room, new THREE.Vector3(0, WALL_H / 2, wz), new THREE.Vector3(ROOM_SIZE, WALL_H, 0.1), wMat);
        }
      } else {
        var wx = d.sign * HALF_ROOM;
        if (hasDoor) {
          // Bottom piece: from -HALF_ROOM to -doorW/2
          addWall(room, new THREE.Vector3(wx, WALL_H / 2, -(HALF_ROOM + hdw) / 2), new THREE.Vector3(0.1, WALL_H, HALF_ROOM - hdw), wMat);
          // Top piece: from doorW/2 to HALF_ROOM
          addWall(room, new THREE.Vector3(wx, WALL_H / 2, (HALF_ROOM + hdw) / 2), new THREE.Vector3(0.1, WALL_H, HALF_ROOM - hdw), wMat);
          // Top piece: above door
          addWall(room, new THREE.Vector3(wx, (WALL_H + doorH) / 2, 0), new THREE.Vector3(0.1, WALL_H - doorH, doorW), wMat);
        } else {
          addWall(room, new THREE.Vector3(wx, WALL_H / 2, 0), new THREE.Vector3(0.1, WALL_H, ROOM_SIZE), wMat);
        }
      }
    });

    var rl = new THREE.PointLight(0xffffff, 1.2, 8);
    rl.position.set(0, WALL_H - 0.3, 0);
    room.add(rl);

    var bodyGrp = new THREE.Group();
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1 }));
    body.position.set(0, 0.1, -1);
    bodyGrp.add(body);
    bodyGrp.visible = false;
    room.add(bodyGrp);

    var ld = document.createElement('div');
    ld.textContent = ROOM_NAMES[id] || id;
    ld.style.cssText = 'color:#fff;font-size:12px;font-weight:700;font-family:"Noto Sans TC",sans-serif;text-shadow:0 0 15px rgba(0,0,0,0.8);background:rgba(0,0,0,0.3);padding:2px 12px;border-radius:4px;letter-spacing:1px;border:1px solid rgba(255,255,255,0.2);pointer-events:none;';
    var label = new THREE.CSS2DObject(ld);
    label.position.set(0, WALL_H + 0.3, 0);
    room.add(label);

    if (id === 'hall') {
      var eb = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.15, 12), new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 1 }));
      eb.position.set(0, 0.2, 1.5);
      room.add(eb);
    }

    scene.add(room);
    roomMeshes[id] = { group: room, pos: pos, bodyGrp: bodyGrp };
  }

  function addWall(parent, pos, scale, mat) {
    var wall = new THREE.Mesh(new THREE.BoxGeometry(scale.x, scale.y, scale.z), mat);
    wall.position.copy(pos);
    wall.castShadow = true;
    parent.add(wall);
  }

  function setupControls() {
    document.addEventListener('keydown', function (e) { keys[e.key.toLowerCase()] = true; if (e.key.toLowerCase() === 'e') onInteract(); });
    document.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isLocked) document.exitPointerLock(); });

    renderer.domElement.addEventListener('click', function () {
      if (!isLocked) renderer.domElement.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', function () {
      isLocked = document.pointerLockElement === renderer.domElement;
      if (isLocked && lockInstructionEl) lockInstructionEl.style.display = 'none';
    });

    document.addEventListener('mousemove', function (e) {
      if (!isLocked) return;
      yaw -= e.movementX * mouseSens;
      pitch -= e.movementY * mouseSens;
      pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));
    });

    lockInstructionEl = document.createElement('div');
    lockInstructionEl.textContent = '點擊畫面以控制視角 - WASD 移動 - Shift 衝刺';
    lockInstructionEl.style.cssText = 'position:absolute;bottom:40%;left:50%;transform:translateX(-50%);color:#fff;font-size:18px;font-weight:700;font-family:"Noto Sans TC",sans-serif;background:rgba(0,0,0,0.6);padding:12px 28px;border-radius:10px;border:2px solid rgba(255,255,255,0.3);pointer-events:none;z-index:20;text-align:center;';
    container.appendChild(lockInstructionEl);
  }

  function getWallPos(a, b) {
    var dx = b.x - a.x, dz = b.z - a.z;
    if (Math.abs(dx) > Math.abs(dz)) {
      return { x: a.x + (dx > 0 ? HALF_ROOM : -HALF_ROOM), z: a.z };
    } else {
      return { x: a.x, z: a.z + (dz > 0 ? HALF_ROOM : -HALF_ROOM) };
    }
  }

  R3D.setRoom = function (roomId) {
    var r = ROOM_CFG[roomId];
    if (!r) return;
    currentRoomId = roomId;
    playerPos.set(r.x, 1.3, r.z);
    camera.position.copy(playerPos);
    yaw = 0;
    pitch = 0;
  };

  function updatePlayer(dt) {
    if (!dt || dt > 0.1) dt = 0.016;

    if (transitionProgress >= 0) {
      transitionProgress += dt * 0.8;
      if (transitionProgress >= 1) {
        transitionProgress = -1;
        currentRoomId = transitionTo;
        var toRoom = ROOM_CFG[transitionTo];
        playerPos.set(toRoom.x, 1.3, toRoom.z);
      } else {
        var t = transitionProgress;
        t = t * t * (3 - 2 * t);
        playerPos.lerpVectors(transitionStartPos, transitionEndPos, t);
      }
      camera.position.copy(playerPos);
      return;
    }

    var forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    var right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    var move = new THREE.Vector3();
    if (keys['w']) move.add(forward);
    if (keys['s']) move.sub(forward);
    if (keys['a']) move.sub(right);
    if (keys['d']) move.add(right);
    if (move.length() > 0) {
      move.normalize().multiplyScalar(moveSpeed * dt);
      if (keys['shift']) move.multiplyScalar(1.6);
    }
    playerPos.add(move);

    var roomData = ROOM_CFG[currentRoomId];
    if (roomData) {
      playerPos.x = Math.max(roomData.x - CLAMP, Math.min(roomData.x + CLAMP, playerPos.x));
      playerPos.z = Math.max(roomData.z - CLAMP, Math.min(roomData.z + CLAMP, playerPos.z));
    }
    playerPos.y = 1.3;
    camera.position.copy(playerPos);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    var conns = ROOM_CONNS[currentRoomId] || [];
    for (var i = 0; i < conns.length; i++) {
      var to = conns[i];
      var tp = ROOM_CFG[to], cp = ROOM_CFG[currentRoomId];
      if (!tp || !cp) continue;
      var wall = getWallPos(cp, tp);
      var dx = playerPos.x - wall.x;
      var dz = playerPos.z - wall.z;
      if (dx * dx + dz * dz < 0.09) {
        transitionFrom = currentRoomId;
        transitionTo = to;
        transitionStartPos.copy(playerPos);
        transitionEndPos.set(tp.x, 1.3, tp.z);
        transitionProgress = 0;
        break;
      }
    }

    if (spotLight.visible) {
      spotLight.target.position.copy(playerPos);
      spotLight.target.position.y = 0;
      spotLight.position.set(playerPos.x, 12, playerPos.z);
    }
  }

  function onInteract() {
    if (clickCallback) clickCallback(currentRoomId);
  }

  function createAvatar(p) {
    var num = p.number, color = PLAYER_COLORS[(num - 1) % PLAYER_COLORS.length];
    var grp = new THREE.Group();
    var bMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.3, metalness: 0.2 });
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.6, 8), bMat);
    body.position.y = 0.5; grp.add(body);
    var tMat = new THREE.MeshStandardMaterial({ color: 0x4444aa });
    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.2), tMat);
    torso.position.y = 0.35; grp.add(torso);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffccaa }));
    head.position.y = 0.9; grp.add(head);
    var ndiv = document.createElement('div');
    ndiv.textContent = num;
    ndiv.style.cssText = 'color:#fff;font-size:12px;font-weight:900;font-family:sans-serif;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;background:#' + color.toString(16).padStart(6, '0') + ';box-shadow:0 2px 8px rgba(0,0,0,0.5);';
    var numLabel = new THREE.CSS2DObject(ndiv);
    numLabel.position.y = 1.3; grp.add(numLabel);
    var ndiv2 = document.createElement('div');
    ndiv2.textContent = p.name;
    ndiv2.style.cssText = 'color:#fff;font-size:9px;font-weight:700;font-family:"Noto Sans TC",sans-serif;text-shadow:0 0 5px rgba(0,0,0,0.8);background:rgba(0,0,0,0.4);padding:1px 5px;border-radius:2px;white-space:nowrap;pointer-events:none;';
    var nameLabel = new THREE.CSS2DObject(ndiv2);
    nameLabel.position.y = 1.5; grp.add(nameLabel);
    scene.add(grp);
    playerMeshes[p.id] = { group: grp };
  }

  R3D.updatePlayers = function (players, myId) {
    Object.keys(playerMeshes).forEach(function (id) {
      if (!players.some(function (p) { return p.id === id; })) { scene.remove(playerMeshes[id].group); delete playerMeshes[id]; }
    });
    players.forEach(function (p, idx) {
      if (!playerMeshes[p.id]) createAvatar(p);
      var d = playerMeshes[p.id];
      if (!p.alive) { d.group.visible = false; return; }
      d.group.visible = p.id !== myId && p.alive;
      var pos = ROOM_CFG[p.room] || ROOM_CFG['hall'];
      var tx = pos.x + (idx % 3 - 1) * 0.4, tz = pos.z + Math.floor(idx / 3) * 0.4;
      d.group.position.x += (tx - d.group.position.x) * 0.15;
      d.group.position.z += (tz - d.group.position.z) * 0.15;
      d.group.position.y = 0;
    });
  };

  R3D.updateRoomBodies = function (rooms) {
    Object.entries(roomMeshes).forEach(function (_a) {
      _a[1].bodyGrp.visible = rooms && rooms[_a[0]] && rooms[_a[0]].deadBodies;
    });
  };

  R3D.setPowerOutage = function (active, team) {
    if (active && team !== 'bad') {
      scene.background = new THREE.Color(0x000011);
      ambLight.intensity = 0.05; dirLight.intensity = 0.05;
      spotLight.visible = true;
    } else {
      scene.background = new THREE.Color(0x87ceeb);
      ambLight.intensity = 1.2; dirLight.intensity = 1.5;
      spotLight.visible = false;
    }
  };

  R3D.animate = function () {
    if (animating) return;
    animating = true;
    cssRenderer = new THREE.CSS2DRenderer();
    cssRenderer.setSize(container.clientWidth, container.clientHeight);
    cssRenderer.domElement.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    container.appendChild(cssRenderer.domElement);
    lastTime = performance.now();
    function loop(time) {
      requestAnimationFrame(loop);
      var dt = (time - lastTime) / 1000; lastTime = time;
      updatePlayer(dt);
      if (container && container.offsetParent !== null) {
        renderer.render(scene, camera);
        cssRenderer.render(scene, camera);
      }
    }
    loop(lastTime);
  };

  R3D.resize = function () {
    if (!container || !camera || !renderer) return;
    var w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (cssRenderer) cssRenderer.setSize(w, h);
  };

  R3D.setClickCallback = function (cb) { clickCallback = cb; };
  R3D.getCurrentRoom = function () { return currentRoomId; };
})();

window.R3D = R3D;
