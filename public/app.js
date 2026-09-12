const socket = io();

const $ = id => document.getElementById(id);

const home = $('home');
const roomPage = $('room');
const nameInput = $('name');
const codeInput = $('roomCode');
const homeError = $('homeError');

let roomCode = '';
let myName = '';
let myToken = '';
let isHost = false;

let localStream = null;
let screenStream = null;

let micOn = true;
let camOn = true;

let users = new Map();
let peers = new Map();
let remoteStreams = new Map();
let visibleTokens = [];

let permissions = {
  audio: true,
  video: true,
  whiteboardWriter: false,
  upload: false,
  screen: false
};

let locks = {
  audio: false,
  video: false
};

const saved = JSON.parse(
  localStorage.getItem('studyconnect-session') || 'null'
);

if (saved) {
  nameInput.value = saved.name || '';
}

function save() {
  localStorage.setItem(
    'studyconnect-session',
    JSON.stringify({
      code: roomCode,
      name: myName,
      token: myToken
    })
  );
}

function error(t) {
  homeError.textContent = t || '';
}

function toast(t) {
  const x = $('toast');
  x.textContent = t;
  x.classList.add('show');

  setTimeout(() => {
    x.classList.remove('show');
  }, 2200);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[c]));
}

async function media() {
  return navigator.mediaDevices?.getUserMedia({
    video: true,
    audio: true
  });
}

async function enter(code, host, serverUsers) {
  roomCode = code;
  isHost = !!host;

  users.clear();

  (serverUsers || []).forEach(u => {
    users.set(u.token, u);
  });

  save();

  home.classList.add('hidden');
  roomPage.classList.remove('hidden');

  $('roleBadge').textContent = isHost ? 'HOST' : 'STUDENT';

  $('roomPrivate').textContent = isHost
    ? `Room code: ${roomCode} · share privately`
    : 'Private room · code hidden';

  try {
    localStream = await media();
  } catch (e) {
    localStream = null;
    toast('Camera/microphone permission was not granted.');
  }

  if (localStream) {
    localStream.getAudioTracks().forEach(t => {
      t.enabled = true;
    });

    localStream.getVideoTracks().forEach(t => {
      t.enabled = true;
    });
  }

  updateControls();
  renderVideos();
  renderParticipants();
  setupWhiteboard();

  ensurePeerConnections();
}

function updateControls() {
  const mb = $('micBtn');
  const cb = $('camBtn');

  mb.textContent = micOn ? '🎤 Mute' : '🔇 Unmute';
  cb.textContent = camOn ? '📷 Camera off' : '📷 Camera on';

  mb.disabled = !localStream || locks.audio;
  cb.disabled = !localStream || locks.video;

  $('uploadBtn').disabled =
    !isHost && !permissions.upload;

  $('screenBtn').disabled =
    !isHost && !permissions.screen;

  $('clearBoard').disabled =
    !isHost && !permissions.whiteboardWriter;

  $('whiteboardBtn').textContent =
    permissions.whiteboardWriter || isHost
      ? '✏️ Whiteboard (write)'
      : '✏️ Whiteboard';
}

function preferred() {
  const arr = [...users.values()].filter(u => u.connected);

  const host =
    arr.find(u => u.host) ||
    arr.find(u => u.token === myToken);

  const me = arr.find(u => u.token === myToken);

  const others = arr.filter(
    u =>
      u.token !== host?.token &&
      u.token !== myToken
  );

  const out = [];

  if (host) {
    out.push(host.token);
  }

  if (me && me.token !== host?.token) {
    out.push(me.token);
  }

  others.forEach(u => {
    if (out.length < 4) {
      out.push(u.token);
    }
  });

  return out;
}

function renderVideos() {
  const box = $('videos');

  box.innerHTML = '';

  const wanted = [
    ...new Set([
      ...visibleTokens,
      ...preferred()
    ])
  ]
    .filter(t => users.has(t))
    .slice(0, 4);

  visibleTokens = wanted;

  wanted.forEach(t => {
    makeTile(users.get(t));
  });

  $('videoCount').textContent =
    `${wanted.length}/4 visible`;

  renderPicker();
}

