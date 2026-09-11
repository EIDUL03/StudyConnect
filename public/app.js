const socket = io();

let localStream = null;
let peerConnection = null;

let roomCode = "";
let myName = "";
let mySocketId = "";

let isHost = false;

let participants = [];
let whiteboardWriterId = null;
let screenSharerId = null;

let pendingCandidates = [];
let remoteDescriptionSet = false;

let screenStream = null;
let isScreenSharing = false;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require"
};


/* =========================
   BASIC HELPERS
========================= */

function $(id) {
  return document.getElementById(id);
}

function setStatus(message) {
  const status = $("roomStatus");

  if (status) {
    status.textContent = message;
  }

  console.log("STATUS:", message);
}

function showLobby() {
  if ($("lobby")) {
    $("lobby").style.display = "flex";
  }

  if ($("room")) {
    $("room").style.display = "none";
  }
}

function showRoom() {
  if ($("lobby")) {
    $("lobby").style.display = "none";
  }

  if ($("room")) {
    $("room").style.display = "block";
  }
}


/* =========================
   CAMERA + MICROPHONE
========================= */

async function startCamera() {
  try {
    if (localStream) {
      return true;
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    const localVideo = $("localVideo");

    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      localVideo.playsInline = true;

      try {
        await localVideo.play();
      } catch (error) {
        console.log("Local video autoplay:", error);
      }
    }

    console.log("Camera and microphone started.");

    return true;
  } catch (error) {
    console.error("Camera/microphone error:", error);

    setStatus(
      "Camera or microphone permission was not allowed. You can still enter the room."
    );

    return false;
  }
}


/* =========================
   WEBRTC
========================= */

function closePeerConnection() {
  if (peerConnection) {
    try {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.oniceconnectionstatechange = null;
      peerConnection.onicegatheringstatechange = null;
      peerConnection.onnegotiationneeded = null;

      peerConnection.close();
    } catch (error) {
      console.log("Peer close error:", error);
    }
  }

  peerConnection = null;
  pendingCandidates = [];
  remoteDescriptionSet = false;
}

function createPeerConnection() {
  closePeerConnection();

  peerConnection = new RTCPeerConnection(rtcConfig);

  remoteDescriptionSet = false;
  pendingCandidates = [];

  if (localStream) {
    localStream.getTracks().forEach(track => {
      try {
        peerConnection.addTrack(track, localStream);
      } catch (error) {
        console.error("Could not add track:", error);
      }
    });
  }

  peerConnection.ontrack = event => {
    const remoteVideo = $("remoteVideo");

    if (!remoteVideo) {
      return;
    }

    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];

      remoteVideo.playsInline = true;

      remoteVideo.play().catch(error => {
        console.log("Remote video play:", error);
      });
    }
  };

  peerConnection.onicecandidate = event => {
    if (!event.candidate) {
      return;
    }

    socket.emit("signal", {
      room: roomCode,
      type: "candidate",
      candidate: event.candidate
    });
  };

  peerConnection.oniceconnectionstatechange = () => {
    if (!peerConnection) {
      return;
    }

    console.log(
      "ICE connection state:",
      peerConnection.iceConnectionState
    );

    if (peerConnection.iceConnectionState === "connected") {
      setStatus("Video connection established.");
    }

    if (peerConnection.iceConnectionState === "completed") {
      setStatus("Video connection established.");
    }

    if (peerConnection.iceConnectionState === "disconnected") {
      setStatus("Video connection temporarily disconnected...");
    }

    if (peerConnection.iceConnectionState === "failed") {
      setStatus("Video connection failed. Trying again...");

      if (isHost) {
        restartIce();
      }
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) {
      return;
    }

    console.log(
      "Peer connection state:",
      peerConnection.connectionState
    );

    if (peerConnection.connectionState === "connected") {
      setStatus("Connected to study partner.");
    }

    if (peerConnection.connectionState === "disconnected") {
      setStatus("Study partner temporarily disconnected.");
    }

    if (peerConnection.connectionState === "failed") {
      setStatus("Connection failed. Retrying...");

      if (isHost) {
        restartIce();
      }
    }
  };

  peerConnection.onicegatheringstatechange = () => {
    if (!peerConnection) {
      return;
    }

    console.log(
      "ICE gathering state:",
      peerConnection.iceGatheringState
    );
  };

  peerConnection.onnegotiationneeded = () => {
    console.log("WebRTC negotiation needed.");
  };

  return peerConnection;
}

