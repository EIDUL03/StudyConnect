const socket = io();

let localStream = null;
let peerConnection = null;

let roomCode = "";
let myName = "";
let mySocketId = "";
let isHost = false;

let pendingCandidates = [];

let participants = [];
let whiteboardWriterId = null;

let screenSharerId = null;
let screenStream = null;
let isScreenSharing = false;


// =====================================
// WEBRTC
// =====================================

const configuration = {

  iceServers: [

    {
      urls: "stun:stun.l.google.com:19302"
    },

    {
      urls: "stun:stun1.l.google.com:19302"
    }

  ]

};


// =====================================
// START CAMERA + MICROPHONE
// =====================================

async function startCamera() {

  try {

    localStream =
      await navigator.mediaDevices.getUserMedia({

        video: true,

        audio: true

      });


    document.getElementById(
      "localVideo"
    ).srcObject = localStream;


    // Make sure microphone starts enabled.
    localStream
      .getAudioTracks()
      .forEach(track => {

        track.enabled = true;

      });


    return true;

  }

  catch (error) {

    console.error(
      "Camera/microphone error:",
      error
    );


    document.getElementById(
      "roomStatus"
    ).textContent =
      "Camera or microphone permission was denied.";

    return false;

  }

}


// =====================================
// CREATE PEER CONNECTION
// =====================================

function createPeerConnection() {

  if (peerConnection) {
    return peerConnection;
  }


  peerConnection =
    new RTCPeerConnection(
      configuration
    );


  if (localStream) {

    localStream
      .getTracks()
      .forEach(track => {

        peerConnection.addTrack(
          track,
          localStream
        );

      });

  }


  peerConnection.ontrack =
    event => {

      if (
        event.streams &&
        event.streams[0]
      ) {

        document.getElementById(
          "remoteVideo"
        ).srcObject =
          event.streams[0];


        document.getElementById(
          "remoteVideo"
        ).play().catch(() => {});


        document.getElementById(
          "roomStatus"
        ).textContent =
          "Connected — video and audio active.";

      }

    };


  peerConnection.onicecandidate =
    event => {

      if (event.candidate) {

        socket.emit(
          "signal",
          {

            room: roomCode,

            candidate:
              event.candidate

          }
        );

      }

    };


  peerConnection.onconnectionstatechange =
    () => {

      if (!peerConnection) {
        return;
      }


      if (
        peerConnection.connectionState ===
        "connected"
      ) {

        document.getElementById(
          "roomStatus"
        ).textContent =
          "Connected — video and audio active.";

      }


      if (
        peerConnection.connectionState ===
          "disconnected" ||

        peerConnection.connectionState ===
          "failed"
      ) {

        document.getElementById(
          "roomStatus"
        ).textContent =
          "Connection lost. Waiting for reconnection...";

      }

    };


  return peerConnection;

}


// =====================================
// CREATE ROOM
// =====================================

function createRoom() {

  myName =
    document.getElementById(
      "name"
    ).value.trim();


  if (!myName) {

    document.getElementById(
      "message"
    ).textContent =
      "Please enter your name first.";

    return;

  }


  socket.emit(
    "create-room",
    null,
    myName
  );

}


// =====================================
// ROOM CREATED
// =====================================

socket.on(
  "room-created",
  async code => {

    roomCode = code;

    isHost = true;


    document.getElementById(
      "lobby"
    ).style.display =
      "none";


    document.getElementById(
      "room"
    ).style.display =
      "block";


    document.getElementById(
      "displayRoomCode"
    ).textContent =
      roomCode;


    document.getElementById(
      "userRole"
    ).textContent =
      "HOST";


    document.getElementById(
      "roomStatus"
    ).textContent =
      "Room created. Waiting for students...";


    alert(
      "Your Study Room Code is: " +
      roomCode
    );


    await startCamera();


    initializeWhiteboard();

    createRoomControls();

  }
);


// =====================================
// JOIN ROOM
// =====================================