function makeTile(u) {
  let tile = document.getElementById(
    'tile-' + u.token
  );

  if (!tile) {
    tile = document.createElement('div');

    tile.className = 'video-tile';
    tile.id = 'tile-' + u.token;

    const v = document.createElement('video');

    v.autoplay = true;
    v.playsInline = true;
    v.muted = u.token === myToken;

    const n = document.createElement('div');

    n.className = 'video-name';

    tile.append(v, n);

    $('videos').appendChild(tile);
  }

  tile.querySelector('.video-name').textContent =
    (u.name || 'Student') +
    (u.token === myToken ? ' (You)' : '');

  const v = tile.querySelector('video');

  if (u.token === myToken) {
    if (localStream) {
      v.srcObject =
        screenStream || localStream;
    }
  } else if (remoteStreams.has(u.token)) {
    v.srcObject =
      remoteStreams.get(u.token);
  }
}

function renderPicker() {
  const p = $('pickerList');

  p.innerHTML = '';

  [...users.values()]
    .filter(
      u =>
        u.connected &&
        u.token !== myToken
    )
    .forEach(u => {
      const row =
        document.createElement('div');

      row.className = 'picker-item';

      row.innerHTML =
        `<span>${esc(u.name)}</span>`;

      const b =
        document.createElement('button');

      b.textContent =
        visibleTokens.includes(u.token)
          ? 'Remove'
          : 'Add';

      b.onclick = () => {
        if (
          visibleTokens.includes(u.token)
        ) {
          visibleTokens =
            visibleTokens.filter(
              x => x !== u.token
            );
        } else if (
          visibleTokens.length < 4
        ) {
          visibleTokens.push(u.token);
        } else {
          toast('Remove one video first.');
        }

        renderVideos();
      };

      row.appendChild(b);
      p.appendChild(row);
    });
}

$('videoCount').onclick = () => {
  $('videoPicker').classList.toggle(
    'hidden'
  );
};

function rtcConfig() {
  return {
    iceServers: [
      {
        urls: 'stun:stun.l.google.com:19302'
      },
      {
        urls: 'stun:stun.cloudflare.com:3478'
      }
    ],
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  };
}

/*
  WebRTC signaling notes
  ----------------------
  1. Only one side creates the offer. The token decides who is the
     initiator, so both devices do not create competing offers.
  2. Signals are queued if the participant list has not arrived yet.
  3. ICE candidates are queued until the remote description exists.
  4. Failed/disconnected connections can be rebuilt.
*/

const pendingSignals = new Map();
const pendingCandidates = new Map();

function queueSignal(from, data) {
  if (!from || !data) return;

  const list =
    pendingSignals.get(from) || [];

  list.push(data);
  pendingSignals.set(from, list);
}

function queueCandidate(from, candidate) {
  if (!from || !candidate) return;

  const list =
    pendingCandidates.get(from) || [];

  list.push(candidate);
  pendingCandidates.set(from, list);
}

function findUserBySocket(socketId) {
  return [...users.values()].find(
    u => u.socketId === socketId
  );
}

function shouldInitiate(u) {
  if (!u || !u.token || !myToken) {
    return false;
  }

  return String(myToken) < String(u.token);
}

function sendSignal(u, data) {
  if (!u?.socketId || !data) return;

  socket.emit('signal', {
    to: u.socketId,
    data
  });
}

async function flushPendingSignals(socketId) {
  const u = findUserBySocket(socketId);

  if (!u) return;

  const list =
    pendingSignals.get(socketId) || [];

  pendingSignals.delete(socketId);

  for (const data of list) {
    try {
      await handleSignal(u, socketId, data);
    } catch (e) {
      console.warn(
        'Queued WebRTC signal failed:',
        e
      );
    }
  }
}

async function flushPendingCandidates(
  socketId,
  pc
) {
  if (
    !pc ||
    !pc.remoteDescription
  ) {
    return;
  }

  const list =
    pendingCandidates.get(socketId) || [];

  pendingCandidates.delete(socketId);

  for (const candidate of list) {
    try {
      await pc.addIceCandidate(
        candidate
      );
    } catch (e) {
      console.warn(
        'Queued ICE candidate failed:',
        e
      );
    }
  }
}