async function restartIce() {
  if (!peerConnection || !isHost || !roomCode) {
    return;
  }

  try {
    console.log("Starting ICE restart...");

    const offer = await peerConnection.createOffer({
      iceRestart: true
    });

    await peerConnection.setLocalDescription(offer);

    socket.emit("signal", {
      room: roomCode,
      type: "offer",
      offer
    });

    console.log("ICE restart offer sent.");
  } catch (error) {
    console.error("ICE restart error:", error);
  }
}

async function processPendingCandidates() {
  if (!peerConnection || !remoteDescriptionSet) {
    return;
  }

  while (pendingCandidates.length > 0) {
    const candidate = pendingCandidates.shift();

    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (error) {
      console.error("Queued ICE candidate error:", error);
    }
  }
}


/* =========================
   CREATE ROOM
========================= */

async function createRoom() {
  const nameInput = $("nameInput");

  const name = nameInput
    ? nameInput.value.trim()
    : "";

  if (!name) {
    alert("Please enter your name.");
    return;
  }

  myName = name;

  console.log("CREATE ROOM REQUEST");
  console.log("Name:", myName);

  setStatus("Creating study room...");

  /*
     IMPORTANT:
     We do NOT generate or reuse a room code here.
     The SERVER creates the random 5-digit room code.
  */

  socket.emit("create-room", null, myName);
}


/* =========================
   JOIN ROOM
========================= */

async function joinRoom() {
  const nameInput = $("nameInput");
  const roomInput = $("roomInput");

  const name = nameInput
    ? nameInput.value.trim()
    : "";

  /*
     Read the room code ONLY from the room-code input.
     Do not use roomCode from an older session.
  */
  const code = roomInput
    ? roomInput.value.trim()
    : "";

  if (!name) {
    alert("Please enter your name.");
    return;
  }

  if (!/^\d{5}$/.test(code)) {
    alert("Please enter the correct 5-digit room code.");
    return;
  }

  /*
     Clear old state first.
  */
  myName = name;
  roomCode = code;
  isHost = false;

  console.log("================================");
  console.log("JOIN BUTTON PRESSED");
  console.log("Name:", myName);
  console.log("Room code typed:", code);
  console.log("Room code being sent:", roomCode);
  console.log("Socket connected:", socket.connected);
  console.log("================================");

  /*
     Show the room immediately.
     We do NOT wait for camera permission before
     sending the join request.
  */
  showRoom();

  if ($("roomCodeDisplay")) {
    $("roomCodeDisplay").textContent = roomCode;
  }

  if ($("hostLabel")) {
    $("hostLabel").textContent = "STUDENT";
  }

  setStatus("Joining room " + roomCode + "...");

  /*
     Send the join request immediately.
     This is the important fix.
  */
  if (socket.connected) {
    console.log(
      "SENDING JOIN REQUEST:",
      roomCode,
      myName
    );

    socket.emit("join-room", roomCode, myName);
  } else {
    console.log(
      "Socket is disconnected. Waiting for connection..."
    );

    socket.once("connect", () => {
      console.log(
        "Socket reconnected. Sending join request:",
        roomCode
      );

      socket.emit("join-room", roomCode, myName);
    });
  }

  /*
     Camera starts separately.
     A camera permission problem must NOT prevent
     the user from joining the room.
  */
  startCamera();
}


/* =========================
   ROOM CREATED
========================= */

socket.on("room-created", async code => {
  roomCode = String(code);

  isHost = true;

  console.log("ROOM CREATED BY SERVER:", roomCode);

  showRoom();

  if ($("roomCodeDisplay")) {
    $("roomCodeDisplay").textContent = roomCode;
  }

  if ($("hostLabel")) {
    $("hostLabel").textContent = "HOST";
  }

  setStatus("Room created. Starting camera...");

  alert(
    "Your StudyConnect room code is: " +
    roomCode
  );

  await startCamera();

  createRoomControls();

  initializeWhiteboard();

  setStatus("Room ready. Share the 5-digit code.");
});