async function joinRoom() {

  myName =
    document.getElementById(
      "name"
    ).value.trim();


  roomCode =
    document.getElementById(
      "roomCode"
    ).value.trim();


  if (!myName) {

    document.getElementById(
      "message"
    ).textContent =
      "Please enter your name first.";

    return;

  }


  if (!/^\d{5}$/.test(roomCode)) {

    document.getElementById(
      "message"
    ).textContent =
      "Enter a valid 5-digit room code.";

    return;

  }


  isHost = false;


  document.getElementById(
    "lobby"
  ).style.display =
    "none";


  document.getElementById(
    "room"
  ).style.display =
    "block";


  document.getElementById(
    "displayRoomCode"
  ).textContent =
    roomCode;


  document.getElementById(
    "userRole"
  ).textContent =
    "STUDENT";


  document.getElementById(
    "roomStatus"
  ).textContent =
    "Starting camera and microphone...";


  const started =
    await startCamera();


  if (!started) {
    return;
  }


  initializeWhiteboard();

  createRoomControls();


  socket.emit(
    "join-room",
    roomCode,
    myName
  );


  document.getElementById(
    "roomStatus"
  ).textContent =
    "Joined room. Waiting for connection...";

}


// =====================================
// ROOM ERROR
// =====================================

socket.on(
  "room-error",
  message => {

    document.getElementById(
      "lobby"
    ).style.display =
      "block";


    document.getElementById(
      "room"
    ).style.display =
      "none";


    document.getElementById(
      "message"
    ).textContent =
      message;

  }
);


// =====================================
// ROOM STATE
// =====================================

socket.on(
  "room-state",
  state => {

    participants =
      state.participants || [];


    whiteboardWriterId =
      state.whiteboardWriterId || null;


    screenSharerId =
      state.screenSharerId || null;


    // The server will send our ID.
    // Until then, use the matching name
    // as a fallback.
    let me =
      participants.find(
        participant =>
          participant.id === mySocketId
      );


    if (!me) {

      me =
        participants.find(
          participant =>
            participant.name === myName
        );

    }


    if (me) {

      mySocketId =
        me.id;

    }


    isHost =
      state.hostId === mySocketId;


    document.getElementById(
      "userRole"
    ).textContent =
      isHost ? "HOST" : "STUDENT";


    updateParticipantList();

    updateWhiteboardPermission();

    updateScreenShareButton();

  }
);


// =====================================
// PARTICIPANT LIST
// =====================================

function updateParticipantList() {

  const list =
    document.getElementById(
      "participantsList"
    );


  const count =
    document.getElementById(
      "participantCount"
    );


  count.textContent =
    participants.length +
    " / 50";


  list.innerHTML = "";


  participants.forEach(
    participant => {

      const item =
        document.createElement(
          "div"
        );


      item.className =
        "participant";


      const name =
        document.createElement(
          "div"
        );


      name.className =
        "participant-name";


      name.textContent =
        participant.name;


      if (participant.isHost) {

        const hostLabel =
          document.createElement(
            "span"
          );


        hostLabel.className =
          "host-label";


        hostLabel.textContent =
          "HOST";


        name.appendChild(
          hostLabel
        );

      }


      item.appendChild(name);


      if (
        isHost &&
        !participant.isHost
      ) {

        const controls =
          document.createElement(
            "div"
          );


        controls.className =
          "participant-controls";


        // WHITEBOARD
        const whiteboardButton =
          document.createElement(
            "button"
          );


        whiteboardButton.textContent =
          participant.canWhiteboard
            ? "Whiteboard: Allowed"
            : "Allow Whiteboard";


        whiteboardButton.className =
          participant.canWhiteboard
            ? "permission-active"
            : "permission-off";


        whiteboardButton.onclick =
          () => {

            giveWhiteboardPermission(
              participant.id
            );

          };


        controls.appendChild(
          whiteboardButton
        );


        // AUDIO
        const audioButton =
          document.createElement(
            "button"
          );


        audioButton.textContent =
          participant.canAudio
            ? "Mute"
            : "Allow Audio";


        audioButton.className =
          participant.canAudio
            ? "permission-active"
            : "permission-off";


        audioButton.onclick =
          () => {

            setAudioPermission(
              participant.id,
              !participant.canAudio
            );

          };


        controls.appendChild(
          audioButton
        );


        // UPLOAD
        const uploadButton =
          document.createElement(
            "button"
          );


        uploadButton.textContent =
          participant.canUpload
            ? "Upload: Allowed"
            : "Allow Upload";


        uploadButton.className =
          participant.canUpload
            ? "permission-active"
            : "permission-off";


        uploadButton.onclick =
          () => {

            setUploadPermission(
              participant.id,
              !participant.canUpload
            );

          };


        controls.appendChild(
          uploadButton
        );


        // SCREEN SHARE
        const screenButton =
          document.createElement(
            "button"
          );


        screenButton.textContent =
          participant.canScreenShare
            ? "Screen Share: Allowed"
            : "Allow Screen Share";


        screenButton.className =
          participant.canScreenShare
            ? "permission-active"
            : "permission-off";


        screenButton.onclick =
          () => {

            setScreenSharePermission(
              participant.id,
              !participant.canScreenShare
            );

          };


        controls.appendChild(
          screenButton
        );


        item.appendChild(
          controls
        );

      }


      list.appendChild(item);

    }
  );

}