async function connectPeer(u, initiator) {
  if (
    !u ||
    !u.socketId ||
    u.token === myToken
  ) {
    return null;
  }

  let pc = peers.get(u.token);

  /*
    If the peer already exists, it may have been created before
    getUserMedia() finished. Attach the local tracks now.
  */
  if (pc) {
    if (localStream) {
      const senders = pc.getSenders();

      localStream.getTracks().forEach(track => {
        const existing = senders.find(
          s => s.track?.kind === track.kind
        );

        if (!existing) {
          try {
            pc.addTrack(track, localStream);
          } catch (e) {
            console.warn(
              'Could not add local track:',
              e
            );
          }
        }
      });
    }

    if (
      initiator &&
      shouldInitiate(u) &&
      pc.signalingState === 'stable'
    ) {
      try {
        const offer = await pc.createOffer();

        await pc.setLocalDescription(offer);

        const current = users.get(u.token);

        if (
          current?.socketId &&
          pc.localDescription
        ) {
          sendSignal(
            current,
            {
              type: 'offer',
              sdp: pc.localDescription
            }
          );
        }
      } catch (e) {
        console.warn(
          'Could not create WebRTC offer:',
          e
        );
      }
    }

    return pc;
  }

  pc = new RTCPeerConnection(
    rtcConfig()
  );

  peers.set(u.token, pc);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      try {
        pc.addTrack(
          track,
          localStream
        );
      } catch (e) {
        console.warn(
          'Could not add local track:',
          e
        );
      }
    });
  }

  pc.onicecandidate = e => {
    if (!e.candidate) return;

    const current =
      users.get(u.token);

    if (!current?.socketId) {
      return;
    }

    sendSignal(
      current,
      {
        type: 'candidate',
        candidate: e.candidate
      }
    );
  };

  pc.ontrack = e => {
    const stream =
      e.streams?.[0];

    if (!stream) return;

    remoteStreams.set(
      u.token,
      stream
    );

    makeTile(
      users.get(u.token) || u
    );
  };

  pc.onconnectionstatechange = () => {
    const state =
      pc.connectionState;

    if (state === 'connected') {
      console.log(
        'WebRTC connected:',
        u.name
      );

      return;
    }

    if (
      state === 'failed' ||
      state === 'closed'
    ) {
      if (
        peers.get(u.token) === pc
      ) {
        peers.delete(
          u.token
        );
      }

      remoteStreams.delete(
        u.token
      );

      pendingCandidates.delete(
        u.socketId
      );

      try {
        pc.close();
      } catch (e) {}

      renderVideos();

      setTimeout(() => {
        const current =
          users.get(u.token);

        if (
          current?.connected &&
          current.socketId &&
          !peers.has(u.token)
        ) {
          connectPeer(
            current,
            shouldInitiate(current)
          );
        }
      }, 1200);
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state =
      pc.iceConnectionState;

    if (state === 'failed') {
      try {
        pc.restartIce();
      } catch (e) {
        console.warn(
          'ICE restart unavailable:',
          e
        );
      }
    }
  };

  if (
    initiator &&
    shouldInitiate(u)
  ) {
    try {
      const offer =
        await pc.createOffer();

      await pc.setLocalDescription(
        offer
      );

      const current =
        users.get(u.token);

      if (
        current?.socketId &&
        pc.localDescription
      ) {
        sendSignal(
          current,
          {
            type: 'offer',
            sdp:
              pc.localDescription
          }
        );
      }
    } catch (e) {
      console.warn(
        'Could not create WebRTC offer:',
        e
      );
    }
  }

  return pc;
}
async function handleSignal(
  u,
  from,
  data
) {
  if (
    !u ||
    !data
  ) {
    return;
  }

  let pc =
    peers.get(u.token);

  if (
    data.type === 'offer'
  ) {
    if (
      shouldInitiate(u) &&
      pc?.signalingState ===
        'have-local-offer'
    ) {
      return;
    }

    if (!pc) {
      pc =
        await connectPeer(
          u,
          false
        );
    }

    if (!pc) return;

    try {
      if (
        pc.signalingState ===
        'have-local-offer'
      ) {
        await pc.setLocalDescription({
          type: 'rollback'
        });
      }

      await pc.setRemoteDescription(
        data.sdp
      );

      await flushPendingCandidates(
        from,
        pc
      );

      const answer =
        await pc.createAnswer();

      await pc.setLocalDescription(
        answer
      );

      const current =
        users.get(u.token);

      if (current?.socketId) {
        sendSignal(
          current,
          {
            type: 'answer',
            sdp:
              pc.localDescription
          }
        );
      }
    } catch (e) {
      console.warn(
        'WebRTC offer handling failed:',
        e
      );
    }

    return;
  }

  if (
    data.type === 'answer' &&
    pc
  ) {
    try {
      if (
        pc.signalingState !==
        'have-local-offer'
      ) {
        return;
      }

      await pc.setRemoteDescription(
        data.sdp
      );

      await flushPendingCandidates(
        from,
        pc
      );
    } catch (e) {
      console.warn(
        'WebRTC answer handling failed:',
        e
      );
    }

    return;
  }

  if (
    data.type === 'candidate'
  ) {
    if (
      !pc ||
      !pc.remoteDescription
    ) {
      queueCandidate(
        from,
        data.candidate
      );
      return;
    }

    try {
      await pc.addIceCandidate(
        data.candidate
      );
    } catch (e) {
      console.warn(
        'ICE candidate failed:',
        e
      );
    }
  }
}