/* =========================
   ROOM ERROR
========================= */

socket.on("room-error", message => {
  console.error("ROOM ERROR:", message);

  showLobby();

  setStatus(message);

  alert(message);
});


/* =========================
   ROOM STATE
========================= */

socket.on("room-state", state => {
  if (!state) {
    return;
  }

  console.log("ROOM STATE:", state);

  if (state.roomCode) {
    roomCode = String(state.roomCode);

    if ($("roomCodeDisplay")) {
      $("roomCodeDisplay").textContent = roomCode;
    }
  }

  participants = Array.isArray(state.participants)
    ? state.participants
    : [];

  whiteboardWriterId =
    state.whiteboardWriterId || null;

  screenSharerId =
    state.screenSharerId || null;

  /*
     Use our actual socket ID.
  */
  if (socket.id) {
    mySocketId = socket.id;
  }

  isHost =
    state.hostId === mySocketId;

  if ($("hostLabel")) {
    $("hostLabel").textContent =
      isHost ? "HOST" : "STUDENT";
  }

  updateParticipantCount();

  updateParticipantsPanel();

  updateWhiteboardPermission();

  updateScreenSharePermission();

  updateHostControls();
});


/* =========================
   PARTICIPANT COUNT
========================= */

function updateParticipantCount() {
  const countElement = $("participantCount");

  if (!countElement) {
    return;
  }

  countElement.textContent =
    participants.length + " / 50";
}


/* =========================
   PARTICIPANTS PANEL
========================= */

function updateParticipantsPanel() {
  const panel =
    $("participantsList") ||
    $("participantList");

  if (!panel) {
    return;
  }

  panel.innerHTML = "";

  participants.forEach(participant => {
    const row = document.createElement("div");

    row.className = "participant-row";

    const name = document.createElement("div");

    name.className = "participant-name";

    let label = participant.name || "Student";

    if (participant.id === mySocketId) {
      label += " (You)";
    }

    if (participant.isHost) {
      label += " - Host";
    }

    name.textContent = label;

    row.appendChild(name);

    /*
       Host controls
    */
    if (isHost && participant.id !== mySocketId) {
      const controls =
        document.createElement("div");

      controls.className =
        "participant-controls";

      const whiteboardButton =
        document.createElement("button");

      whiteboardButton.textContent =
        participant.canWhiteboard
          ? "Whiteboard ON"
          : "Allow Whiteboard";

      whiteboardButton.onclick = () => {
        socket.emit(
          "set-whiteboard-permission",
          participant.id
        );
      };

      controls.appendChild(whiteboardButton);


      const audioButton =
        document.createElement("button");

      audioButton.textContent =
        participant.canAudio
          ? "Mute"
          : "Allow Audio";

      audioButton.onclick = () => {
        socket.emit(
          "set-audio-permission",
          {
            targetId: participant.id,
            allowed: !participant.canAudio
          }
        );
      };

      controls.appendChild(audioButton);


      const uploadButton =
        document.createElement("button");

      uploadButton.textContent =
        participant.canUpload
          ? "Upload ON"
          : "Allow Upload";

      uploadButton.onclick = () => {
        socket.emit(
          "set-upload-permission",
          {
            targetId: participant.id,
            allowed: !participant.canUpload
          }
        );
      };

      controls.appendChild(uploadButton);


      const screenButton =
        document.createElement("button");

      screenButton.textContent =
        participant.canScreenShare
          ? "Screen ON"
          : "Allow Screen";

      screenButton.onclick = () => {
        socket.emit(
          "set-screen-share-permission",
          {
            targetId: participant.id,
            allowed:
              !participant.canScreenShare
          }
        );
      };

      controls.appendChild(screenButton);

      row.appendChild(controls);
    }

    panel.appendChild(row);
  });
}


/* =========================
   HOST CONTROLS
========================= */

function updateHostControls() {
  const participantsPanel =
    $("participantsPanel");

  if (participantsPanel) {
    participantsPanel.style.display =
      isHost ? "block" : "none";
  }
}


/* =========================
   USER JOINED
========================= */