// =====================================
// WHITEBOARD PERMISSION
// =====================================

function giveWhiteboardPermission(
  targetId
) {

  if (!isHost) {
    return;
  }


  socket.emit(
    "set-whiteboard-permission",
    targetId
  );

}


// =====================================
// AUDIO PERMISSION
// =====================================

function setAudioPermission(
  targetId,
  allowed
) {

  if (!isHost) {
    return;
  }


  socket.emit(
    "set-audio-permission",
    {

      targetId:
        targetId,

      allowed:
        allowed

    }
  );

}


// =====================================
// UPLOAD PERMISSION
// =====================================

function setUploadPermission(
  targetId,
  allowed
) {

  if (!isHost) {
    return;
  }


  socket.emit(
    "set-upload-permission",
    {

      targetId:
        targetId,

      allowed:
        allowed

    }
  );

}


// =====================================
// SCREEN SHARE PERMISSION
// =====================================

function setScreenSharePermission(
  targetId,
  allowed
) {

  if (!isHost) {
    return;
  }


  socket.emit(
    "set-screen-share-permission",
    {

      targetId:
        targetId,

      allowed:
        allowed

    }
  );

}


// =====================================
// AUDIO PERMISSION RECEIVED
// =====================================

socket.on(
  "audio-permission",
  allowed => {

    if (!localStream) {
      return;
    }


    localStream
      .getAudioTracks()
      .forEach(track => {

        track.enabled =
          allowed;

      });


    const status =
      document.getElementById(
        "roomStatus"
      );


    status.textContent =
      allowed
        ? "Host allowed your microphone."
        : "Your microphone has been muted by the host.";

  }
);


// =====================================
// UPLOAD PERMISSION RECEIVED
// =====================================

socket.on(
  "upload-permission",
  allowed => {

    const input =
      document.getElementById(
        "materialInput"
      );


    const button =
      document.getElementById(
        "uploadButton"
      );


    const status =
      document.getElementById(
        "uploadStatus"
      );


    if (!input || !button || !status) {
      return;
    }


    input.disabled =
      !allowed;


    button.disabled =
      !allowed;


    status.textContent =
      allowed
        ? "Host allowed you to upload study material."
        : "Upload permission is controlled by the host.";

  }
);


// =====================================
// SCREEN SHARE PERMISSION RECEIVED
// =====================================

socket.on(
  "screen-share-permission",
  allowed => {

    updateScreenShareButton();


    document.getElementById(
      "roomStatus"
    ).textContent =
      allowed
        ? "Host allowed you to share your screen."
        : "Host disabled your screen sharing.";

  }
);


// =====================================
// SCREEN SHARE BUTTON
// =====================================

