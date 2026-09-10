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


// =====================================
// WEBRTC CONFIGURATION
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


    document.getElementById("localVideo").srcObject =
      localStream;


    console.log(
      "Camera and microphone started."
    );


    return true;

  }

  catch (error) {

    console.error(
      "Camera error:",
      error
    );


    document.getElementById(
      "roomStatus"
    ).textContent =
      "Camera/microphone permission denied.";


    return false;

  }

}


// =====================================
// CREATE WEBRTC CONNECTION
// =====================================

function createPeerConnection() {

  if (peerConnection) {

    return peerConnection;

  }


  peerConnection =
    new RTCPeerConnection(configuration);


  // Add local camera and microphone
  if (localStream) {

    localStream.getTracks().forEach(
      track => {

        peerConnection.addTrack(
          track,
          localStream
        );

      }
    );

  }


  // Receive remote video/audio
  peerConnection.ontrack = event => {

    console.log(
      "Remote stream received."
    );


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
        "Other student connected.";

    }

  };


  // ICE candidates
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


  // Connection state
  peerConnection.onconnectionstatechange =
    () => {

      if (!peerConnection) {
        return;
      }


      console.log(
        "Connection state:",
        peerConnection.connectionState
      );


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
          "Connection lost. Trying to reconnect...";

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


  // The server will create the final
  // unique 5-digit room code.
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


  // Send name to server
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

    console.log(
      "Room state:",
      state
    );


    participants =
      state.participants || [];


    whiteboardWriterId =
      state.whiteboardWriterId;


    // Find our own socket ID
    const me =
      participants.find(
        participant =>
          participant.name === myName
      );


    if (me) {

      mySocketId = me.id;

    }


    // Determine host
    isHost =
      state.hostId === mySocketId;


    document.getElementById(
      "userRole"
    ).textContent =
      isHost ? "HOST" : "STUDENT";


    updateParticipantList();


    updateWhiteboardPermission();

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


      item.appendChild(
        name
      );


      // Only host gets management buttons
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


        // Whiteboard button
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


        // Audio button
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


        // Upload button
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


        item.appendChild(
          controls
        );

      }


      list.appendChild(
        item
      );

    }
  );

}


// =====================================
// HOST: GIVE WHITEBOARD PERMISSION
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
// HOST: AUDIO PERMISSION
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

      targetId: targetId,

      allowed: allowed

    }
  );

}


// =====================================
// HOST: UPLOAD PERMISSION
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

      targetId: targetId,

      allowed: allowed

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


    const audioTracks =
      localStream.getAudioTracks();


    audioTracks.forEach(
      track => {

        track.enabled =
          allowed;

      }
    );


    const status =
      document.getElementById(
        "roomStatus"
      );


    if (allowed) {

      status.textContent =
        "Host allowed your microphone.";

    }

    else {

      status.textContent =
        "Your microphone has been muted by the host.";

    }

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


    input.disabled =
      !allowed;


    button.disabled =
      !allowed;


    if (allowed) {

      status.textContent =
        "Host allowed you to upload study material.";

    }

    else {

      status.textContent =
        "Upload permission is controlled by the host.";

    }

  }
);


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


  // Ask server for existing board
  socket.emit(
    "request-whiteboard-data"
  );

}


// =====================================
// CHECK WHITEBOARD PERMISSION
// =====================================

function updateWhiteboardPermission() {

  if (!canvas) {

    return;

  }


  const allowed =
    isHost ||
    whiteboardWriterId === mySocketId;


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
    whiteboardWriterId === mySocketId;


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
    whiteboardWriterId === mySocketId;


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


  const drawingData = {

    x1: lastX,

    y1: lastY,

    x2: x,

    y2: y

  };


  socket.emit(
    "whiteboard-draw",
    drawingData
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
// RECEIVE WHITEBOARD DRAWING
// =====================================

socket.on(
  "whiteboard-draw",
  data => {

    if (!ctx) {

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
// RECEIVE EXISTING WHITEBOARD
// =====================================

socket.on(
  "whiteboard-data",
  data => {

    if (!ctx) {

      return;

    }


    if (!Array.isArray(data)) {

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
// NEW HOST
// =====================================

socket.on(
  "new-host",
  data => {

    if (!data) {

      return;

    }


    if (data.hostId === mySocketId) {

      isHost = true;


      document.getElementById(
        "userRole"
      ).textContent =
        "HOST";


      document.getElementById(
        "roomStatus"
      ).textContent =
        "You are now the host.";

    }

    else {

      isHost = false;


      document.getElementById(
        "userRole"
      ).textContent =
        "STUDENT";

    }

  }
);


// =====================================
// OTHER STUDENT JOINED
// =====================================

socket.on(
  "user-joined",
  async () => {

    console.log(
      "Other student joined."
    );


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


    // Host creates offer
    if (isHost) {

      console.log(
        "Creating WebRTC offer..."
      );


      const offer =
        await pc.createOffer();


      await pc.setLocalDescription(
        offer
      );


      socket.emit(
        "signal",
        {

          room: roomCode,

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

    console.log(
      "Signal received:",
      data
    );


    if (!localStream) {

      const started =
        await startCamera();


      if (!started) {

        return;

      }

    }


    const pc =
      createPeerConnection();


    // =================================
    // RECEIVED OFFER
    // =================================

    if (data.offer) {

      console.log(
        "Offer received."
      );


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
            "ICE candidate error:",
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

          room: roomCode,

          answer:
            pc.localDescription

        }
      );

    }


    // =================================
    // RECEIVED ANSWER
    // =================================

    if (data.answer) {

      console.log(
        "Answer received."
      );


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
            "ICE candidate error:",
            error
          );

        }

      }


      pendingCandidates = [];

    }


    // =================================
    // RECEIVED ICE CANDIDATE
    // =================================

    if (data.candidate) {

      const candidate =
        new RTCIceCandidate(
          data.candidate
        );


      if (!pc.remoteDescription) {

        pendingCandidates.push(
          candidate
        );

      }

      else {

        try {

          await pc.addIceCandidate(
            candidate
          );

        }

        catch (error) {

          console.error(
            "ICE candidate error:",
            error
          );

        }

      }

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
    !input.files ||
    input.files.length === 0
  ) {

    status.textContent =
      "Please select an image or PDF first.";

    return;

  }


  const file =
    input.files[0];


  status.textContent =
    "File selected: " +
    file.name +
    ". Upload system will be connected in the next stage.";

}


// =====================================
// OTHER STUDENT LEFT
// =====================================

socket.on(
  "user-left",
  () => {

    console.log(
      "Student left."
    );


    document.getElementById(
      "remoteVideo"
    ).srcObject =
      null;


    if (peerConnection) {

      peerConnection.close();

      peerConnection = null;

    }


    pendingCandidates = [];


    document.getElementById(
      "roomStatus"
    ).textContent =
      "Student left. Waiting...";

  }
);