socket.on("user-joined", async () => {
  console.log("A user joined the room.");

  if (!isHost) {
    return;
  }

  try {
    console.log("Host creating WebRTC offer...");

    createPeerConnection();

    const offer =
      await peerConnection.createOffer();

    await peerConnection.setLocalDescription(
      offer
    );

    socket.emit("signal", {
      room: roomCode,
      type: "offer",
      offer
    });

    console.log("WebRTC offer sent.");
  } catch (error) {
    console.error(
      "Could not create WebRTC offer:",
      error
    );
  }
});


/* =========================
   SIGNALING
========================= */

socket.on("signal", async data => {
  if (!data) {
    return;
  }

  console.log(
    "SIGNAL RECEIVED:",
    data.type
  );

  try {
    if (data.type === "offer") {
      /*
         Student receives offer.
      */

      if (!peerConnection) {
        createPeerConnection();
      }

      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(data.offer)
      );

      remoteDescriptionSet = true;

      await processPendingCandidates();

      const answer =
        await peerConnection.createAnswer();

      await peerConnection.setLocalDescription(
        answer
      );

      socket.emit("signal", {
        room: roomCode,
        type: "answer",
        answer
      });

      console.log("Answer sent.");
    }


    if (data.type === "answer") {
      /*
         Host receives answer.
      */

      if (!peerConnection) {
        return;
      }

      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(data.answer)
      );

      remoteDescriptionSet = true;

      await processPendingCandidates();

      console.log("Remote answer accepted.");
    }


    if (data.type === "candidate") {
      /*
         ICE candidate may arrive before
         remote description.
      */

      if (!peerConnection) {
        createPeerConnection();
      }

      const candidate =
        new RTCIceCandidate(data.candidate);

      if (!remoteDescriptionSet) {
        pendingCandidates.push(candidate);

        console.log(
          "ICE candidate queued."
        );
      } else {
        await peerConnection.addIceCandidate(
          candidate
        );

        console.log(
          "ICE candidate added."
        );
      }
    }
  } catch (error) {
    console.error(
      "WebRTC signaling error:",
      error
    );
  }
});


/* =========================
   USER LEFT
========================= */

socket.on("user-left", () => {
  console.log("A participant left.");

  const remoteVideo =
    $("remoteVideo");

  if (remoteVideo) {
    remoteVideo.srcObject = null;
  }

  closePeerConnection();

  setStatus(
    "Participant left. Waiting for another student..."
  );
});


/* =========================
   WHITEBOARD
========================= */

let whiteboardCanvas = null;
let whiteboardContext = null;
let drawing = false;
let lastX = 0;
let lastY = 0;

function initializeWhiteboard() {
  whiteboardCanvas =
    $("whiteboardCanvas");

  if (!whiteboardCanvas) {
    return;
  }

  whiteboardContext =
    whiteboardCanvas.getContext("2d");

  resizeWhiteboard();

  window.addEventListener(
    "resize",
    resizeWhiteboard
  );

  whiteboardCanvas.addEventListener(
    "pointerdown",
    startDrawing
  );

  whiteboardCanvas.addEventListener(
    "pointermove",
    drawWhiteboard
  );

  whiteboardCanvas.addEventListener(
    "pointerup",
    stopDrawing
  );

  whiteboardCanvas.addEventListener(
    "pointerleave",
    stopDrawing
  );

  socket.emit(
    "request-whiteboard-data"
  );
}

function resizeWhiteboard() {
  if (!whiteboardCanvas) {
    return;
  }

  const rect =
    whiteboardCanvas.getBoundingClientRect();

  if (
    rect.width === 0 ||
    rect.height === 0
  ) {
    return;
  }

  const oldImage =
    whiteboardCanvas.toDataURL();

  whiteboardCanvas.width =
    Math.floor(rect.width);

  whiteboardCanvas.height =
    Math.floor(rect.height);

  whiteboardContext =
    whiteboardCanvas.getContext("2d");

  const image =
    new Image();

  image.onload = () => {
    whiteboardContext.drawImage(
      image,
      0,
      0,
      whiteboardCanvas.width,
      whiteboardCanvas.height
    );
  };

  image.src = oldImage;
}

function canWriteWhiteboard() {
  return (
    isHost ||
    whiteboardWriterId === mySocketId
  );
}

