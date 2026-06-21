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
  var transitionTo = null;
  var transitionStartPos = new THREE.Vector3(), transitionEndPos = new THREE.Vector3();
  var lockInstructionEl = null;
  var cssRenderer = null;
  var lastTime = 0;

  var ROOM_SIZE = 5, HALF_ROOM = 2.5, CLAMP = 2.45, WALL_H = 3;

  var ROOM_CFG = {
    command:  { x: 0,   z: -13 },
    medical:  { x: -10, z: -4 },
    hall:     { x: 0,   z: -4 },
    comms:    { x: 12,  z: -4 },
    power:    { x: -1,  z: 7 },
    warehouse:{ x: -10, z: 13 },
    dorm:     { x: 9,   z: 13 },
  };

  var WALL_COLORS = {
    command: 0xfff8e7, medical: 0xfff8e7, hall: 0xfff8e7,
    comms: 0xfff8e7, power: 0xfff8e7, warehouse: 0xfff8e7, dorm: 0xfff8e7,
  };

  var FLOOR_COLORS = {
    command: 0x8b6914, medical: 0xffffff, hall: 0xc8b898,
    comms: 0x546e7a, power: 0x616161, warehouse: 0x9e9e9e, dorm: 0x8d6e63,
  };

  var ACCENT_COLORS = {
    command: 0x8b0000, medical: 0xff6b6b, hall: 0x1565c0,
    comms: 0x7b1fa2, power: 0xef6c00, warehouse: 0x546e7a, dorm: 0x2e7d32,
  };

  var PLAYER_COLORS = [0xe53935, 0x43a047, 0x1e88e5, 0xfb8c00, 0x8e24aa];

  var ROOM_CONNS = {
    hall: ['command', 'medical', 'comms', 'power'],
    command: ['hall'], medical: ['hall'], comms: ['hall'],
    power: ['hall', 'warehouse', 'dorm'], warehouse: ['power'], dorm: ['power'],
  };

  var ROOM_DISPLAY = {
    command: '校長室', medical: '保健室', hall: '穿堂',
    comms: '視聽教室', power: '體育器材室', warehouse: '儲藏室', dorm: '音樂教室',
  };

  R3D.init = function (el) {
    container = el;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 25, 40);

    var w = container.clientWidth, h = container.clientHeight;
    camera = new THREE.PerspectiveCamera(75, w / h, 0.05, 45);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    container.appendChild(renderer.domElement);

    ambLight = new THREE.AmbientLight(0xffeedd, 0.9);
    scene.add(ambLight);
    dirLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    dirLight.position.set(15, 25, 10);
    scene.add(dirLight);
    hemi = new THREE.HemisphereLight(0x87ceeb, 0x98fb98, 0.5);
    scene.add(hemi);
    spotLight = new THREE.SpotLight(0x88bbff, 8, 15, Math.PI / 4, 0.5, 1);
    spotLight.position.set(0, 12, 0);
    spotLight.target.position.set(0, 0, 0);
    spotLight.visible = false;
    scene.add(spotLight);
    scene.add(spotLight.target);

    buildGround();
    R3D.buildMap();
    buildOutdoorDecor();
    setupControls();
  };

  function buildGround() {
    var gMat = new THREE.MeshStandardMaterial({ color: 0x7ec850, roughness: 0.9 });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), gMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  R3D.buildMap = function () {
    Object.entries(ROOM_CFG).forEach(function (_a) { buildRoom(_a[0], _a[1]); });
    Object.keys(ROOM_CONNS).forEach(function (from) {
      ROOM_CONNS[from].forEach(function (to) {
        if (from < to) buildPath(from, to);
      });
    });
  };

  function getDoorPos(aId, bId) {
    var a = ROOM_CFG[aId], b = ROOM_CFG[bId];
    if (!a || !b) return null;
    var dx = b.x - a.x, dz = b.z - a.z;
    if (Math.abs(dx) > Math.abs(dz)) {
      return { x: a.x + (dx > 0 ? HALF_ROOM : -HALF_ROOM), z: a.z };
    } else {
      return { x: a.x, z: a.z + (dz > 0 ? HALF_ROOM : -HALF_ROOM) };
    }
  }

  function buildPath(from, to) {
    var dA = getDoorPos(from, to), dB = getDoorPos(to, from);
    if (!dA || !dB) return;

    var dx = dB.x - dA.x, dz = dB.z - dA.z;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.3) return;

    var mx = (dA.x + dB.x) / 2, mz = (dA.z + dB.z) / 2;
    var ang = Math.atan2(dx, dz);

    var pMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.8 });
    var path = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, len), pMat);
    path.position.set(mx, 0.04, mz);
    path.rotation.y = ang;
    path.receiveShadow = true;
    scene.add(path);

    var lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 });
    var dash = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, len - 0.6), lineMat);
    dash.position.set(mx + Math.cos(ang + Math.PI / 2) * 0.4, 0.08, mz + Math.sin(ang + Math.PI / 2) * 0.4);
    dash.rotation.y = ang;
    scene.add(dash);

    var sideMat = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.7 });
    [-1, 1].forEach(function (side) {
      var sx = Math.cos(ang + Math.PI / 2) * side * 1.15;
      var sz = Math.sin(ang + Math.PI / 2) * side * 1.15;
      for (var d = 0.4; d < len - 0.3; d += 1.2) {
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.4, 6), sideMat);
        post.position.set(mx + sx + Math.sin(ang) * (d - len / 2), 0.2, mz + sz - Math.cos(ang) * (d - len / 2));
        scene.add(post);
      }
    });
  }

  function buildRoom(id, pos) {
    var wallColor = WALL_COLORS[id] || 0xfff8e7;
    var accent = ACCENT_COLORS[id] || 0x888888;
    var floorColor = FLOOR_COLORS[id] || 0xc8b898;
    var room = new THREE.Group();
    room.position.set(pos.x, 0, pos.z);

    buildFloor(room, floorColor, accent);
    buildCeiling(room);
    buildWalls(room, id, pos, wallColor, accent);
    addCeilingLight(room, accent);
    addDecor(room, id, accent);
    addRoomLabel(room, id);

    scene.add(room);
    roomMeshes[id] = { group: room, pos: pos, bodyGrp: null };

    var bMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1 });
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), bMat);
    body.position.set(0, 0.1, -1.5);
    var bodyGrp = new THREE.Group();
    bodyGrp.add(body);
    bodyGrp.visible = false;
    room.add(bodyGrp);
    roomMeshes[id].bodyGrp = bodyGrp;
  }

  function buildFloor(room, baseColor, accent) {
    var tileMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.6 });
    var groutMat = new THREE.MeshStandardMaterial({ color: 0xbbb0a0, roughness: 0.8 });
    for (var tx = -2; tx <= 2; tx += 1) {
      for (var tz = -2; tz <= 2; tz += 1) {
        var alt = (tx + tz) % 2 === 0;
        var c = alt ? baseColor : 0xddd5c8;
        var tMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
        var tile = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.06, 0.88), tMat);
        tile.position.set(tx, 0.03, tz);
        tile.receiveShadow = true;
        room.add(tile);
      }
    }
    var bMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
    var brd = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE + 0.2, 0.04, 0.12), bMat);
    brd.position.set(0, 0.07, HALF_ROOM + 0.06);
    room.add(brd);
    brd = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE + 0.2, 0.04, 0.12), bMat);
    brd.position.set(0, 0.07, -HALF_ROOM - 0.06);
    room.add(brd);
    brd = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, ROOM_SIZE + 0.2), bMat);
    brd.position.set(HALF_ROOM + 0.06, 0.07, 0);
    room.add(brd);
    brd = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, ROOM_SIZE + 0.2), bMat);
    brd.position.set(-HALF_ROOM - 0.06, 0.07, 0);
    room.add(brd);
  }

  function buildCeiling(room) {
    var cMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.15 });
    var ceil = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE + 0.4, 0.05, ROOM_SIZE + 0.4), cMat);
    ceil.position.y = WALL_H;
    room.add(ceil);
  }

  function buildWalls(room, id, pos, wallColor, accent) {
    var wMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.5 });
    var baseMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.6 });
    var frameMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
    var conns = ROOM_CONNS[id] || [];
    var dirs = [
      { axis: 'z', sign: -1, connCheck: function (to) { return ROOM_CFG[to] && ROOM_CFG[to].z < pos.z; } },
      { axis: 'z', sign: 1, connCheck: function (to) { return ROOM_CFG[to] && ROOM_CFG[to].z > pos.z; } },
      { axis: 'x', sign: -1, connCheck: function (to) { return ROOM_CFG[to] && ROOM_CFG[to].x < pos.x; } },
      { axis: 'x', sign: 1, connCheck: function (to) { return ROOM_CFG[to] && ROOM_CFG[to].x > pos.x; } },
    ];

    dirs.forEach(function (d) {
      var hasDoor = conns.some(d.connCheck);
      var doorW = 1.2, doorH = 2.0;
      var hdw = doorW / 2;
      if (d.axis === 'z') {
        var wz = d.sign * HALF_ROOM;
        if (hasDoor) {
          addWall(room, new THREE.Vector3(-(HALF_ROOM + hdw) / 2, WALL_H / 2, wz), new THREE.Vector3(HALF_ROOM - hdw, WALL_H, 0.1), wMat);
          addWall(room, new THREE.Vector3((HALF_ROOM + hdw) / 2, WALL_H / 2, wz), new THREE.Vector3(HALF_ROOM - hdw, WALL_H, 0.1), wMat);
          addWall(room, new THREE.Vector3(0, (WALL_H + doorH) / 2, wz), new THREE.Vector3(doorW, WALL_H - doorH, 0.1), wMat);
          addWall(room, new THREE.Vector3(0, 0.1, wz), new THREE.Vector3(ROOM_SIZE, 0.12, 0.12), baseMat);
          addWall(room, new THREE.Vector3(-hdw - 0.06, doorH / 2, wz), new THREE.Vector3(0.08, doorH, 0.16), frameMat);
          addWall(room, new THREE.Vector3(hdw + 0.06, doorH / 2, wz), new THREE.Vector3(0.08, doorH, 0.16), frameMat);
          addWall(room, new THREE.Vector3(0, doorH + 0.04, wz), new THREE.Vector3(doorW + 0.12, 0.08, 0.16), frameMat);
        } else {
          addWall(room, new THREE.Vector3(0, WALL_H / 2, wz), new THREE.Vector3(ROOM_SIZE, WALL_H, 0.1), wMat);
          addWall(room, new THREE.Vector3(0, 0.1, wz), new THREE.Vector3(ROOM_SIZE, 0.12, 0.12), baseMat);
        }
      } else {
        var wx = d.sign * HALF_ROOM;
        if (hasDoor) {
          addWall(room, new THREE.Vector3(wx, WALL_H / 2, -(HALF_ROOM + hdw) / 2), new THREE.Vector3(0.1, WALL_H, HALF_ROOM - hdw), wMat);
          addWall(room, new THREE.Vector3(wx, WALL_H / 2, (HALF_ROOM + hdw) / 2), new THREE.Vector3(0.1, WALL_H, HALF_ROOM - hdw), wMat);
          addWall(room, new THREE.Vector3(wx, (WALL_H + doorH) / 2, 0), new THREE.Vector3(0.1, WALL_H - doorH, doorW), wMat);
          addWall(room, new THREE.Vector3(wx, 0.1, 0), new THREE.Vector3(0.12, 0.12, ROOM_SIZE), baseMat);
          addWall(room, new THREE.Vector3(wx, doorH / 2, -hdw - 0.06), new THREE.Vector3(0.16, doorH, 0.08), frameMat);
          addWall(room, new THREE.Vector3(wx, doorH / 2, hdw + 0.06), new THREE.Vector3(0.16, doorH, 0.08), frameMat);
          addWall(room, new THREE.Vector3(wx, doorH + 0.04, 0), new THREE.Vector3(0.16, 0.08, doorW + 0.12), frameMat);
        } else {
          addWall(room, new THREE.Vector3(wx, WALL_H / 2, 0), new THREE.Vector3(0.1, WALL_H, ROOM_SIZE), wMat);
          addWall(room, new THREE.Vector3(wx, 0.1, 0), new THREE.Vector3(0.12, 0.12, ROOM_SIZE), baseMat);
        }
      }
    });
  }

  function addCeilingLight(room, accent) {
    var lMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffff, emissiveIntensity: 0.3 });
    var light = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.05, 8), lMat);
    light.position.set(0, WALL_H - 0.05, 0);
    room.add(light);
    var rl = new THREE.PointLight(0xffffee, 1.0, 7);
    rl.position.set(0, WALL_H - 0.2, 0);
    room.add(rl);
  }

  function addRoomLabel(room, id) {
    var ld = document.createElement('div');
    ld.textContent = ROOM_DISPLAY[id] || id;
    ld.style.cssText = 'color:#fff;font-size:14px;font-weight:700;font-family:"Noto Sans TC",sans-serif;text-shadow:0 0 15px rgba(0,0,0,0.8);background:rgba(0,0,0,0.35);padding:2px 14px;border-radius:4px;letter-spacing:1px;border:1px solid rgba(255,255,255,0.2);pointer-events:none;';
    var label = new THREE.CSS2DObject(ld);
    label.position.set(0, WALL_H + 0.5, 0);
    room.add(label);
  }

  function addDecor(room, id, accent) {
    var dWood = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.7 });
    var dWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    var dDark = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.5 });
    var dAccent = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
    var dMetal = new THREE.MeshStandardMaterial({ color: 0x90a4ae, roughness: 0.3, metalness: 0.6 });

    switch (id) {
      case 'command':
        addBox(room, 1.2, 0.05, -1.0, 1.0, 0.7, 0.5, dWood);
        addBox(room, 1.2, 0.6, -1.0, 1.05, 0.04, 0.55, new THREE.MeshStandardMaterial({ color: 0x8d6e63 }));
        addBox(room, -1.0, 0.05, -1.2, 0.85, 0.65, 0.3, dWood);
        addBox(room, -0.97, 0.3, -1.2, 0.02, 0.3, 0.25, new THREE.MeshStandardMaterial({ color: 0x1a237e }));
        addBox(room, -0.6, 0.05, -1.6, 0.02, 0.5, 0.3, new THREE.MeshStandardMaterial({ color: 0x1a237e }));
        addCyl(room, -1.6, 0.05, 1.2, 0.015, 0.6, dWood);
        var fMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.1 });
        addBox(room, -1.6, 0.4, 1.2, 0.01, 0.3, 0.2, fMat);
        break;

      case 'medical':
        addBox(room, -0.5, 0.12, 0.1, 0.5, 0.15, 0.9, dWhite);
        addBox(room, -0.5, 0.06, -0.3, 0.35, 0.04, 0.25, dWhite);
        addBox(room, 1.3, 0.05, -1.2, 0.4, 0.5, 0.3, dWhite);
        addBox(room, 1.3, 0.35, -1.2, 0.44, 0.02, 0.34, dMetal);
        var crMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        addBox(room, 1.3, 0.65, -1.2, 0.2, 0.2, 0.02, crMat);
        addBox(room, 1.3, 0.65, -1.2, 0.02, 0.25, 0.15, crMat);
        addBox(room, -1.2, 0.25, 1.3, 0.5, 0.45, 0.25, dWhite);
        for (var si = 0; si < 3; si++) {
          addBox(room, -1.2, 0.45 + si * 0.15, 1.3, 0.44, 0.02, 0.2, new THREE.MeshStandardMaterial({ color: 0xe0e0e0 }));
        }
        break;

      case 'hall':
        addBox(room, 0, 0.5, -HALF_ROOM + 0.05, 1.0, 0.4, 0.04, new THREE.MeshStandardMaterial({ color: 0x2e7d32 }));
        addBox(room, 0, 0.5, -HALF_ROOM + 0.03, 1.04, 0.44, 0.02, dWood);
        addBox(room, 1.8, 0.04, 0.5, 0.2, 0.08, 0.15, new THREE.MeshStandardMaterial({ color: 0xffd54f }));
        addBox(room, -1.8, 0.04, -1.0, 0.15, 0.45, 0.25, dWood);
        addBox(room, -1.8, 0.3, -1.0, 0.17, 0.02, 0.27, new THREE.MeshStandardMaterial({ color: 0x1565c0 }));
        addCyl(room, 0.5, 0.04, 1.6, 0.06, 0.08, dWood);
        addCyl(room, 1.5, 0.04, 1.6, 0.06, 0.08, dWood);
        addBox(room, 1.0, 0.08, 1.6, 1.2, 0.04, 0.35, dWood);
        break;

      case 'comms':
        addBox(room, -0.3, 0.05, -1.2, 1.2, 0.7, 0.04, new THREE.MeshStandardMaterial({ color: 0x1a237e, emissive: 0x1a237e, emissiveIntensity: 0.05 }));
        addBox(room, -0.3, 0.22, -1.6, 0.04, 0.5, 0.4, new THREE.MeshStandardMaterial({ color: 0x263238 }));
        addCyl(room, -0.3, 0.05, -1.6, 0.025, 0.25, dMetal);
        addBox(room, -0.3, 0.02, -1.6, 0.18, 0.02, 0.15, dDark);
        var chMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.6 });
        for (var ci = 0; ci < 4; ci++) {
          var cx = 0.7 + (ci % 2) * 0.6, cz = 0.3 + Math.floor(ci / 2) * 0.5;
          addCyl(room, cx, 0.04, cz, 0.02, 0.25, dMetal);
          addBox(room, cx, 0.15, cz, 0.28, 0.12, 0.25, chMat);
        }
        break;

      case 'power':
        var rMat = new THREE.MeshStandardMaterial({ color: 0x757575, roughness: 0.6 });
        for (var si = 0; si < 3; si++) {
          addBox(room, -0.7 + si * 0.45, 0.1 + si * 0.2, 1.4, 0.4, 0.02, 0.5, rMat);
          addCyl(room, -0.7 + si * 0.45, 0.05, 1.4, 0.015, 0.12, dMetal);
          addCyl(room, -0.7 + si * 0.45, 0.05, 1.9, 0.015, 0.12, dMetal);
        }
        var ballMat = new THREE.MeshStandardMaterial({ color: 0xff6f00, roughness: 0.6 });
        for (var bi = 0; bi < 3; bi++) {
          var ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), ballMat);
          ball.position.set(-0.7 + bi * 0.45, 0.15, 1.65);
          room.add(ball);
        }
        addBox(room, 1.2, 0.1, 0.3, 0.5, 0.15, 0.7, new THREE.MeshStandardMaterial({ color: 0xe53935 }));
        addBox(room, 1.5, 0.3, 0.3, 0.02, 0.25, 0.1, dWhite);
        break;

      case 'warehouse':
        var bxMat = new THREE.MeshStandardMaterial({ color: 0xa1887f, roughness: 0.8 });
        var bxMat2 = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.8 });
        for (var bx = -1.0; bx <= 1.5; bx += 1.25) {
          for (var bz = 0.5; bz <= 1.5; bz += 0.5) {
            var h = 0.15 + (bx + bz) * 0.03;
            var m = (bx + bz) % 2 < 1 ? bxMat : bxMat2;
            addBox(room, bx, h, bz * 0.8, 0.4, 0.2, 0.35, m);
          }
        }
        var brMat = new THREE.MeshStandardMaterial({ color: 0xce93d8 });
        addCyl(room, -1.5, 0.05, -1.2, 0.02, 0.5, dMetal);
        addBox(room, -1.5, 0.3, -1.2, 0.3, 0.02, 0.02, brMat);
        break;

      case 'dorm':
        var pMat = new THREE.MeshStandardMaterial({ color: 0x212121, roughness: 0.3 });
        addBox(room, -0.7, 0.15, -1.0, 0.8, 0.2, 0.5, pMat);
        addBox(room, -0.7, 0.3, -1.0, 0.85, 0.04, 0.55, new THREE.MeshStandardMaterial({ color: 0x424242 }));
        addBox(room, -0.7, 0.35, -0.7, 0.7, 0.02, 0.12, dWhite);
        var keyMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        for (var ki = 0; ki < 7; ki++) {
          addBox(room, -1.0 + ki * 0.1, 0.35, -0.64, 0.06, 0.02, 0.06, keyMat);
        }
        addBox(room, -0.7, 0.06, -1.8, 0.4, 0.08, 0.25, dWood);
        var muMat = new THREE.MeshStandardMaterial({ color: 0xffab00 });
        addCyl(room, 1.7, 0.05, -0.8, 0.02, 0.5, dMetal);
        addBox(room, 1.7, 0.3, -0.8, 0.5, 0.02, 0.02, new THREE.MeshStandardMaterial({ color: accent }));
        break;
    }
  }

  function addBox(room, x, y, z, sx, sy, sz, mat) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    room.add(m);
  }

  function addCyl(room, x, y, z, r, h, mat) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 6), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    room.add(m);
  }

  function buildOutdoorDecor() {
    var treePos = [
      [-14, -2], [14, -2], [-14, 11], [14, 11], [-5, -16], [5, -16],
      [-14, 5], [14, 5], [-7, -10], [7, -10], [-13, 17], [12, 17],
      [-4, -8], [4, -8], [-12, 8],
    ];
    treePos.forEach(function (p) { makeTree(p[0], p[1]); });

    var fMat = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.7 });
    var fH = [
      [-15, 0, 0, 30], [15, 0, 0, 30], [0, -17, 1, 20], [0, 17, 1, 20],
    ];
    fH.forEach(function (f) {
      var hz = f[2] ? f[3] : 0.04;
      var hx = f[2] ? 0.04 : f[3];
      var rail1 = new THREE.Mesh(new THREE.BoxGeometry(hx, 0.06, hz), fMat);
      rail1.position.set(f[0], 0.3, f[1]);
      scene.add(rail1);
      var rail2 = new THREE.Mesh(new THREE.BoxGeometry(hx, 0.06, hz), fMat);
      rail2.position.set(f[0], 0.7, f[1]);
      scene.add(rail2);
      var step = 0.6;
      var count = Math.floor(f[3] / step);
      for (var k = 0; k < count; k++) {
        var off = -f[3] / 2 + 0.3 + k * step;
        var pst = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.8, 0.04), fMat);
        pst.position.set(f[2] ? f[0] + off : f[0], 0.4, f[2] ? f[1] : f[1] + off);
        scene.add(pst);
      }
    });
  }

  function makeTree(x, z) {
    var tMat = new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.9 });
    var lMat = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.8 });
    var lMat2 = new THREE.MeshStandardMaterial({ color: 0x66bb6a, roughness: 0.8 });
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.7, 6), tMat);
    trunk.position.set(x, 0.35, z);
    trunk.castShadow = true;
    scene.add(trunk);
    var l1 = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.4, 6), lMat);
    l1.position.set(x, 0.8, z);
    l1.castShadow = true;
    scene.add(l1);
    var l2 = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.35, 6), lMat2);
    l2.position.set(x, 1.1, z);
    l2.castShadow = true;
    scene.add(l2);
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
    renderer.domElement.addEventListener('click', function () { if (!isLocked) renderer.domElement.requestPointerLock(); });
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
      transitionProgress += dt * 0.7;
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
    var tMat = new THREE.MeshStandardMaterial({ color: 0x6688cc });
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
      scene.fog = new THREE.Fog(0x000011, 4, 15);
      ambLight.intensity = 0.05; dirLight.intensity = 0.05;
      spotLight.visible = true;
    } else {
      scene.background = new THREE.Color(0x87ceeb);
      scene.fog = new THREE.Fog(0x87ceeb, 25, 40);
      ambLight.intensity = 0.9; dirLight.intensity = 1.2;
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