function createRoomControls() {

  if (
    document.getElementById(
      "studyConnectControls"
    )
  ) {

    return;

  }


  const card =
    document.createElement(
      "div"
    );


  card.id =
    "studyConnectControls";


  card.className =
    "section-card";


  card.innerHTML = `

    <div class="section-title">

      <h2>Study Tools</h2>

    </div>

    <div
      id="studyToolButtons"
      style="
        display:flex;
        flex-wrap:wrap;
        gap:10px;
      "
    >

      <button
        id="whiteboardToggleButton"
        type="button"
        onclick="toggleWhiteboard()"
        style="
          width:auto;
          margin:0;
          padding:10px 16px;
          border-radius:14px;
          background:linear-gradient(135deg,#007aff,#6255ff);
          color:white;
          font-weight:700;
        "
      >
        Whiteboard
      </button>


      <button
        id="screenShareButton"
        type="button"
        onclick="toggleScreenShare()"
        style="
          width:auto;
          margin:0;
          padding:10px 16px;
          border-radius:14px;
          background:linear-gradient(135deg,#7c4dff,#ff4f9a);
          color:white;
          font-weight:700;
        "
      >
        Share Screen
      </button>

    </div>

  `;


  const mainContent =
    document.querySelector(
      ".main-content"
    );


  if (mainContent) {

    mainContent.insertBefore(
      card,
      mainContent.firstChild
    );

  }


  // Whiteboard starts closed.
  const whiteboardCard =
    document.getElementById(
      "whiteboard"
    )?.closest(
      ".section-card"
    );


  if (whiteboardCard) {

    whiteboardCard.style.display =
      "none";

  }


  updateScreenShareButton();

}


// =====================================
// WHITEBOARD SHOW / HIDE
// =====================================

function toggleWhiteboard() {

  const canvasElement =
    document.getElementById(
      "whiteboard"
    );


  if (!canvasElement) {
    return;
  }


  const whiteboardCard =
    canvasElement.closest(
      ".section-card"
    );


  if (!whiteboardCard) {
    return;
  }


  const isHidden =
    whiteboardCard.style.display ===
    "none";


  whiteboardCard.style.display =
    isHidden
      ? "block"
      : "none";


  const button =
    document.getElementById(
      "whiteboardToggleButton"
    );


  if (button) {

    button.textContent =
      isHidden
        ? "Close Whiteboard"
        : "Whiteboard";

  }

}


// =====================================
// WHITEBOARD
// =====================================

let canvas = null;
let ctx = null;

let drawing = false;

let lastX = 0;
let lastY = 0;


function initializeWhiteboard() {

  canvas =
    document.getElementById(
      "whiteboard"
    );


  if (!canvas) {
    return;
  }


  ctx =
    canvas.getContext(
      "2d"
    );


  canvas.addEventListener(
    "pointerdown",
    startDrawing
  );


  canvas.addEventListener(
    "pointermove",
    draw
  );


  canvas.addEventListener(
    "pointerup",
    stopDrawing
  );


  canvas.addEventListener(
    "pointerleave",
    stopDrawing
  );


  updateWhiteboardPermission();


  socket.emit(
    "request-whiteboard-data"
  );

}


// =====================================
// WHITEBOARD PERMISSION STATUS
// =====================================

function updateWhiteboardPermission() {

  if (!canvas) {
    return;
  }


  const allowed =
    isHost ||
    whiteboardWriterId ===
      mySocketId;


  canvas.style.cursor =
    allowed
      ? "crosshair"
      : "not-allowed";


  const status =
    document.getElementById(
      "whiteboardStatus"
    );


  const message =
    document.getElementById(
      "whiteboardMessage"
    );


  if (!status || !message) {
    return;
  }


  if (allowed) {

    status.textContent =
      "You can write";


    message.textContent =
      "You have whiteboard permission.";

  }

  else {

    status.textContent =
      "View only";


    message.textContent =
      "Only the permitted student can write.";

  }

}


// =====================================
// START DRAWING
// =====================================

function startDrawing(event) {

  const allowed =
    isHost ||
    whiteboardWriterId ===
      mySocketId;


  if (!allowed) {
    return;
  }


  drawing = true;


  const rect =
    canvas.getBoundingClientRect();


  lastX =
    (event.clientX - rect.left) *
    (canvas.width / rect.width);


  lastY =
    (event.clientY - rect.top) *
    (canvas.height / rect.height);

}


// =====================================
// DRAW
// =====================================