socket.on(
  'signal',
  async ({ from, data }) => {
    if (!from || !data) {
      return;
    }

    const u =
      findUserBySocket(from);

    /*
      A new student can send an offer before the existing clients
      receive their participants event. Keep the signal instead of
      dropping it.
    */
    if (!u) {
      queueSignal(
        from,
        data
      );
      return;
    }

    try {
      await handleSignal(
        u,
        from,
        data
      );
    } catch (e) {
      console.warn(
        'WebRTC signal handling failed:',
        e
      );
    }
  }
);

function ensurePeerConnections() {
  [...users.values()]
    .filter(
      u =>
        u.connected &&
        u.socketId &&
        u.token !== myToken
    )
    .forEach(u => {
      if (!peers.has(u.token)) {
        connectPeer(
          u,
          shouldInitiate(u)
        );
      }

      if (
        pendingSignals.has(
          u.socketId
        )
      ) {
        flushPendingSignals(
          u.socketId
        );
      }
    });
}

function renderParticipants() {
  const list =
    $('participantList');

  list.innerHTML = '';

  [...users.values()].forEach(u => {
    const d =
      document.createElement('div');

    d.className = 'person';

    const title =
      document.createElement('div');

    title.className =
      'person-name';

    title.textContent =
      u.name +
      (u.host ? ' · Host' : '');

    d.appendChild(title);

    if (isHost && !u.host) {
      const a =
        document.createElement('div');

      a.className =
        'person-actions';

      [
        [
          'audio',
          u.locks.audio
            ? 'Allow audio'
            : 'Mute audio'
        ],
        [
          'video',
          u.locks.video
            ? 'Allow video'
            : 'Turn video off'
        ],
        [
          'whiteboardWriter',
          u.permissions.whiteboardWriter
            ? 'Remove whiteboard'
            : 'Allow whiteboard'
        ],
        [
          'upload',
          u.permissions.upload
            ? 'Remove upload'
            : 'Allow upload'
        ],
        [
          'screen',
          u.permissions.screen
            ? 'Remove screen'
            : 'Allow screen'
        ]
      ].forEach(
        ([type, label]) => {
          const b =
            document.createElement(
              'button'
            );

          b.textContent = label;

          b.onclick = () => {
            socket.emit(
              'host-permission',
              {
                token: u.token,
                type,
                allowed:
                  type === 'audio' ||
                  type === 'video'
                    ? u.locks[type]
                    : !u.permissions[type]
              }
            );
          };

          a.appendChild(b);
        }
      );

      d.appendChild(a);
    }

    list.appendChild(d);
  });
}