function startDrawing(event) {
  if (!canWriteWhiteboard()) {
    return;
  }

  drawing = true;

  const rect =
    whiteboardCanvas.getBoundingClientRect();

  lastX =
    event.clientX - rect.left;

  lastY =
    event.clientY - rect.top;
}

function drawWhiteboard(event) {
  if (!drawing) {
    return;
  }

  if (!canWriteWhiteboard()) {
    return;
  }

  const rect =
    whiteboardCanvas.getBoundingClientRect();

  const x =
    event.clientX - rect.left;

  const y =
    event.clientY - rect.top;

  whiteboardContext.beginPath();

  whiteboardContext.moveTo(
    lastX,
    lastY
  );

  whiteboardContext.lineTo(
    x,
    y
  );

  whiteboardContext.strokeStyle =
    "#1d4ed8";

  whiteboardContext.lineWidth = 3;

  whiteboardContext.lineCap =
    "round";

  whiteboardContext.stroke();

  const drawingData = {
    x1: lastX,
    y1: lastY,
    x2: x,
    y2: y,
    width: 3
  };

  socket.emit(
    "whiteboard-draw",
    drawingData
  );

  lastX = x;
  lastY = y;
}

function stopDrawing() {
  drawing = false;
}

socket.on(
  "whiteboard-draw",
  drawingData => {
    drawRemoteWhiteboard(
      drawingData
    );
  }
);

function drawRemoteWhiteboard(data) {
  if (
    !whiteboardContext ||
    !whiteboardCanvas
  ) {
    return;
  }

  whiteboardContext.beginPath();

  whiteboardContext.moveTo(
    data.x1,
    data.y1
  );

  whiteboardContext.lineTo(
    data.x2,
    data.y2
  );

  whiteboardContext.strokeStyle =
    "#1d4ed8";

  whiteboardContext.lineWidth =
    data.width || 3;

  whiteboardContext.lineCap =
    "round";

  whiteboardContext.stroke();
}

socket.on(
  "whiteboard-data",
  drawingData => {
    if (!Array.isArray(drawingData)) {
      return;
    }

    if (!whiteboardContext) {
      return;
    }

    drawingData.forEach(data => {
      drawRemoteWhiteboard(data);
    });
  }
);

function updateWhiteboardPermission() {
  if (!whiteboardCanvas) {
    return;
  }

  if (canWriteWhiteboard()) {
    whiteboardCanvas.style.cursor =
      "crosshair";
  } else {
    whiteboardCanvas.style.cursor =
      "not-allowed";
  }
}


/* =========================
   WHITEBOARD REQUEST
========================= */

socket.on(
  "whiteboard-request",
  data => {
    if (!isHost || !data) {
      return;
    }

    const accept =
      confirm(
        data.studentName +
        " wants whiteboard permission.\n\nAllow?"
      );

    if (accept) {
      socket.emit(
        "set-whiteboard-permission",
        data.studentId
      );
    }
  }
);


/* =========================
   AUDIO PERMISSION
========================= */

socket.on(
  "audio-permission",
  allowed => {
    if (!localStream) {
      return;
    }

    const audioTracks =
      localStream.getAudioTracks();

    audioTracks.forEach(track => {
      track.enabled = Boolean(allowed);
    });

    setStatus(
      allowed
        ? "Microphone allowed."
        : "Microphone muted by host."
    );
  }
);


/* =========================
   UPLOAD PERMISSION
========================= */

socket.on(
  "upload-permission",
  allowed => {
    const uploadInput =
      $("materialInput");

    const uploadButton =
      $("uploadMaterialButton") ||
      $("uploadButton");

    if (uploadInput) {
      uploadInput.disabled =
        !Boolean(allowed);
    }

    if (uploadButton) {
      uploadButton.disabled =
        !Boolean(allowed);
    }

    setStatus(
      allowed
        ? "Study material upload allowed."
        : "Study material upload disabled by host."
    );
  }
);


/* =========================
   SCREEN SHARE PERMISSION
========================= */

socket.on(
  "screen-share-permission",
  allowed => {
    const button =
      $("shareScreenButton");

    if (button) {
      button.disabled =
        !Boolean(allowed);
    }

    setStatus(
      allowed
        ? "Screen sharing allowed."
        : "Screen sharing disabled by host."
    );
  }
);

