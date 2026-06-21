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
  var outdoorDecor = [];

  var ROOM_SIZE = 4, HALF_ROOM = 2, CLAMP = 1.95, WALL_H = 3;

  var ROOM_CFG = {
    command: { x: 0, z: -9 }, medical: { x: -6, z: 0 },
    hall: { x: 0, z: 0 }, comms: { x: 6, z: 0 },
    warehouse: { x: -6, z: 6 }, power: { x: 0, z: 6 }, dorm: { x: 6, z: 6 },
  };

  var ROOM_DISPLAY = {
    command: '校長室', medical: '保健室', hall: '穿堂',
    comms: '視聽教室', power: '體育器材室', warehouse: '儲藏室', dorm: '音樂教室',
  };

  var WALL_COLORS = {
    command: 0xfff8e7, medical: 0xfff8e7, hall: 0xfff8e7,
    comms: 0xfff8e7, power: 0xfff8e7, warehouse: 0xfff8e7, dorm: 0xfff8e7,
  };

  var ACCENT_COLORS = {
    command: 0x8b0000, medical: 0xff6b6b, hall: 0x4a90d9,
    comms: 0x9b59b6, power: 0xe67e22, warehouse: 0x7f8c8d, dorm: 0x2ecc71,
  };

  var PLAYER_COLORS = [0xe53935, 0x43a047, 0x1e88e5, 0xfb8c00, 0x8e24aa];

  var ROOM_CONNS = {
    hall: ['command', 'medical', 'comms', 'power'],
    command: ['hall'], medical: ['hall'], comms: ['hall'],
    power: ['hall', 'warehouse', 'dorm'], warehouse: ['power'], dorm: ['power'],
  };

  R3D.init = function (el) {
    container = el;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 20, 35);

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
    var groundMat = new THREE.MeshStandardMaterial({ color: 0x7ec850, roughness: 0.9 });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    var pathMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.8 });
    var pw = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 16), pathMat);
    pw.position.set(0, 0.03, -4.5);
    pw.receiveShadow = true;
    scene.add(pw);
    var pw2 = new THREE.Mesh(new THREE.BoxGeometry(14, 0.06, 2.5), pathMat);
    pw2.position.set(0, 0.03, 0);
    pw2.receiveShadow = true;
    scene.add(pw2);
    var pw3 = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 5), pathMat);
    pw3.position.set(0, 0.03, 8.5);
    pw3.receiveShadow = true;
    scene.add(pw3);
  }

  R3D.buildMap = function () {
    Object.entries(ROOM_CFG).forEach(function (_a) { buildRoom(_a[0], _a[1]); });
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

    var pathW = 1.6;
    var pMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.8 });
    var lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 });

    if (Math.abs(dx) > Math.abs(dz)) {
      var left = Math.min(a.x, b.x) + HALF_ROOM;
      var right = Math.max(a.x, b.x) - HALF_ROOM;
      var pLen = right - left;
      if (pLen < 0.3) return;
      var p = new THREE.Mesh(new THREE.BoxGeometry(pLen, 0.08, pathW), pMat);
      p.position.set((left + right) / 2, 0.04, a.z);
      p.receiveShadow = true;
      scene.add(p);
      var dash = new THREE.Mesh(new THREE.BoxGeometry(pLen - 0.4, 0.02, 0.04), lineMat);
      dash.position.set((left + right) / 2, 0.08, a.z);
      scene.add(dash);
      for (var lx = left + 0.5; lx < right - 0.3; lx += 1.5) {
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
        post.position.set(lx, 0.2, a.z + 1.1);
        scene.add(post);
        outdoorDecor.push(post);
        post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
        post.position.set(lx, 0.2, a.z - 1.1);
        scene.add(post);
        outdoorDecor.push(post);
      }
    } else {
      var bot = Math.min(a.z, b.z) + HALF_ROOM;
      var top = Math.max(a.z, b.z) - HALF_ROOM;
      var pLen = top - bot;
      if (pLen < 0.3) return;
      var p = new THREE.Mesh(new THREE.BoxGeometry(pathW, 0.08, pLen), pMat);
      p.position.set(a.x, 0.04, (bot + top) / 2);
      p.receiveShadow = true;
      scene.add(p);
      var dash = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, pLen - 0.4), lineMat);
      dash.position.set(a.x, 0.08, (bot + top) / 2);
      scene.add(dash);
      for (var lz = bot + 0.5; lz < top - 0.3; lz += 1.5) {
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
        post.position.set(a.x + 1.1, 0.2, lz);
        scene.add(post);
        outdoorDecor.push(post);
        post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
        post.position.set(a.x - 1.1, 0.2, lz);
        scene.add(post);
        outdoorDecor.push(post);
      }
    }
  }

  function buildRoom(id, pos) {
    var wallColor = WALL_COLORS[id] || 0xfff8e7;
    var accent = ACCENT_COLORS[id] || 0x888888;
    var room = new THREE.Group();
    room.position.set(pos.x, 0, pos.z);

    buildFloor(room, accent);
    buildCeiling(room);
    buildWalls(room, id, pos, wallColor, accent);
    addCeilingLight(room, accent);
    addDecoration(room, id, accent);
    addRoomLabel(room, id);

    scene.add(room);
    roomMeshes[id] = { group: room, pos: pos, bodyGrp: null };

    var bMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1 });
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), bMat);
    body.position.set(0, 0.1, -1);
    var bodyGrp = new THREE.Group();
    bodyGrp.add(body);
    bodyGrp.visible = false;
    room.add(bodyGrp);
    roomMeshes[id].bodyGrp = bodyGrp;
  }

  function buildFloor(room, accent) {
    var tileMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.6 });
    var groutMat = new THREE.MeshStandardMaterial({ color: 0xc8b898, roughness: 0.8 });
    for (var tx = -1.5; tx <= 1.5; tx += 1) {
      for (var tz = -1.5; tz <= 1.5; tz += 1) {
        var tile = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.06, 0.88), tileMat);
        tile.position.set(tx, 0.03, tz);
        tile.receiveShadow = true;
        room.add(tile);
      }
    }
    var borderMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
    var brd = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE + 0.2, 0.04, 0.12), borderMat);
    brd.position.set(0, 0.07, 2.06);
    room.add(brd);
    brd = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE + 0.2, 0.04, 0.12), borderMat);
    brd.position.set(0, 0.07, -2.06);
    room.add(brd);
    brd = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, ROOM_SIZE + 0.2), borderMat);
    brd.position.set(2.06, 0.07, 0);
    room.add(brd);
    brd = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, ROOM_SIZE + 0.2), borderMat);
    brd.position.set(-2.06, 0.07, 0);
    room.add(brd);
  }

  function buildCeiling(room) {
    var ceilMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.2 });
    var ceil = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE + 0.4, 0.05, ROOM_SIZE + 0.4), ceilMat);
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
      var doorW = 1.0, doorH = 2.0;
      var hdw = doorW / 2;
      if (d.axis === 'z') {
        var wz = d.sign * HALF_ROOM;
        if (hasDoor) {
          addWall(room, new THREE.Vector3(-(HALF_ROOM + hdw) / 2, WALL_H / 2, wz), new THREE.Vector3(HALF_ROOM - hdw, WALL_H, 0.1), wMat);
          addWall(room, new THREE.Vector3((HALF_ROOM + hdw) / 2, WALL_H / 2, wz), new THREE.Vector3(HALF_ROOM - hdw, WALL_H, 0.1), wMat);
          addWall(room, new THREE.Vector3(0, (WALL_H + doorH) / 2, wz), new THREE.Vector3(doorW, WALL_H - doorH, 0.1), wMat);
          addWall(room, new THREE.Vector3(0, 0.1, wz), new THREE.Vector3(ROOM_SIZE, 0.15, 0.12), baseMat);
          addWall(room, new THREE.Vector3(-hdw - 0.06, doorH / 2, wz), new THREE.Vector3(0.08, doorH, 0.16), frameMat);
          addWall(room, new THREE.Vector3(hdw + 0.06, doorH / 2, wz), new THREE.Vector3(0.08, doorH, 0.16), frameMat);
          addWall(room, new THREE.Vector3(0, doorH + 0.04, wz), new THREE.Vector3(doorW + 0.12, 0.08, 0.16), frameMat);
        } else {
          addWall(room, new THREE.Vector3(0, WALL_H / 2, wz), new THREE.Vector3(ROOM_SIZE, WALL_H, 0.1), wMat);
          addWall(room, new THREE.Vector3(0, 0.1, wz), new THREE.Vector3(ROOM_SIZE, 0.15, 0.12), baseMat);
        }
      } else {
        var wx = d.sign * HALF_ROOM;
        if (hasDoor) {
          addWall(room, new THREE.Vector3(wx, WALL_H / 2, -(HALF_ROOM + hdw) / 2), new THREE.Vector3(0.1, WALL_H, HALF_ROOM - hdw), wMat);
          addWall(room, new THREE.Vector3(wx, WALL_H / 2, (HALF_ROOM + hdw) / 2), new THREE.Vector3(0.1, WALL_H, HALF_ROOM - hdw), wMat);
          addWall(room, new THREE.Vector3(wx, (WALL_H + doorH) / 2, 0), new THREE.Vector3(0.1, WALL_H - doorH, doorW), wMat);
          addWall(room, new THREE.Vector3(wx, 0.1, 0), new THREE.Vector3(0.12, 0.15, ROOM_SIZE), baseMat);
          addWall(room, new THREE.Vector3(wx, doorH / 2, -hdw - 0.06), new THREE.Vector3(0.16, doorH, 0.08), frameMat);
          addWall(room, new THREE.Vector3(wx, doorH / 2, hdw + 0.06), new THREE.Vector3(0.16, doorH, 0.08), frameMat);
          addWall(room, new THREE.Vector3(wx, doorH + 0.04, 0), new THREE.Vector3(0.16, 0.08, doorW + 0.12), frameMat);
        } else {
          addWall(room, new THREE.Vector3(wx, WALL_H / 2, 0), new THREE.Vector3(0.1, WALL_H, ROOM_SIZE), wMat);
          addWall(room, new THREE.Vector3(wx, 0.1, 0), new THREE.Vector3(0.12, 0.15, ROOM_SIZE), baseMat);
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
    ld.style.cssText = 'color:#fff;font-size:13px;font-weight:700;font-family:"Noto Sans TC",sans-serif;text-shadow:0 0 15px rgba(0,0,0,0.8);background:rgba(0,0,0,0.35);padding:2px 14px;border-radius:4px;letter-spacing:1px;border:1px solid rgba(255,255,255,0.2);pointer-events:none;';
    var label = new THREE.CSS2DObject(ld);
    label.position.set(0, WALL_H + 0.5, 0);
    room.add(label);
  }

  function addDecoration(room, id, accent) {
    var decoMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
    var darkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.7 });
    var whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });

    switch (id) {
      case 'command':
        var desk = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.4), darkMat);
        desk.position.set(0.8, 0.3, 0.8);
        room.add(desk);
        var top = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.04, 0.45), new THREE.MeshStandardMaterial({ color: 0x8d6e63 }));
        top.position.set(0.8, 0.62, 0.8);
        room.add(top);
        var flag = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.3, 0.15), new THREE.MeshStandardMaterial({ color: accent }));
        flag.position.set(-1.0, 0.4, -1.2);
        room.add(flag);
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4), darkMat);
        pole.position.set(-1.0, 0.2, -1.2);
        room.add(pole);
        break;
      case 'medical':
        var bed = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 1.0), whiteMat);
        bed.position.set(-0.6, 0.1, 0);
        room.add(bed);
        var pillow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
        pillow.position.set(-0.6, 0.24, -0.35);
        room.add(pillow);
        var cross = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.02), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
        cross.position.set(1.2, 0.8, -1.0);
        room.add(cross);
        var cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.02), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
        cross2.position.set(1.2, 0.8, -1.0);
        room.add(cross2);
        break;
      case 'hall':
        var board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.04), new THREE.MeshStandardMaterial({ color: 0x2e7d32 }));
        board.position.set(0, 1.0, -1.95);
        room.add(board);
        var frame = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.44, 0.02), darkMat);
        frame.position.set(0, 1.0, -1.92);
        room.add(frame);
        break;
      case 'comms':
        var screen = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.04), new THREE.MeshStandardMaterial({ color: 0x1a237e, emissive: 0x1a237e, emissiveIntensity: 0.1 }));
        screen.position.set(-0.5, 0.8, -1.4);
        room.add(screen);
        var stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 6), darkMat);
        stand.position.set(-0.5, 0.25, -1.4);
        room.add(stand);
        var base = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.12), darkMat);
        base.position.set(-0.5, 0.1, -1.4);
        room.add(base);
        break;
      case 'power':
        var rackMat = new THREE.MeshStandardMaterial({ color: 0x616161, roughness: 0.7 });
        for (var ri = 0; ri < 3; ri++) {
          var shelf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.4), new THREE.MeshStandardMaterial({ color: 0x757575 }));
          shelf.position.set(-1.0 + ri * 0.35, 0.15 + ri * 0.25, 1.2);
          room.add(shelf);
        }
        break;
      case 'warehouse':
        var boxMat = new THREE.MeshStandardMaterial({ color: 0xa1887f, roughness: 0.8 });
        for (var bx = -0.5; bx <= 0.5; bx += 1.0) {
          for (var bz = 0.5; bz <= 1.0; bz += 0.5) {
            var box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), boxMat);
            box.position.set(bx, 0.1 + bz * 0.1, bz * 0.8);
            room.add(box);
          }
        }
        break;
      case 'dorm':
        var pianoMat = new THREE.MeshStandardMaterial({ color: 0x212121, roughness: 0.3 });
        var piano = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.4), pianoMat);
        piano.position.set(-0.8, 0.18, -1.0);
        room.add(piano);
        var keys = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.12), whiteMat);
        keys.position.set(-0.8, 0.36, -0.82);
        room.add(keys);
        var benchMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.7 });
        var bench = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.2), benchMat);
        bench.position.set(-0.8, 0.08, -1.6);
        room.add(bench);
        break;
    }

    var noticeMat = new THREE.MeshStandardMaterial({ color: 0xfff9c4 });
    var note = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.02), noticeMat);
    note.position.set(1.2, 0.6, -1.95);
    room.add(note);
  }

  function buildOutdoorDecor() {
    var treePos = [
      [-10, -2], [10, -2], [-10, 10], [10, 10], [-3, -13], [3, -13],
      [-10, 5], [10, 5], [-7, -8], [7, -8], [-8, 14], [8, 14],
    ];
    treePos.forEach(function (p) { makeTree(p[0], p[1]); });
    var fenceMat = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.7 });
    var fencePos = [
      [-12, 0, 0, 24], [12, 0, 0, 24], [0, -14, 1, 18], [0, 14, 1, 18],
    ];
    fencePos.forEach(function (f) {
      var horizontal = f[2];
      if (horizontal) {
        var rail = new THREE.Mesh(new THREE.BoxGeometry(f[3], 0.06, 0.04), fenceMat);
        rail.position.set(f[0], 0.3, f[1]);
        scene.add(rail);
        rail = new THREE.Mesh(new THREE.BoxGeometry(f[3], 0.06, 0.04), fenceMat);
        rail.position.set(f[0], 0.7, f[1]);
        scene.add(rail);
        for (var pi = -f[3]/2 + 0.3; pi < f[3]/2 - 0.3; pi += 0.6) {
          var post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.8, 0.04), fenceMat);
          post.position.set(f[0] + pi, 0.4, f[1]);
          scene.add(post);
        }
      } else {
        var rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, f[3]), fenceMat);
        rail.position.set(f[0], 0.3, f[1]);
        scene.add(rail);
        rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, f[3]), fenceMat);
        rail.position.set(f[0], 0.7, f[1]);
        scene.add(rail);
        for (var pi2 = -f[3]/2 + 0.3; pi2 < f[3]/2 - 0.3; pi2 += 0.6) {
          var post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.8, 0.04), fenceMat);
          post.position.set(f[0], 0.4, f[1] + pi2);
          scene.add(post);
        }
      }
    });
  }

  function makeTree(x, z) {
    var trunkMat = new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.9 });
    var leafMat = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.8 });
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.6, 6), trunkMat);
    trunk.position.set(x, 0.3, z);
    scene.add(trunk);
    var leaf1 = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.35, 6), leafMat);
    leaf1.position.set(x, 0.7, z);
    scene.add(leaf1);
    var leaf2 = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0x66bb6a, roughness: 0.8 }));
    leaf2.position.set(x, 0.95, z);
    scene.add(leaf2);
    outdoorDecor.push(trunk, leaf1, leaf2);
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
      scene.fog = new THREE.Fog(0x000011, 5, 15);
      ambLight.intensity = 0.05; dirLight.intensity = 0.05;
      spotLight.visible = true;
    } else {
      scene.background = new THREE.Color(0x87ceeb);
      scene.fog = new THREE.Fog(0x87ceeb, 20, 35);
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