socket.on(
  'participants',
  ({ users: list }) => {
    users.clear();

    list.forEach(u =>
      users.set(u.token, u)
    );

    const me =
      users.get(myToken);

    if (me) {
      permissions =
        me.permissions ||
        permissions;

      locks =
        me.locks ||
        locks;

      isHost = !!me.host;
    }

    visibleTokens =
      visibleTokens.filter(
        t =>
          users.has(t) &&
          users.get(t).connected
      );

    renderVideos();
    renderParticipants();
    updateControls();

    ensurePeerConnections();
  }
);

socket.on(
  'permissions-updated',
  d => {
    permissions =
      d.permissions ||
      permissions;

    locks =
      d.locks ||
      locks;

    if (locks.audio) {
      micOn = false;

      localStream
        ?.getAudioTracks()
        .forEach(
          t => t.enabled = false
        );
    }

    if (locks.video) {
      camOn = false;

      localStream
        ?.getVideoTracks()
        .forEach(
          t => t.enabled = false
        );
    }

    updateControls();

    toast(
      'Host updated your permissions.'
    );
  }
);

socket.on(
  'host-status',
  () => {
    isHost = true;

    $('roleBadge').textContent =
      'HOST';

    $('roomPrivate').textContent =
      `Room code: ${roomCode} · share privately`;

    renderParticipants();
    updateControls();
  }
);

socket.on('chat', m => {});

$('createBtn').onclick = () => {
  myName =
    (
      nameInput.value.trim() ||
      'Student'
    ).slice(0, 30);

  error('');

  socket.emit(
    'create-room',
    { name: myName },
    r => {
      if (!r.ok) {
        return error(r.error);
      }

      myToken = r.token;

      enter(
        r.code,
        true,
        r.users
      );
    }
  );
};

$('joinBtn').onclick = () => {
  myName =
    (
      nameInput.value.trim() ||
      'Student'
    ).slice(0, 30);

  const c =
    codeInput.value.replace(
      /\D/g,
      ''
    );

  error('');

  if (c.length !== 5) {
    return error(
      'Enter a 5-digit room code.'
    );
  }

  socket.emit(
    'join-room',
    {
      code: c,
      name: myName
    },
    r => {
      if (!r.ok) {
        return error(r.error);
      }

      myToken = r.token;

      enter(
        c,
        r.host,
        r.users
      );
    }
  );
};

function reconnect() {
  const s =
    JSON.parse(
      localStorage.getItem(
        'studyconnect-session'
      ) || 'null'
    );

  if (
    !s?.code ||
    !s?.token
  ) {
    return;
  }

  myName =
    s.name ||
    'Student';

  socket.emit(
    'join-room',
    {
      code: s.code,
      name: myName,
      token: s.token
    },
    r => {
      if (r.ok) {
        myToken = r.token;

        enter(
          s.code,
          r.host,
          r.users
        );
      } else {
        localStorage.removeItem(
          'studyconnect-session'
        );
      }
    }
  );
}

socket.on(
  'connect',
  () => {
    if (roomCode) return;

    reconnect();
  }
);

$('exitBtn').onclick = () => {
  if (
    confirm(
      'Exit this classroom?'
    )
  ) {
    socket.emit(
      'leave-room'
    );

    localStorage.removeItem(
      'studyconnect-session'
    );

    location.reload();
  }
};

$('participantsBtn').onclick =
  () => {
    if (isHost) {
      $('participantsPanel')
        .classList.remove(
          'hidden'
        );
    }
  };

$('closeParticipants').onclick =
  () => {
    $('participantsPanel')
      .classList.add(
        'hidden'
      );
  };

$('micBtn').onclick = () => {
  if (
    !localStream ||
    locks.audio
  ) {
    return;
  }

  micOn = !micOn;

  localStream
    .getAudioTracks()
    .forEach(
      t => t.enabled = micOn
    );

  updateControls();
};