function updateScreenSharePermission() {
  const me =
    participants.find(
      participant =>
        participant.id === mySocketId
    );

  const allowed =
    isHost ||
    Boolean(
      me && me.canScreenShare
    );

  const button =
    $("shareScreenButton");

  if (button) {
    button.disabled =
      !allowed;
  }
}


/* =========================
   SCREEN SHARE
========================= */

async function startScreenShare() {
  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getDisplayMedia
  ) {
    alert(
      "Screen sharing is not supported by this browser."
    );

    return;
  }

  try {
    screenStream =
      await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });

    const screenTrack =
      screenStream.getVideoTracks()[0];

    if (!screenTrack) {
      return;
    }

    isScreenSharing = true;

    screenTrack.onended = () => {
      stopScreenShare();
    };

    /*
       Replace the camera video track
       if a peer connection exists.
    */

    if (peerConnection) {
      const sender =
        peerConnection
          .getSenders()
          .find(
            s =>
              s.track &&
              s.track.kind === "video"
          );

      if (sender) {
        await sender.replaceTrack(
          screenTrack
        );
      }
    }

    const localVideo =
      $("localVideo");

    if (localVideo) {
      localVideo.srcObject =
        screenStream;
    }

    socket.emit(
      "start-screen-share"
    );

    setStatus(
      "You are sharing your screen."
    );
  } catch (error) {
    console.error(
      "Screen sharing error:",
      error
    );

    screenStream = null;
    isScreenSharing = false;

    setStatus(
      "Screen sharing was cancelled."
    );
  }
}

async function stopScreenShare() {
  if (!isScreenSharing) {
    return;
  }

  isScreenSharing = false;

  if (screenStream) {
    screenStream
      .getTracks()
      .forEach(track => {
        track.stop();
      });

    screenStream = null;
  }

  /*
     Return to camera.
  */

  if (localStream && peerConnection) {
    const cameraTrack =
      localStream
        .getVideoTracks()[0];

    if (cameraTrack) {
      const sender =
        peerConnection
          .getSenders()
          .find(
            s =>
              s.track &&
              s.track.kind === "video"
          );

      if (sender) {
        try {
          await sender.replaceTrack(
            cameraTrack
          );
        } catch (error) {
          console.error(
            "Could not restore camera:",
            error
          );
        }
      }
    }
  }

  const localVideo =
    $("localVideo");

  if (localVideo && localStream) {
    localVideo.srcObject =
      localStream;
  }

  socket.emit(
    "stop-screen-share"
  );

  setStatus(
    "Screen sharing stopped."
  );
}

socket.on(
  "screen-share-started",
  data => {
    if (!data) {
      return;
    }

    screenSharerId =
      data.userId;

    if (
      data.userId === mySocketId
    ) {
      setStatus(
        "You are sharing your screen."
      );
    } else {
      setStatus(
        data.userName +
        " is sharing their screen."
      );
    }
  }
);

socket.on(
  "screen-share-stopped",
  data => {
    if (!data) {
      return;
    }

    if (
      screenSharerId === data.userId
    ) {
      screenSharerId = null;
    }

    setStatus(
      "Screen sharing stopped."
    );
  }
);

socket.on(
  "screen-share-error",
  message => {
    alert(message);

    setStatus(message);
  }
);


/* =========================
   STUDY MATERIAL
========================= */

function uploadMaterial() {
  const input =
    $("materialInput");

  if (!input) {
    return;
  }

  const file =
    input.files[0];

  if (!file) {
    alert(
      "Please select an image or PDF first."
    );

    return;
  }

  /*
     Current version previews the material
     locally.

     Actual room-wide file storage/sharing
     will require backend storage.
  */

  const viewer =
    $("materialViewer");

  if (!viewer) {
    return;
  }

  viewer.innerHTML = "";

  if (
    file.type === "application/pdf"
  ) {
    const frame =
      document.createElement("iframe");

    frame.src =
      URL.createObjectURL(file);

    frame.style.width = "100%";
    frame.style.height = "500px";
    frame.style.border = "0";
    frame.style.borderRadius = "16px";

    viewer.appendChild(frame);
  } else if (
    file.type.startsWith("image/")
  ) {
    const image =
      document.createElement("img");

    image.src =
      URL.createObjectURL(file);

    image.style.maxWidth = "100%";
    image.style.maxHeight = "500px";
    image.style.borderRadius = "16px";

    viewer.appendChild(image);
  } else {
    alert(
      "Please select an image or PDF."
    );

    return;
  }

  setStatus(
    "Study material opened."
  );
}