function draw(event) {

  if (!drawing) {
    return;
  }


  const allowed =
    isHost ||
    whiteboardWriterId ===
      mySocketId;


  if (!allowed) {
    return;
  }


  const rect =
    canvas.getBoundingClientRect();


  const x =
    (event.clientX - rect.left) *
    (canvas.width / rect.width);


  const y =
    (event.clientY - rect.top) *
    (canvas.height / rect.height);


  ctx.beginPath();

  ctx.moveTo(
    lastX,
    lastY
  );

  ctx.lineTo(
    x,
    y
  );

  ctx.lineWidth =
    3;

  ctx.lineCap =
    "round";

  ctx.stroke();


  socket.emit(
    "whiteboard-draw",
    {

      x1: lastX,

      y1: lastY,

      x2: x,

      y2: y

    }
  );


  lastX = x;
  lastY = y;

}


// =====================================
// STOP DRAWING
// =====================================

function stopDrawing() {

  drawing = false;

}


// =====================================
// RECEIVE DRAWING
// =====================================

socket.on(
  "whiteboard-draw",
  data => {

    if (!ctx || !data) {
      return;
    }


    ctx.beginPath();

    ctx.moveTo(
      data.x1,
      data.y1
    );

    ctx.lineTo(
      data.x2,
      data.y2
    );

    ctx.lineWidth =
      3;

    ctx.lineCap =
      "round";

    ctx.stroke();

  }
);


// =====================================
// RECEIVE EXISTING BOARD
// =====================================

socket.on(
  "whiteboard-data",
  data => {

    if (!ctx || !Array.isArray(data)) {
      return;
    }


    data.forEach(
      drawingData => {

        ctx.beginPath();

        ctx.moveTo(
          drawingData.x1,
          drawingData.y1
        );

        ctx.lineTo(
          drawingData.x2,
          drawingData.y2
        );

        ctx.lineWidth =
          3;

        ctx.lineCap =
          "round";

        ctx.stroke();

      }
    );

  }
);


// =====================================
// SCREEN SHARE UI
// =====================================

function updateScreenShareButton() {

  const button =
    document.getElementById(
      "screenShareButton"
    );


  if (!button) {
    return;
  }


  const me =
    participants.find(
      participant =>
        participant.id ===
        mySocketId
    );


  const allowed =
    isHost ||
    Boolean(
      me &&
      me.canScreenShare
    );


  if (isScreenSharing) {

    button.textContent =
      "Stop Sharing";

    button.style.background =
      "linear-gradient(135deg,#ff375f,#ff6b6b)";

    button.disabled =
      false;

    return;

  }


  if (!allowed) {

    button.textContent =
      "Screen Share Locked";

    button.disabled =
      true;

    button.style.background =
      "rgba(100,110,140,0.35)";

    return;

  }


  button.textContent =
    screenSharerId &&
    screenSharerId !==
      mySocketId
      ? "Screen Busy"
      : "Share Screen";


  button.disabled =
    Boolean(
      screenSharerId &&
      screenSharerId !==
        mySocketId
    );


  button.style.background =
    "linear-gradient(135deg,#7c4dff,#ff4f9a)";

}


// =====================================
// START / STOP SCREEN SHARE
// =====================================

async function toggleScreenShare() {

  if (isScreenSharing) {

    stopScreenShare();

    return;

  }


  await startScreenShare();

}


// =====================================
// START SCREEN SHARE
// =====================================