$('camBtn').onclick = () => {
  if (
    !localStream ||
    locks.video
  ) {
    return;
  }

  camOn = !camOn;

  localStream
    .getVideoTracks()
    .forEach(
      t => t.enabled = camOn
    );

  updateControls();
};

$('whiteboardBtn').onclick =
  () => {
    $('board').scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  };

$('uploadBtn').onclick = () => {
  if (
    !isHost &&
    !permissions.upload
  ) {
    return;
  }

  $('fileInput').click();
};

$('fileInput').onchange = () => {
  const f =
    $('fileInput').files[0];

  if (!f) return;

  if (f.size > 4e6) {
    return toast(
      'Please keep files under 4 MB.'
    );
  }

  const r =
    new FileReader();

  r.onload = () => {
    socket.emit(
      'upload-material',
      {
        name: f.name,
        type: f.type,
        data: r.result
      }
    );
  };

  r.readAsDataURL(f);

  $('fileInput').value = '';
};

socket.on(
  'material',
  m => {
    const box =
      $('materials');

    box.querySelector(
      '.empty'
    )?.remove();

    const d =
      document.createElement(
        'div'
      );

    d.className =
      'material-card';

    const title =
      document.createElement(
        'div'
      );

    title.innerHTML =
      `<strong>${esc(m.name)}</strong><small> · ${esc(m.by)}</small>`;

    d.appendChild(title);

    if (
      m.type.startsWith(
        'image/'
      )
    ) {
      const img =
        document.createElement(
          'img'
        );

      img.src = m.data;

      d.appendChild(img);
    }

    else if (
      m.type ===
      'application/pdf'
    ) {
      const fr =
        document.createElement(
          'iframe'
        );

      fr.src = m.data;

      d.appendChild(fr);
    }

    else {
      const a =
        document.createElement(
          'a'
        );

      a.href = m.data;
      a.download = m.name;
      a.textContent =
        'Open file';

      d.appendChild(a);
    }

    box.prepend(d);
  }
);

$('screenBtn').onclick =
  async () => {
    if (
      !navigator.mediaDevices
        ?.getDisplayMedia
    ) {
      return toast(
        'Screen sharing is not supported here.'
      );
    }

    try {
      screenStream =
        await navigator.mediaDevices
          .getDisplayMedia({
            video: true
          });

      const track =
        screenStream
          .getVideoTracks()[0];

      peers.forEach(pc => {
        const s =
          pc.getSenders().find(
            x =>
              x.track?.kind ===
              'video'
          );

        if (s) {
          s.replaceTrack(track);
        }
      });

      makeTile(
        users.get(myToken)
      );

      socket.emit(
        'screen-state',
        {
          sharing: true
        }
      );

      track.onended =
        () => stopScreen();

    } catch (e) {}
  };

function stopScreen() {
  if (!screenStream) return;

  const cam =
    localStream
      ?.getVideoTracks()[0];

  peers.forEach(pc => {
    const s =
      pc.getSenders().find(
        x =>
          x.track?.kind ===
          'video'
      );

    if (s && cam) {
      s.replaceTrack(cam);
    }
  });

  screenStream
    .getTracks()
    .forEach(
      t => t.stop()
    );

  screenStream = null;

  makeTile(
    users.get(myToken)
  );

  socket.emit(
    'screen-state',
    {
      sharing: false
    }
  );
}

/* =========================
   WHITEBOARD
========================= */

const board = $('board');
const ctx = board.getContext('2d');

let drawing = false;
let last = {
  x: 0,
  y: 0
};

let boardTool = 'thin';
let boardColor = '#111827';

const boardStrokes = new Map();
let strokeCounter = 0;

function resize() {
  const r =
    board.getBoundingClientRect();

  const old =
    document.createElement(
      'canvas'
    );

  old.width = board.width;
  old.height = board.height;

  if (
    old.width &&
    old.height
  ) {
    old
      .getContext('2d')
      .drawImage(
        board,
        0,
        0
      );
  }

  board.width =
    Math.max(
      300,
      r.width
    );

  board.height =
    Math.max(
      250,
      r.height
    );

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (
    old.width &&
    old.height
  ) {
    ctx.drawImage(
      old,
      0,
      0,
      old.width,
      old.height,
      0,
      0,
      board.width,
      board.height
    );
  }

  redrawBoard();
}