/* =========================
   DYNAMIC STUDY TOOLS
========================= */

function createRoomControls() {
  if (
    $("studyTools") ||
    $("roomControlsCreated")
  ) {
    return;
  }

  const room =
    $("room");

  if (!room) {
    return;
  }

  const tools =
    document.createElement("div");

  tools.id = "studyTools";
  tools.className = "study-tools";

  const title =
    document.createElement("h3");

  title.textContent =
    "Study Tools";

  tools.appendChild(title);


  const whiteboardButton =
    document.createElement("button");

  whiteboardButton.textContent =
    "Whiteboard";

  whiteboardButton.id =
    "whiteboardToggleButton";

  whiteboardButton.onclick =
    () => {
      toggleWhiteboard();
    };

  tools.appendChild(
    whiteboardButton
  );


  const screenButton =
    document.createElement("button");

  screenButton.textContent =
    "Share Screen";

  screenButton.id =
    "shareScreenButton";

  screenButton.onclick =
    () => {
      if (isScreenSharing) {
        stopScreenShare();
      } else {
        startScreenShare();
      }
    };

  tools.appendChild(
    screenButton
  );


  const marker =
    document.createElement("div");

  marker.id =
    "roomControlsCreated";

  marker.style.display =
    "none";

  tools.appendChild(marker);

  room.prepend(tools);

  updateScreenSharePermission();
}


/* =========================
   WHITEBOARD TOGGLE
========================= */

function toggleWhiteboard() {
  const canvas =
    $("whiteboardCard") ||
    $("whiteboardContainer");

  if (!canvas) {
    if (whiteboardCanvas) {
      whiteboardCanvas.style.display =
        whiteboardCanvas.style.display ===
        "none"
          ? "block"
          : "none";
    }

    return;
  }

  if (
    canvas.style.display ===
    "none" ||
    !canvas.style.display
  ) {
    canvas.style.display =
      "block";
  } else {
    canvas.style.display =
      "none";
  }
}


/* =========================
   SOCKET CONNECTION
========================= */

socket.on("connect", () => {
  mySocketId =
    socket.id;

  console.log(
    "Socket connected:",
    mySocketId
  );

  /*
     Do NOT automatically send an old
     room code here.

     This prevents the browser from
     accidentally joining an old room.
  */

  if (
    roomCode &&
    $("roomCodeDisplay")
  ) {
    $("roomCodeDisplay").textContent =
      roomCode;
  }
});


socket.on("disconnect", reason => {
  console.log(
    "Socket disconnected:",
    reason
  );

  setStatus(
    "Connection to server lost. Reconnecting..."
  );
});


/* =========================
   PAGE LOAD
========================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {
    console.log(
      "StudyConnect app loaded."
    );

    showLobby();

    const createButton =
      $("createRoomButton") ||
      $("createButton");

    const joinButton =
      $("joinRoomButton") ||
      $("joinButton");

    if (createButton) {
      createButton.onclick =
        createRoom;
    }

    if (joinButton) {
      joinButton.onclick =
        joinRoom;
    }

    const uploadButton =
      $("uploadMaterialButton") ||
      $("uploadButton");

    if (uploadButton) {
      uploadButton.onclick =
        uploadMaterial;
    }

    /*
       Enter key on room-code input.
    */

    const roomInput =
      $("roomInput");

    if (roomInput) {
      roomInput.addEventListener(
        "input",
        () => {
          /*
             Keep only digits.
          */

          roomInput.value =
            roomInput.value
              .replace(/\D/g, "")
              .slice(0, 5);
        }
      );

      roomInput.addEventListener(
        "keydown",
        event => {
          if (
            event.key === "Enter"
          ) {
            joinRoom();
          }
        }
      );
    }
  }
);