async function startScreenShare() {

  const me =
    participants.find(
      participant =>
        participant.id ===
        mySocketId
    );


  const allowed =
    isHost ||
    Boolean(
      me &&
      me.canScreenShare
    );


  if (!allowed) {

    document.getElementById(
      "roomStatus"
    ).textContent =
      "The host has not allowed screen sharing.";

    return;

  }


  if (
    screenSharerId &&
    screenSharerId !==
      mySocketId
  ) {

    document.getElementById(
      "roomStatus"
    ).textContent =
      "Someone else is already sharing.";

    return;

  }


  try {

    screenStream =
      await navigator.mediaDevices.getDisplayMedia({

        video: true,

        audio: true

      });

  }

  catch (error) {

    console.log(
      "Screen sharing cancelled:",
      error
    );

    return;

  }


  isScreenSharing = true;


  socket.emit(
    "start-screen-share"
  );


  // Put screen into local preview.
  document.getElementById(
    "localVideo"
  ).srcObject =
    screenStream;


  // Replace camera track in WebRTC.
  if (peerConnection) {

    const videoTrack =
      screenStream.getVideoTracks()[0];


    const sender =
      peerConnection
        .getSenders()
        .find(
          item =>
            item.track &&
            item.track.kind ===
              "video"
        );


    if (sender) {

      await sender.replaceTrack(
        videoTrack
      );

    }

  }


  videoTrackEndedHandler();


  updateScreenShareButton();


  document.getElementById(
    "roomStatus"
  ).textContent =
    "You are sharing your screen.";

}


// =====================================
// SCREEN TRACK ENDED
// =====================================

function videoTrackEndedHandler() {

  if (!screenStream) {
    return;
  }


  const track =
    screenStream.getVideoTracks()[0];


  if (!track) {
    return;
  }


  track.onended =
    () => {

      if (isScreenSharing) {

        stopScreenShare();

      }

    };

}


// =====================================
// STOP SCREEN SHARE
// =====================================

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

  }


  screenStream = null;


  // Restore camera.
  if (localStream) {

    const cameraTrack =
      localStream.getVideoTracks()[0];


    if (cameraTrack) {

      if (peerConnection) {

        const sender =
          peerConnection
            .getSenders()
            .find(
              item =>
                item.track &&
                item.track.kind ===
                  "video"
            );


        if (sender) {

          await sender.replaceTrack(
            cameraTrack
          );

        }

      }


      document.getElementById(
        "localVideo"
      ).srcObject =
        localStream;

    }

  }


  socket.emit(
    "stop-screen-share"
  );


  updateScreenShareButton();


  document.getElementById(
    "roomStatus"
  ).textContent =
    "Screen sharing stopped.";

}


// =====================================
// SCREEN SHARE STARTED
// =====================================

socket.on(
  "screen-share-started",
  data => {

    if (!data) {
      return;
    }


    screenSharerId =
      data.userId;


    updateScreenShareButton();


    if (
      data.userId ===
      mySocketId
    ) {

      return;

    }


    document.getElementById(
      "roomStatus"
    ).textContent =
      data.userName +
      " is sharing their screen.";

  }
);


// =====================================
// SCREEN SHARE STOPPED
// =====================================

socket.on(
  "screen-share-stopped",
  data => {

    if (
      data &&
      screenSharerId ===
        data.userId
    ) {

      screenSharerId =
        null;

    }


    updateScreenShareButton();

  }
);


// =====================================
// SCREEN SHARE ERROR
// =====================================

socket.on(
  "screen-share-error",
  message => {

    document.getElementById(
      "roomStatus"
    ).textContent =
      message;

    updateScreenShareButton();

  }
);


// =====================================
// NEW HOST
// =====================================

socket.on(
  "new-host",
  data => {

    if (!data) {
      return;
    }


    isHost =
      data.hostId ===
      mySocketId;


    document.getElementById(
      "userRole"
    ).textContent =
      isHost
        ? "HOST"
        : "STUDENT";


    if (isHost) {

      document.getElementById(
        "roomStatus"
      ).textContent =
        "You are now the host.";

    }


    updateParticipantList();

    updateWhiteboardPermission();

    updateScreenShareButton();

  }
);


// =====================================
// OTHER STUDENT JOINED
// =====================================

socket.on(
  "user-joined",
  async () => {

    document.getElementById(
      "roomStatus"
    ).textContent =
      "Student joined. Connecting...";


    if (!localStream) {

      const started =
        await startCamera();


      if (!started) {
        return;
      }

    }


    const pc =
      createPeerConnection();


    if (isHost) {

      const offer =
        await pc.createOffer();


      await pc.setLocalDescription(
        offer
      );


      socket.emit(
        "signal",
        {

          room:
            roomCode,

          offer:
            pc.localDescription

        }
      );

    }

  }
);


// =====================================
// SIGNALING
// =====================================

