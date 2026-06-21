var R3D = {};

(function () {
  var scene, camera, renderer, container;
  var yaw = 0, pitch = 0;
  var keys = {};
  var playerPos = new THREE.Vector3(0, 1.3, 0);
  var currentRoomId = 'hall';
  var roomMeshes = {}, playerMeshes = {};
  var clickCallback = null, animating = false;
  var deadPos = {}, glowLight = null;
  var moveSpeed = 5, mouseSens = 0.003;
  var isLocked = false;
  var spotLight, dirLight, ambLight, hemi;
  var lockInstructionEl = null;
  var cssRenderer = null;
  var lastTime = 0;

  var ROOM_SIZE = 5, HALF_ROOM = 2.5, CLAMP = 4.0, WALL_H = 3, DOOR_W = 1.5, DOOR_H = 2.0;

  var ROOM_CFG = {
    command:  { x: 0,   z: -10 },
    medical:  { x: -7,  z: -4 },
    hall:     { x: 0,   z: -4 },
    comms:    { x: 7,   z: -4 },
    power:    { x: 0,   z: 3 },
    warehouse:{ x: -5,  z: 8 },
    dorm:     { x: 6,   z: 7 },
  };

  var ACCENT = {
    command: 0x8b0000, medical: 0xff6b6b, hall: 0x1565c0,
    comms: 0x7b1fa2, power: 0xef6c00, warehouse: 0x546e7a, dorm: 0x2e7d32,
  };

  var FLOOR_C = {
    command: 0x8b6914, medical: 0xffffff, hall: 0xc8b898,
    comms: 0x546e7a, power: 0x616161, warehouse: 0x9e9e9e, dorm: 0x8d6e63,
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
    glowLight = new THREE.PointLight(0x88aaff, 0.5, 4);
    glowLight.position.set(0, 0.15, 0);
    glowLight.visible = false;
    scene.add(glowLight);

    buildGround();
    R3D.buildMap();
    buildFenceAndTrees();
    setupControls();
  };

  function buildGround() {
    var gMat = new THREE.MeshStandardMaterial({ color: 0x7ec850, roughness: 0.9 });
    var g = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), gMat);
    g.rotation.x = -Math.PI / 2;
    g.position.y = -0.05;
    g.receiveShadow = true;
    scene.add(g);
  }

  R3D.buildMap = function () {
    Object.entries(ROOM_CFG).forEach(function (_a) { buildRoom(_a[0], _a[1]); });
    Object.keys(ROOM_CONNS).forEach(function (from) {
      ROOM_CONNS[from].forEach(function (to) { if (from < to) buildPath(from, to); });
    });
  };

  function buildPath(from, to) {
    var a = ROOM_CFG[from], b = ROOM_CFG[to];
    var da = getDoorOuter(from, to), db = getDoorOuter(to, from);
    if (!da || !db) return;
    var dx = db.x - da.x, dz = db.z - da.z;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.3) return;
    var mx = (da.x + db.x) / 2, mz = (da.z + db.z) / 2;
    var ang = Math.atan2(dx, dz);
    var pm = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.8 });
    var p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, len), pm);
    p.position.set(mx, 0.04, mz);
    p.rotation.y = ang;
    p.receiveShadow = true;
    scene.add(p);
    var lm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 });
    var dash = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, len - 0.6), lm);
    dash.position.set(mx + Math.cos(ang + Math.PI / 2) * 0.35, 0.08, mz + Math.sin(ang + Math.PI / 2) * 0.35);
    dash.rotation.y = ang;
    scene.add(dash);
    var sm = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.7 });
    var perpX = Math.cos(ang + Math.PI / 2), perpZ = Math.sin(ang + Math.PI / 2);
    [-1, 1].forEach(function (side) {
      for (var d = 0.6; d < len - 0.4; d += 1.4) {
        var frac = d / len - 0.5;
        var px = mx + perpX * side * 1.15 + Math.sin(ang) * frac * len;
        var pz = mz + perpZ * side * 1.15 - Math.cos(ang) * frac * len;
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.4, 6), sm);
        post.position.set(px, 0.2, pz);
        scene.add(post);
      }
    });
    // Corridor side walls (shortened to clear door openings)
    var wallMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.6 });
    var dirX = dx / len, dirZ = dz / len;
    var ppX = -dirZ, ppZ = dirX;
    var wallLen = len - 1.6;
    if (wallLen > 0.3) {
      [-1, 1].forEach(function (side) {
        var wx = ppX * side * 1.15;
        var wz = ppZ * side * 1.15;
        var w = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.8, wallLen), wallMat);
        w.position.set(mx + wx, 1.4, mz + wz);
        w.rotation.y = ang;
        w.castShadow = true;
        scene.add(w);
      });
    }
  }

  function getDoorOuter(id, targetId) {
    var a = ROOM_CFG[id], b = ROOM_CFG[targetId];
    if (!a || !b) return null;
    var dx = b.x - a.x, dz = b.z - a.z;
    if (Math.abs(dx) > Math.abs(dz)) {
      return { x: a.x + (dx > 0 ? HALF_ROOM : -HALF_ROOM), z: a.z };
    } else {
      return { x: a.x, z: a.z + (dz > 0 ? HALF_ROOM : -HALF_ROOM) };
    }
  }

  function buildRoom(id, pos) {
    var accent = ACCENT[id];
    var floorC = FLOOR_C[id];
    var room = new THREE.Group();
    room.position.set(pos.x, 0, pos.z);
    buildFloor(room, floorC, accent);
    buildCeil(room);
    buildWalls(room, id, pos, accent);
    addLight(room, accent);
    addDecor(room, id);
    var ld = document.createElement('div');
    ld.textContent = ROOM_DISPLAY[id];
    ld.style.cssText = 'color:#fff;font-size:14px;font-weight:700;font-family:"Noto Sans TC",sans-serif;text-shadow:0 0 15px rgba(0,0,0,0.8);background:rgba(0,0,0,0.35);padding:2px 14px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);pointer-events:none;';
    var label = new THREE.CSS2DObject(ld);
    label.position.set(0, WALL_H + 0.5, 0);
    room.add(label);
    scene.add(room);
    var bMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1 });
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), bMat);
    body.position.set(0, 0.1, -1.5);
    var bg = new THREE.Group();
    bg.add(body);
    bg.visible = false;
    room.add(bg);
    roomMeshes[id] = { group: room, pos: pos, bodyGrp: bg };
  }

  function buildFloor(room, base, accent) {
    for (var tx = -2; tx <= 2; tx++) {
      for (var tz = -2; tz <= 2; tz++) {
        var isDark = (tx + tz) % 2 === 0;
        var c = isDark ? base : 0xddd5c8;
        var tm = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
        var tile = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.06, 0.88), tm);
        tile.position.set(tx, 0.03, tz);
        tile.receiveShadow = true;
        room.add(tile);
      }
    }
    var bm = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
    [-1, 1].forEach(function (s) {
      var b1 = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE + 0.2, 0.04, 0.1), bm);
      b1.position.set(0, 0.07, s * (HALF_ROOM + 0.05));
      room.add(b1);
      var b2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, ROOM_SIZE + 0.2), bm);
      b2.position.set(s * (HALF_ROOM + 0.05), 0.07, 0);
      room.add(b2);
    });
  }

  function buildCeil(room) {
    var cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.12 });
    var c = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE + 0.4, 0.05, ROOM_SIZE + 0.4), cm);
    c.position.y = WALL_H;
    room.add(c);
  }

  function buildWalls(room, id, pos, accent) {
    var wm = new THREE.MeshStandardMaterial({ color: 0xfff8e7, roughness: 0.5 });
    var bm = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.6 });
    var fm = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
    var conns = ROOM_CONNS[id] || [];
    var hdw = DOOR_W / 2;
    var dirs = [
      { a: 'z', s: -1, chk: function (t) { var r = ROOM_CFG[t]; return r && r.z < pos.z; } },
      { a: 'z', s: 1, chk: function (t) { var r = ROOM_CFG[t]; return r && r.z > pos.z; } },
      { a: 'x', s: -1, chk: function (t) { var r = ROOM_CFG[t]; return r && r.x < pos.x; } },
      { a: 'x', s: 1, chk: function (t) { var r = ROOM_CFG[t]; return r && r.x > pos.x; } },
    ];
    dirs.forEach(function (d) {
      var hasDoor = conns.some(d.chk);
      if (d.a === 'z') {
        var wz = d.s * HALF_ROOM;
        var bw = ROOM_SIZE, bh = WALL_H, bx = 0;
        if (hasDoor) {
          addRect(room, -(HALF_ROOM + hdw) / 2, WALL_H / 2, wz, HALF_ROOM - hdw, WALL_H, 0.1, wm);
          addRect(room, (HALF_ROOM + hdw) / 2, WALL_H / 2, wz, HALF_ROOM - hdw, WALL_H, 0.1, wm);
          addRect(room, 0, (WALL_H + DOOR_H) / 2, wz, DOOR_W, WALL_H - DOOR_H, 0.1, wm);
          addRect(room, 0, 0.1, wz, ROOM_SIZE, 0.12, 0.12, bm);
          addRect(room, -hdw - 0.05, DOOR_H / 2, wz, 0.06, DOOR_H, 0.14, fm);
          addRect(room, hdw + 0.05, DOOR_H / 2, wz, 0.06, DOOR_H, 0.14, fm);
          addRect(room, 0, DOOR_H + 0.03, wz, DOOR_W + 0.1, 0.06, 0.14, fm);
        } else {
          addRect(room, 0, WALL_H / 2, wz, ROOM_SIZE, WALL_H, 0.1, wm);
          addRect(room, 0, 0.1, wz, ROOM_SIZE, 0.12, 0.12, bm);
        }
      } else {
        var wx = d.s * HALF_ROOM;
        if (hasDoor) {
          addRect(room, wx, WALL_H / 2, -(HALF_ROOM + hdw) / 2, 0.1, WALL_H, HALF_ROOM - hdw, wm);
          addRect(room, wx, WALL_H / 2, (HALF_ROOM + hdw) / 2, 0.1, WALL_H, HALF_ROOM - hdw, wm);
          addRect(room, wx, (WALL_H + DOOR_H) / 2, 0, 0.1, WALL_H - DOOR_H, DOOR_W, wm);
          addRect(room, wx, 0.1, 0, 0.12, 0.12, ROOM_SIZE, bm);
          addRect(room, wx, DOOR_H / 2, -hdw - 0.05, 0.14, DOOR_H, 0.06, fm);
          addRect(room, wx, DOOR_H / 2, hdw + 0.05, 0.14, DOOR_H, 0.06, fm);
          addRect(room, wx, DOOR_H + 0.03, 0, 0.14, 0.06, DOOR_W + 0.1, fm);
        } else {
          addRect(room, wx, WALL_H / 2, 0, 0.1, WALL_H, ROOM_SIZE, wm);
          addRect(room, wx, 0.1, 0, 0.12, 0.12, ROOM_SIZE, bm);
        }
      }
    });
  }

  function addRect(parent, x, y, z, sx, sy, sz, mat) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
  }

  function addLight(room, accent) {
    var lm = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffff, emissiveIntensity: 0.3 });
    var l = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.04, 8), lm);
    l.position.set(0, WALL_H - 0.04, 0);
    room.add(l);
    var rl = new THREE.PointLight(0xffffee, 1.0, 7);
    rl.position.set(0, WALL_H - 0.2, 0);
    room.add(rl);
  }

  function addDecor(room, id) {
    var wd = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.7 });
    var wh = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    var da = new THREE.MeshStandardMaterial({ color: ACCENT[id], roughness: 0.5 });
    var dk = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.5 });
    var mt = new THREE.MeshStandardMaterial({ color: 0x90a4ae, roughness: 0.3, metalness: 0.5 });

    switch (id) {
      case 'command':
        addRect(room, 1.0, 0.35, 0.8, 0.8, 0.7, 0.4, wd);
        addRect(room, 1.0, 0.72, 0.8, 0.84, 0.04, 0.44, da);
        addRect(room, -0.8, 0.4, -1.0, 0.7, 0.8, 0.25, wd);
        addRect(room, -0.78, 0.45, -1.0, 0.02, 0.6, 0.22, new THREE.MeshStandardMaterial({ color: 0x1a237e }));
        var flagMat = new THREE.MeshStandardMaterial({ color: ACCENT.command, emissive: ACCENT.command, emissiveIntensity: 0.08 });
        addRect(room, -1.6, 0.45, -0.2, 0.01, 0.35, 0.18, flagMat);
        addCyl(room, -1.6, 0.35, -0.2, 0.015, 0.7, wd);
        break;

      case 'medical':
        addRect(room, -0.5, 0.1, 0, 0.4, 0.12, 0.8, wh);
        addRect(room, -0.5, 0.04, -0.3, 0.28, 0.02, 0.2, wh);
        addRect(room, 1.2, 0.35, -1.0, 0.35, 0.7, 0.25, wh);
        addRect(room, 1.2, 0.48, -1.0, 0.38, 0.02, 0.28, mt);
        var cr = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        addRect(room, 1.2, 0.65, -1.0, 0.18, 0.2, 0.02, cr);
        addRect(room, 1.2, 0.65, -1.0, 0.02, 0.25, 0.14, cr);
        addRect(room, -1.0, 0.25, 1.2, 0.4, 0.45, 0.2, wh);
        for (var si = 0; si < 3; si++) {
          addRect(room, -1.0, 0.44 + si * 0.14, 1.2, 0.36, 0.02, 0.16, wh);
        }
        break;

      case 'hall':
        addRect(room, 0, 0.5, -HALF_ROOM + 0.04, 0.9, 0.35, 0.04, new THREE.MeshStandardMaterial({ color: 0x2e7d32 }));
        addRect(room, 0, 0.5, -HALF_ROOM + 0.02, 0.94, 0.39, 0.02, wd);
        addRect(room, 1.6, 0.08, 0.6, 0.25, 0.12, 0.18, wh);
        addRect(room, 1.6, 0.02, -1.2, 0.12, 0.04, 0.3, wd);
        addRect(room, 1.6, 0.12, -1.2, 0.14, 0.02, 0.32, da);
        addCyl(room, -0.8, 0.12, 1.5, 0.06, 0.2, wd);
        addRect(room, -0.8, 0.12, 1.8, 1.2, 0.04, 0.35, wd);
        addRect(room, 0.6, 0.02, 1.5, 0.1, 0.02, 0.3, wh);
        break;

      case 'comms':
        addRect(room, -0.2, 0.45, -1.0, 1.0, 0.9, 0.04, new THREE.MeshStandardMaterial({ color: 0x1a237e, emissive: 0x1a237e, emissiveIntensity: 0.04 }));
        addRect(room, -0.2, 0.2, -1.5, 0.04, 0.4, 0.5, dk);
        addCyl(room, -0.2, 0.04, -1.5, 0.025, 0.2, mt);
        addRect(room, -0.2, 0.02, -1.5, 0.16, 0.02, 0.14, dk);
        var ch = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.6 });
        for (var ci = 0; ci < 4; ci++) {
          var cx = 0.5 + (ci % 2) * 0.7, cz = 0.5 + Math.floor(ci / 2) * 0.6;
          addCyl(room, cx, 0.1, cz, 0.025, 0.2, mt);
          addRect(room, cx, 0.12, cz, 0.3, 0.1, 0.28, ch);
        }
        break;

      case 'power':
        var rm = new THREE.MeshStandardMaterial({ color: 0x757575, roughness: 0.6 });
        for (var si = 0; si < 3; si++) {
          var py = 0.1 + si * 0.18;
          addRect(room, -0.5 + si * 0.4, py, 1.3, 0.35, 0.02, 0.5, rm);
          addCyl(room, -0.5 + si * 0.4, 0.04, 1.3, 0.015, 0.1, mt);
          addCyl(room, -0.5 + si * 0.4, 0.04, 1.8, 0.015, 0.1, mt);
        }
        var bm = new THREE.MeshStandardMaterial({ color: 0xff6f00, roughness: 0.5 });
        for (var bi = 0; bi < 3; bi++) {
          var ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), bm);
          ball.position.set(-0.5 + bi * 0.4, 0.14, 1.55);
          room.add(ball);
        }
        break;

      case 'warehouse':
        var b1 = new THREE.MeshStandardMaterial({ color: 0xa1887f, roughness: 0.8 });
        var b2 = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.8 });
        for (var bx = -0.8; bx <= 1.0; bx += 0.9) {
          for (var bz = 0; bz <= 1; bz++) {
            var h = 0.1 + (bx + bz * 3) * 0.02;
            var m = (bx + bz * 2) % 2 < 1 ? b1 : b2;
            addRect(room, bx, h, bz * 0.7 + 0.3, 0.35, 0.18, 0.3, m);
          }
        }
        break;

      case 'dorm':
        addRect(room, -0.8, 0.12, -0.8, 0.6, 0.18, 0.45, dk);
        addRect(room, -0.8, 0.28, -0.8, 0.64, 0.04, 0.5, da);
        addRect(room, -0.8, 0.32, -0.52, 0.52, 0.02, 0.1, wh);
        for (var ki = 0; ki < 6; ki++) {
          addRect(room, -1.05 + ki * 0.08, 0.32, -0.47, 0.05, 0.015, 0.04, wh);
        }
        addRect(room, -0.8, 0.06, -1.7, 0.35, 0.06, 0.2, wd);
        var mm = new THREE.MeshStandardMaterial({ color: ACCENT.dorm, emissive: ACCENT.dorm, emissiveIntensity: 0.06 });
        addCyl(room, 1.6, 0.2, -0.5, 0.02, 0.4, mt);
        addRect(room, 1.6, 0.3, -0.5, 0.4, 0.02, 0.02, mm);
        break;
    }
  }

  function addCyl(room, x, y, z, r, h, mat) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 6), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    room.add(m);
  }

  function buildFenceAndTrees() {
    var ft = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.7 });
    var segs = [[-15, 0, 0, 30], [15, 0, 0, 30], [0, -17, 1, 20], [0, 17, 1, 20]];
    segs.forEach(function (f) {
      var hz = f[2] ? f[3] : 0.04;
      var hx = f[2] ? 0.04 : f[3];
      var r1 = new THREE.Mesh(new THREE.BoxGeometry(hx, 0.06, hz), ft);
      r1.position.set(f[0], 0.3, f[1]);
      scene.add(r1);
      var r2 = new THREE.Mesh(new THREE.BoxGeometry(hx, 0.06, hz), ft);
      r2.position.set(f[0], 0.7, f[1]);
      scene.add(r2);
      var cnt = Math.floor(f[3] / 0.6);
      for (var k = 0; k < cnt; k++) {
        var off = -f[3] / 2 + 0.3 + k * 0.6;
        var pst = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.8, 0.04), ft);
        pst.position.set(f[2] ? f[0] + off : f[0], 0.4, f[2] ? f[1] : f[1] + off);
        scene.add(pst);
      }
    });
    var tps = [[-14, -2], [14, -2], [-14, 11], [14, 11], [-5, -16], [5, -16],
      [-14, 5], [14, 5], [-8, -10], [8, -10], [-13, 17], [12, 17], [-3, -12], [-11, 8]];
    tps.forEach(function (p) { makeTree(p[0], p[1]); });
  }

  function makeTree(x, z) {
    var tMat = new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.9 });
    var lMat = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.8 });
    var lMat2 = new THREE.MeshStandardMaterial({ color: 0x66bb6a, roughness: 0.8 });
    var tr = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.7, 6), tMat);
    tr.position.set(x, 0.35, z);
    tr.castShadow = true;
    scene.add(tr);
    var l1 = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.4, 6), lMat);
    l1.position.set(x, 0.8, z);
    l1.castShadow = true;
    scene.add(l1);
    var l2 = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.35, 6), lMat2);
    l2.position.set(x, 1.1, z);
    l2.castShadow = true;
    scene.add(l2);
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
    lockInstructionEl.textContent = '點擊畫面以控制視角 · WASD 移動 · Shift 衝刺';
    lockInstructionEl.style.cssText = 'position:absolute;bottom:40%;left:50%;transform:translateX(-50%);color:#fff;font-size:18px;font-weight:700;font-family:"Noto Sans TC",sans-serif;background:rgba(0,0,0,0.6);padding:12px 28px;border-radius:10px;border:2px solid rgba(255,255,255,0.3);pointer-events:none;z-index:20;text-align:center;';
    container.appendChild(lockInstructionEl);
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
    var newPos = playerPos.clone().add(move);

    // Door transition check
    var roomData = ROOM_CFG[currentRoomId];
    if (roomData) {
      var conns = ROOM_CONNS[currentRoomId] || [];
      var hdw = DOOR_W / 2;
      for (var i = 0; i < conns.length; i++) {
        var to = conns[i];
        var tp = ROOM_CFG[to];
        if (!tp) continue;
        var dx = tp.x - roomData.x, dz = tp.z - roomData.z;
        if (Math.abs(dx) > Math.abs(dz)) {
          var doorX = roomData.x + (dx > 0 ? HALF_ROOM : -HALF_ROOM);
          var crossed = (dx > 0 && newPos.x >= doorX) || (dx < 0 && newPos.x <= doorX);
          if (crossed && Math.abs(playerPos.z - roomData.z) < hdw) {
            currentRoomId = to;
            roomData = ROOM_CFG[to];
            break;
          }
        } else {
          var doorZ = roomData.z + (dz > 0 ? HALF_ROOM : -HALF_ROOM);
          var crossed = (dz > 0 && newPos.z >= doorZ) || (dz < 0 && newPos.z <= doorZ);
          if (crossed && Math.abs(playerPos.x - roomData.x) < hdw) {
            currentRoomId = to;
            roomData = ROOM_CFG[to];
            break;
          }
        }
      }
    }

    // Wall collision: push back unless at a door opening
    if (roomData) {
      var conns = ROOM_CONNS[currentRoomId] || [];
      var hdw = DOOR_W / 2;
      var w = HALF_ROOM;
      // East wall (+x)
      if (newPos.x > roomData.x + w) {
        var hasEast = conns.some(function (t) {
          var r = ROOM_CFG[t]; return r && r.x > roomData.x;
        });
        if (!hasEast || Math.abs(newPos.z - roomData.z) >= hdw) newPos.x = roomData.x + w;
      }
      // West wall (-x)
      if (newPos.x < roomData.x - w) {
        var hasWest = conns.some(function (t) {
          var r = ROOM_CFG[t]; return r && r.x < roomData.x;
        });
        if (!hasWest || Math.abs(newPos.z - roomData.z) >= hdw) newPos.x = roomData.x - w;
      }
      // South wall (+z)
      if (newPos.z > roomData.z + w) {
        var hasSouth = conns.some(function (t) {
          var r = ROOM_CFG[t]; return r && r.z > roomData.z;
        });
        if (!hasSouth || Math.abs(newPos.x - roomData.x) >= hdw) newPos.z = roomData.z + w;
      }
      // North wall (-z)
      if (newPos.z < roomData.z - w) {
        var hasNorth = conns.some(function (t) {
          var r = ROOM_CFG[t]; return r && r.z < roomData.z;
        });
        if (!hasNorth || Math.abs(newPos.x - roomData.x) >= hdw) newPos.z = roomData.z - w;
      }
    }

    // Apply clamping to current room
    if (roomData) {
      newPos.x = Math.max(roomData.x - CLAMP, Math.min(roomData.x + CLAMP, newPos.x));
      newPos.z = Math.max(roomData.z - CLAMP, Math.min(roomData.z + CLAMP, newPos.z));
    }
    newPos.y = 1.3;
    playerPos.copy(newPos);
    camera.position.copy(playerPos);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    if (glowLight && glowLight.visible) {
      glowLight.position.set(playerPos.x, 0.15, playerPos.z);
    }
  }

  function onInteract() {
    if (clickCallback) clickCallback(currentRoomId);
  }

  function createAvatar(p) {
    var num = p.number, color = PLAYER_COLORS[(num - 1) % PLAYER_COLORS.length];
    var grp = new THREE.Group();
    var bm = new THREE.MeshStandardMaterial({ color: color, roughness: 0.3, metalness: 0.2 });
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.6, 8), bm);
    body.position.y = 0.5; grp.add(body);
    var tm = new THREE.MeshStandardMaterial({ color: 0x6688cc });
    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.2), tm);
    torso.position.y = 0.35; grp.add(torso);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffccaa }));
    head.position.y = 0.9; grp.add(head);
    var ndiv = document.createElement('div');
    ndiv.textContent = num;
    ndiv.style.cssText = 'color:#fff;font-size:12px;font-weight:900;font-family:sans-serif;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;background:#' + color.toString(16).padStart(6, '0') + ';box-shadow:0 2px 8px rgba(0,0,0,0.5);';
    var nl = new THREE.CSS2DObject(ndiv);
    nl.position.y = 1.3; grp.add(nl);
    var ndiv2 = document.createElement('div');
    ndiv2.textContent = p.name;
    ndiv2.style.cssText = 'color:#fff;font-size:9px;font-weight:700;font-family:"Noto Sans TC",sans-serif;text-shadow:0 0 5px rgba(0,0,0,0.8);background:rgba(0,0,0,0.4);padding:1px 5px;border-radius:2px;white-space:nowrap;pointer-events:none;';
    var nl2 = new THREE.CSS2DObject(ndiv2);
    nl2.position.y = 1.5; grp.add(nl2);
    scene.add(grp);
    playerMeshes[p.id] = { group: grp };
  }

  R3D.updatePlayers = function (players, myId) {
    Object.keys(playerMeshes).forEach(function (id) {
      if (!players.some(function (p) { return p.id === id; })) { scene.remove(playerMeshes[id].group); delete playerMeshes[id]; delete deadPos[id]; }
    });
    players.forEach(function (p, idx) {
      if (!playerMeshes[p.id]) createAvatar(p);
      var d = playerMeshes[p.id];
      if (!p.alive) {
        d.group.visible = p.id !== myId;
        if (!deadPos[p.id]) deadPos[p.id] = new THREE.Vector3(d.group.position.x, 0, d.group.position.z);
        d.group.position.set(deadPos[p.id].x, -0.3, deadPos[p.id].z);
        d.group.rotation.order = 'YXZ';
        d.group.rotation.x = -Math.PI / 2;
        d.group.rotation.y = 0;
        return;
      }
      d.group.visible = p.id !== myId;
      d.group.rotation.x = 0;
      delete deadPos[p.id];
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
      scene.background = new THREE.Color(0x000000);
      scene.fog = new THREE.Fog(0x000000, 1.5, 5);
      ambLight.intensity = 0.02; dirLight.intensity = 0.02;
      spotLight.visible = false;
      glowLight.visible = true;
    } else {
      scene.background = new THREE.Color(0x87ceeb);
      scene.fog = new THREE.Fog(0x87ceeb, 25, 40);
      ambLight.intensity = 0.9; dirLight.intensity = 1.2;
      spotLight.visible = false;
      glowLight.visible = false;
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