setTimeout(
  resize,
  100
);

addEventListener(
  'resize',
  resize
);

function pt(e) {
  const r =
    board.getBoundingClientRect();

  const p =
    e.touches
      ? e.touches[0]
      : e;

  return {
    x:
      (p.clientX - r.left) *
      board.width /
      r.width,

    y:
      (p.clientY - r.top) *
      board.height /
      r.height
  };
}

function toolSettings() {
  if (
    boardTool ===
    'thick'
  ) {
    return {
      width: 8,
      alpha: 1,
      fade: false
    };
  }

  if (
    boardTool ===
    'highlighter'
  ) {
    return {
      width: 20,
      alpha: 0.35,
      fade: true
    };
  }

  return {
    width: 3,
    alpha: 1,
    fade: false
  };
}

function drawSegment(
  x1,
  y1,
  x2,
  y2,
  tool,
  color,
  width,
  alpha
) {
  ctx.save();

  ctx.globalAlpha =
    alpha;

  ctx.strokeStyle =
    color;

  ctx.lineWidth =
    width;

  ctx.lineCap =
    'round';

  ctx.lineJoin =
    'round';

  ctx.beginPath();

  ctx.moveTo(
    x1,
    y1
  );

  ctx.lineTo(
    x2,
    y2
  );

  ctx.stroke();

  ctx.restore();
}

function addStroke(
  stroke,
  redraw = true
) {
  const id =
    stroke.id ||
    ('local-' +
      (++strokeCounter));

  stroke.id = id;

  boardStrokes.set(
    id,
    stroke
  );

  if (stroke.fade) {
    setTimeout(
      () => {
        boardStrokes.delete(
          id
        );

        redrawBoard();
      },
      5000
    );
  }

  if (redraw) {
    redrawBoard();
  }
}

function redrawBoard() {
  ctx.clearRect(
    0,
    0,
    board.width,
    board.height
  );

  boardStrokes.forEach(
    stroke => {
      drawSegment(
        stroke.x1,
        stroke.y1,
        stroke.x2,
        stroke.y2,
        stroke.tool,
        stroke.color,
        stroke.width,
        stroke.alpha
      );
    }
  );
}

function start(e) {
  if (
    !permissions.whiteboardWriter &&
    !isHost
  ) {
    return;
  }

  e.preventDefault();

  drawing = true;

  last = pt(e);
}

function move(e) {
  if (!drawing) return;

  e.preventDefault();

  const p = pt(e);

  const settings =
    toolSettings();

  const stroke = {
    id:
      'local-' +
      (++strokeCounter),

    x1: last.x,
    y1: last.y,
    x2: p.x,
    y2: p.y,

    tool:
      boardTool,

    color:
      boardColor,

    width:
      settings.width,

    alpha:
      settings.alpha,

    fade:
      settings.fade
  };

  addStroke(
    stroke
  );

  socket.emit(
    'whiteboard',
    {
      type: 'line',

      id: stroke.id,

      x1: stroke.x1,
      y1: stroke.y1,
      x2: stroke.x2,
      y2: stroke.y2,

      tool:
        stroke.tool,

      color:
        stroke.color,

      width:
        stroke.width,

      alpha:
        stroke.alpha,

      fade:
        stroke.fade
    }
  );

  last = p;
}

function stop() {
  drawing = false;
}

board.onmousedown =
  start;

board.onmousemove =
  move;

addEventListener(
  'mouseup',
  stop
);

board.ontouchstart =
  start;

board.ontouchmove =
  move;

board.ontouchend =
  stop;

socket.on(
  'whiteboard',
  d => {
    if (
      d.type !==
      'line'
    ) {
      return;
    }

    addStroke(
      {
        id:
          d.id ||
          (
            'remote-' +
            (++strokeCounter)
          ),

        x1: d.x1,
        y1: d.y1,

        x2: d.x2,
        y2: d.y2,

        tool:
          d.tool ||
          'thin',

        color:
          d.color ||
          '#111827',

        width:
          d.width ||
          3,

        alpha:
          d.alpha ??
          1,

        fade:
          !!d.fade
      }
    );
  }
);