socket.on(
  "signal",
  async data => {

    if (!data) {
      return;
    }


    if (!localStream) {

      const started =
        await startCamera();


      if (!started) {
        return;
      }

    }


    const pc =
      createPeerConnection();


    try {

      if (data.offer) {

        await pc.setRemoteDescription(
          new RTCSessionDescription(
            data.offer
          )
        );


        for (
          const candidate
          of pendingCandidates
        ) {

          try {

            await pc.addIceCandidate(
              candidate
            );

          }

          catch (error) {

            console.error(
              "ICE error:",
              error
            );

          }

        }


        pendingCandidates = [];


        const answer =
          await pc.createAnswer();


        await pc.setLocalDescription(
          answer
        );


        socket.emit(
          "signal",
          {

            room:
              roomCode,

            answer:
              pc.localDescription

          }
        );

      }


      if (data.answer) {

        await pc.setRemoteDescription(
          new RTCSessionDescription(
            data.answer
          )
        );


        for (
          const candidate
          of pendingCandidates
        ) {

          try {

            await pc.addIceCandidate(
              candidate
            );

          }

          catch (error) {

            console.error(
              "ICE error:",
              error
            );

          }

        }


        pendingCandidates = [];

      }


      if (data.candidate) {

        const candidate =
          new RTCIceCandidate(
            data.candidate
          );


        if (
          !pc.remoteDescription
        ) {

          pendingCandidates.push(
            candidate
          );

        }

        else {

          await pc.addIceCandidate(
            candidate
          );

        }

      }

    }

    catch (error) {

      console.error(
        "WebRTC signaling error:",
        error
      );

    }

  }
);


// =====================================
// STUDY MATERIAL
// =====================================

function uploadMaterial() {

  const input =
    document.getElementById(
      "materialInput"
    );


  const status =
    document.getElementById(
      "uploadStatus"
    );


  if (
    !input ||
    !input.files ||
    input.files.length === 0
  ) {

    status.textContent =
      "Please select an image or PDF first.";

    return;

  }


  const file =
    input.files[0];


  const allowed =
    file.type.startsWith(
      "image/"
    ) ||
    file.type ===
      "application/pdf";


  if (!allowed) {

    status.textContent =
      "Only images and PDF files are allowed.";

    return;

  }


  // The browser file picker is now
  // actually opened by the input.
  status.textContent =
    "Selected: " +
    file.name;


  // Preview images locally.
  if (
    file.type.startsWith(
      "image/"
    )
  ) {

    const reader =
      new FileReader();


    reader.onload =
      event => {

        const wrapper =
          document.createElement(
            "div"
          );


        wrapper.className =
          "material-item";


        const image =
          document.createElement(
            "img"
          );


        image.src =
          event.target.result;


        image.style.maxWidth =
          "100%";


        image.style.maxHeight =
          "500px";


        image.style.borderRadius =
          "12px";


        wrapper.appendChild(
          image
        );


        document
          .getElementById(
            "materials"
          )
          .appendChild(
            wrapper
          );

      };


    reader.readAsDataURL(
      file
    );

  }


  // Preview PDF locally.
  if (
    file.type ===
    "application/pdf"
  ) {

    const url =
      URL.createObjectURL(
        file
      );


    const wrapper =
      document.createElement(
        "div"
      );


    wrapper.className =
      "material-item";


    const link =
      document.createElement(
        "a"
      );


    link.href =
      url;


    link.target =
      "_blank";


    link.textContent =
      "Open " +
      file.name;


    link.style.fontWeight =
      "700";


    wrapper.appendChild(
      link
    );


    document
      .getElementById(
        "materials"
      )
      .appendChild(
        wrapper
      );

  }

}


// =====================================
// OTHER STUDENT LEFT
// =====================================

socket.on(
  "user-left",
  () => {

    document.getElementById(
      "remoteVideo"
    ).srcObject =
      null;


    if (peerConnection) {

      peerConnection.close();

      peerConnection =
        null;

    }


    pendingCandidates = [];


    document.getElementById(
      "roomStatus"
    ).textContent =
      "Student left. Waiting...";

  }
);