$('clearBoard').onclick =
  () => {
    if (
      !isHost &&
      !permissions.whiteboardWriter
    ) {
      return;
    }

    boardStrokes.clear();

    redrawBoard();

    socket.emit(
      'whiteboard-clear'
    );
  };

socket.on(
  'whiteboard-clear',
  () => {
    boardStrokes.clear();
    redrawBoard();
  }
);

/* =========================
   WHITEBOARD TOOLBAR
========================= */

function setupWhiteboard() {
  if (
    document.getElementById(
      'boardTools'
    )
  ) {
    return;
  }

  const wrap =
    board.parentElement;

  if (!wrap) return;

  const tools =
    document.createElement(
      'div'
    );

  tools.id =
    'boardTools';

  tools.className =
    'board-tools';

  tools.innerHTML = `
    <div class="board-tool-group">
      <span class="board-tool-label">Pen</span>

      <button
        type="button"
        class="board-tool active"
        data-tool="thin">
        Thin
      </button>

      <button
        type="button"
        class="board-tool"
        data-tool="thick">
        Thick
      </button>

      <button
        type="button"
        class="board-tool highlighter-tool"
        data-tool="highlighter">
        Highlighter
      </button>
    </div>

    <div class="board-tool-group">
      <span class="board-tool-label">Color</span>

      <button type="button" class="color-dot active" data-color="#111827" style="background:#111827"></button>
      <button type="button" class="color-dot" data-color="#e53935" style="background:#e53935"></button>
      <button type="button" class="color-dot" data-color="#1e88e5" style="background:#1e88e5"></button>
      <button type="button" class="color-dot" data-color="#43a047" style="background:#43a047"></button>
      <button type="button" class="color-dot" data-color="#f9a825" style="background:#f9a825"></button>
      <button type="button" class="color-dot" data-color="#8e24aa" style="background:#8e24aa"></button>
    </div>
  `;

  wrap.insertBefore(
    tools,
    board
  );

  tools
    .querySelectorAll(
      '.board-tool'
    )
    .forEach(btn => {
      btn.onclick = () => {
        boardTool =
          btn.dataset.tool;

        tools
          .querySelectorAll(
            '.board-tool'
          )
          .forEach(
            x =>
              x.classList.remove(
                'active'
              )
          );

        btn.classList.add(
          'active'
        );
      };
    });

  tools
    .querySelectorAll(
      '.color-dot'
    )
    .forEach(btn => {
      btn.onclick = () => {
        boardColor =
          btn.dataset.color;

        tools
          .querySelectorAll(
            '.color-dot'
          )
          .forEach(
            x =>
              x.classList.remove(
                'active'
              )
          );

        btn.classList.add(
          'active'
        );
      };
    });
}

/* =========================
   EID AI
========================= */

$('aiForm').onsubmit =
  async e => {
    e.preventDefault();

    const q =
      $('aiInput')
        .value
        .trim();

    if (!q) return;

    addAI(
      q,
      'user'
    );

    $('aiInput').value = '';

    const load =
      document.createElement(
        'div'
      );

    load.className =
      'ai-msg bot';

    load.textContent =
      'Thinking...';

    $('aiMessages')
      .appendChild(
        load
      );

    try {
      const r =
        await fetch(
          '/api/ai',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                question: q
              })
          }
        );

      const d =
        await r.json();

      load.textContent =
        d.answer ||
        d.error ||
        'No answer.';

    } catch (err) {
      load.textContent =
        'Eid AI is unavailable right now.';
    }

    $('aiMessages')
      .scrollTop =
      $('aiMessages')
        .scrollHeight;
  };

function addAI(
  t,
  type
) {
  const d =
    document.createElement(
      'div'
    );

  d.className =
    'ai-msg ' +
    type;

  d.textContent = t;

  $('aiMessages')
    .appendChild(
      d
    );

  $('aiMessages')
    .scrollTop =
    $('aiMessages')
      .scrollHeight;
}