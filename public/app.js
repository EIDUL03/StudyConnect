const socket = io();

let roomCode = "";
let myName = "";
let isHost = false;

let localStream = null;

const peers = new Map();

let participants = [];

let whiteboardCanvas;
let whiteboardContext;
let drawing = false;
let lastX = 0;
let lastY = 0;

let screenStream = null;
let isScreenSharing = false;


/* =========================
   HELPERS
========================= */

const $ = id =>
  document.getElementById(id);

function showRoom() {
  $("lobby").classList.add("hidden");
  $("room").classList.remove("hidden");
}

function showMessage(text) {
  $("message").textContent = text;
}

function setStatus(text) {
  $("roomStatus").textContent = text;
}


/* =========================
   CAMERA + MICROPHONE
========================= */

async function startMedia() {

  try {

    localStream =
      await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

    $("localVideo").srcObject =
      localStream;

    $("localVideo").play().catch(() => {});

    return true;

  } catch (error) {

    console.error(error);

    setStatus(
      "Camera/microphone permission is required for video and audio."
    );

    return false;
  }
}


/* =========================
   CREATE ROOM
========================= */

$("createButton").onclick =
  async () => {

    const name =
      $("name").value.trim();

    if (!name) {
      showMessage("Please enter your name.");
      return;
    }

    myName =
      name.substring(0, 30);

    await startMedia();

    socket.emit(
      "create-room",
      myName
    );
  };


/* =========================
   JOIN ROOM
========================= */

$("joinButton").onclick =
  async () => {

    const name =
      $("name").value.trim();

    const code =
      $("roomCode").value.trim();

    if (!name) {
      showMessage("Please enter your name.");
      return;
    }

    if (!/^\d{5}$/.test(code)) {
      showMessage("Enter the 5-digit room code.");
      return;
    }

    myName =
      name.substring(0, 30);

    roomCode = code;

    await startMedia();

    socket.emit(
      "join-room",
      roomCode,
      myName
    );
  };


$("roomCode").addEventListener(
  "input",
  () => {
    $("roomCode").value =
      $("roomCode").value
        .replace(/\D/g, "")
        .slice(0, 5);
  }
);


/* =========================
   ROOM CREATED
========================= */

socket.on(
  "room-created",
  code => {

    roomCode =
      String(code);

    isHost = true;

    showRoom();

    $("displayRoomCode")
      .textContent = roomCode;

    $("userRole")
      .textContent = "HOST";

    setStatus(
      "Room ready. Share the code."
    );

    updateScreenButton();
  }
);


/* =========================
   ROOM STATE
========================= */

socket.on(
  "room-state",
  state => {

    roomCode =
      String(state.roomCode);

    participants =
      state.participants || [];

    isHost =
      state.hostId === socket.id;

    $("displayRoomCode")
      .textContent = roomCode;

    $("userRole")
      .textContent =
        isHost
          ? "HOST"
          : "STUDENT";

    $("participantCount")
      .textContent =
        participants.length;

    updateParticipants();

    updateWhiteboard();

    updateScreenButton();

    if (state.whiteboard) {
      drawStoredBoard(
        state.whiteboard
      );
    }

    if (
      state.materials &&
      state.materials.length
    ) {

      state.materials.forEach(
        material => {
          displayMaterial(
            material,
            true
          );
        }
      );
    }

    showRoom();
  }
);


/* =========================
   PARTICIPANTS
========================= */

function updateParticipants() {

  const box =
    $("participants");

  box.innerHTML = "";

  participants.forEach(
    participant => {

      const item =
        document.createElement("div");

      item.className =
        "participant";

      const name =
        document.createElement("div");

      name.className =
        "participant-name";

      name.textContent =
        participant.name +
        (
          participant.id === socket.id
            ? " (You)"
            : ""
        ) +
        (
          participant.isHost
            ? " - Host"
            : ""
        );

      item.appendChild(name);


      if (
        isHost &&
        participant.id !== socket.id
      ) {

        const controls =
          document.createElement("div");

        controls.className =
          "participant-controls";


        const board =
          document.createElement("button");

        board.textContent =
          participant.canWhiteboard
            ? "Whiteboard: ON"
            : "Give Whiteboard";

        board.onclick =
          () => {

            socket.emit(
              "set-whiteboard-writer",
              participant.id
            );
          };

        controls.appendChild(board);


        const audio =
          document.createElement("button");

        audio.textContent =
          participant.canAudio
            ? "Mute Audio"
            : "Allow Audio";

        audio.onclick =
          () => {

            socket.emit(
              "set-permission",
              {
                targetId:
                  participant.id,

                permission:
                  "canAudio",

                allowed:
                  !participant.canAudio
              }
            );
          };

        controls.appendChild(audio);


        const upload =
          document.createElement("button");

        upload.textContent =
          participant.canUpload
            ? "Upload: ON"
            : "Allow Upload";

        upload.onclick =
          () => {

            socket.emit(
              "set-permission",
              {
                targetId:
                  participant.id,

                permission:
                  "canUpload",

                allowed:
                  !participant.canUpload
              }
            );
          };

        controls.appendChild(upload);


        const screen =
          document.createElement("button");

        screen.textContent =
          participant.canScreenShare
            ? "Screen: ON"
            : "Allow Screen";

        screen.onclick =
          () => {

            socket.emit(
              "set-permission",
              {
                targetId:
                  participant.id,

                permission:
                  "canScreenShare",

                allowed:
                  !participant.canScreenShare
              }
            );
          };

        controls.appendChild(screen);

        item.appendChild(controls);
      }

      box.appendChild(item);
    }
  );
}


/* =========================
   WEBRTC
========================= */

function createPeer(
  peerId,
  peerName
) {

  if (peers.has(peerId)) {
    return peers.get(peerId);
  }

  const pc =
    new RTCPeerConnection({
      iceServers: [
        {
          urls:
            "stun:stun.l.google.com:19302"
        },
        {
          urls:
            "stun:stun.cloudflare.com:3478"
        }
      ]
    });

  peers.set(
    peerId,
    pc
  );

  if (localStream) {

    localStream
      .getTracks()
      .forEach(track => {

        pc.addTrack(
          track,
          localStream
        );
      });
  }

  pc.onicecandidate =
    event => {

      if (!event.candidate) {
        return;
      }

      socket.emit(
        "signal",
        {
          to: peerId,
          type: "candidate",
          candidate:
            event.candidate
        }
      );
    };


  pc.ontrack =
    event => {

      let video =
        document.getElementById(
          "video-" + peerId
        );

      if (!video) {

        const card =
          document.createElement("div");

        card.className =
          "video-card";

        video =
          document.createElement("video");

        video.id =
          "video-" + peerId;

        video.autoplay = true;
        video.playsInline = true;

        const label =
          document.createElement("div");

        label.className =
          "video-name";

        const person =
          participants.find(
            p => p.id === peerId
          );

        label.textContent =
          person
            ? person.name
            : peerName || "Student";

        card.appendChild(video);
        card.appendChild(label);

        $("videos").appendChild(card);
      }

      if (
        event.streams &&
        event.streams[0]
      ) {

        video.srcObject =
          event.streams[0];

        video.play().catch(() => {});
      }
    };


  pc.onconnectionstatechange =
    () => {

      console.log(
        peerId,
        pc.connectionState
      );

      if (
        pc.connectionState ===
        "connected"
      ) {

        setStatus(
          "Video and audio connected."
        );
      }

      if (
        pc.connectionState ===
        "failed"
      ) {

        setStatus(
          "Video connection failed."
        );
      }
    };


  return pc;
}


/* =========================
   USER JOINED
========================= */

socket.on(
  "user-joined",
  async user => {

    /*
      Only one side creates the offer.
      This prevents offer collision.
    */

    if (
      socket.id < user.id
    ) {

      const pc =
        createPeer(
          user.id,
          user.name
        );

      const offer =
        await pc.createOffer();

      await pc.setLocalDescription(
        offer
      );

      socket.emit(
        "signal",
        {
          to: user.id,
          type: "offer",
          offer
        }
      );
    }
  }
);


/* =========================
   SIGNALS
========================= */

socket.on(
  "signal",
  async data => {

    let pc =
      peers.get(data.from);

    if (!pc) {

      pc =
        createPeer(
          data.from,
          "Student"
        );
    }


    if (
      data.type === "offer"
    ) {

      await pc.setRemoteDescription(
        new RTCSessionDescription(
          data.offer
        )
      );

      const answer =
        await pc.createAnswer();

      await pc.setLocalDescription(
        answer
      );

      socket.emit(
        "signal",
        {
          to: data.from,
          type: "answer",
          answer
        }
      );
    }


    else if (
      data.type === "answer"
    ) {

      await pc.setRemoteDescription(
        new RTCSessionDescription(
          data.answer
        )
      );
    }


    else if (
      data.type === "candidate"
    ) {

      try {

        await pc.addIceCandidate(
          new RTCIceCandidate(
            data.candidate
          )
        );

      } catch (error) {

        console.error(
          "ICE candidate error:",
          error
        );
      }
    }
  }
);


/* =========================
   USER LEFT
========================= */

socket.on(
  "user-left",
  data => {

    const pc =
      peers.get(data.id);

    if (pc) {
      pc.close();
      peers.delete(data.id);
    }

    const video =
      document.getElementById(
        "video-" + data.id
      );

    if (video) {
      video.parentElement.remove();
    }
  }
);


/* =========================
   NEW HOST
========================= */

socket.on(
  "new-host",
  data => {

    isHost =
      data.hostId === socket.id;

    $("userRole")
      .textContent =
        isHost
          ? "HOST"
          : "STUDENT";

    updateParticipants();
  }
);


/* =========================
   PERMISSIONS
========================= */

socket.on(
  "permission-updated",
  ({ permission, allowed }) => {

    if (
      permission ===
      "canAudio"
    ) {

      if (localStream) {

        localStream
          .getAudioTracks()
          .forEach(track => {

            track.enabled =
              Boolean(allowed);
          });
      }
    }

    updateScreenButton();
  }
);


/* =========================
   WHITEBOARD
========================= */

function setupWhiteboard() {

  whiteboardCanvas =
    $("whiteboard");

  whiteboardContext =
    whiteboardCanvas.getContext(
      "2d"
    );


  whiteboardCanvas.addEventListener(
    "pointerdown",
    event => {

      if (!canWrite()) {
        return;
      }

      drawing = true;

      const rect =
        whiteboardCanvas
          .getBoundingClientRect();

      lastX =
        event.clientX -
        rect.left;

      lastY =
        event.clientY -
        rect.top;
    }
  );


  whiteboardCanvas.addEventListener(
    "pointermove",
    event => {

      if (
        !drawing ||
        !canWrite()
      ) {
        return;
      }

      const rect =
        whiteboardCanvas
          .getBoundingClientRect();

      const x =
        event.clientX -
        rect.left;

      const y =
        event.clientY -
        rect.top;


      drawLine(
        lastX,
        lastY,
        x,
        y
      );


      socket.emit(
        "whiteboard-draw",
        {
          x1: lastX,
          y1: lastY,
          x2: x,
          y2: y,
          width: 3
        }
      );


      lastX = x;
      lastY = y;
    }
  );


  whiteboardCanvas.addEventListener(
    "pointerup",
    () => {
      drawing = false;
    }
  );

  whiteboardCanvas.addEventListener(
    "pointerleave",
    () => {
      drawing = false;
    }
  );
}


function canWrite() {

  if (isHost) {
    return true;
  }

  const me =
    participants.find(
      p => p.id === socket.id
    );

  return Boolean(
    me &&
    me.canWhiteboard
  );
}


function updateWhiteboard() {

  $("whiteboardStatus")
    .textContent =
      canWrite()
        ? "You can write"
        : "View only";
}


function drawLine(
  x1,
  y1,
  x2,
  y2
) {

  whiteboardContext.beginPath();

  whiteboardContext.moveTo(
    x1,
    y1
  );

  whiteboardContext.lineTo(
    x2,
    y2
  );

  whiteboardContext.strokeStyle =
    "#1769ff";

  whiteboardContext.lineWidth = 3;
  whiteboardContext.lineCap =
    "round";

  whiteboardContext.stroke();
}


function drawStoredBoard(
  strokes
) {

  if (!whiteboardContext) {
    return;
  }

  strokes.forEach(
    stroke => {

      drawLine(
        stroke.x1,
        stroke.y1,
        stroke.x2,
        stroke.y2
      );
    }
  );
}


socket.on(
  "whiteboard-draw",
  stroke => {

    drawLine(
      stroke.x1,
      stroke.y1,
      stroke.x2,
      stroke.y2
    );
  }
);


socket.on(
  "whiteboard-cleared",
  () => {

    whiteboardContext.clearRect(
      0,
      0,
      whiteboardCanvas.width,
      whiteboardCanvas.height
    );
  }
);


$("clearBoardButton").onclick =
  () => {

    if (!isHost) {
      return;
    }

    socket.emit(
      "clear-whiteboard"
    );
  };


$("takeBoardButton").onclick =
  () => {

    if (!isHost) {
      return;
    }

    socket.emit(
      "take-whiteboard"
    );
  };


/* =========================
   MATERIALS
========================= */

$("uploadButton").onclick =
  () => {

    const file =
      $("materialInput").files[0];

    if (!file) {
      alert(
        "Choose an image or PDF first."
      );
      return;
    }

    if (
      !file.type.startsWith("image/") &&
      file.type !==
        "application/pdf"
    ) {

      alert(
        "Only images and PDF files are supported."
      );

      return;
    }

    if (
      file.size >
      8 * 1024 * 1024
    ) {

      alert(
        "Please keep the file under 8 MB."
      );

      return;
    }

    const reader =
      new FileReader();

    reader.onload =
      () => {

        socket.emit(
          "upload-material",
          {
            name: file.name,
            type: file.type,
            data: reader.result
          }
        );
      };

    reader.readAsDataURL(file);
  };


function displayMaterial(
  material,
  fromRoomState = false
) {

  if (
    document.getElementById(
      "material-" + material.id
    )
  ) {
    return;
  }

  const box =
    document.createElement("div");

  box.className =
    "material";

  box.id =
    "material-" + material.id;


  const title =
    document.createElement("strong");

  title.textContent =
    material.name +
    " — " +
    material.uploadedBy;

  box.appendChild(title);


  if (
    material.type ===
    "application/pdf"
  ) {

    const frame =
      document.createElement("iframe");

    frame.src =
      material.data;

    box.appendChild(frame);

  } else if (
    material.type.startsWith("image/")
  ) {

    const image =
      document.createElement("img");

    image.src =
      material.data;

    box.appendChild(image);
  }


  $("materials").prepend(box);
}


socket.on(
  "material-added",
  material => {

    displayMaterial(material);

    setStatus(
      "New study material shared."
    );
  }
);


socket.on(
  "material-error",
  message => {

    alert(message);
  }
);


/* =========================
   SCREEN SHARING
========================= */

function updateScreenButton() {

  const me =
    participants.find(
      p => p.id === socket.id
    );

  const allowed =
    isHost ||
    Boolean(
      me &&
      me.canScreenShare
    );

  $("screenButton").disabled =
    !allowed;
}


$("screenButton").onclick =
  async () => {

    if (isScreenSharing) {

      stopScreenShare();

    } else {

      startScreenShare();
    }
  };


async function startScreenShare() {

  try {

    screenStream =
      await navigator.mediaDevices
        .getDisplayMedia({
          video: true,
          audio: true
        });


    const track =
      screenStream
        .getVideoTracks()[0];

    if (!track) {
      return;
    }


    for (
      const pc of peers.values()
    ) {

      const sender =
        pc.getSenders().find(
          s =>
            s.track &&
            s.track.kind === "video"
        );

      if (sender) {

        await sender.replaceTrack(
          track
        );
      }
    }


    isScreenSharing = true;

    $("screenButton")
      .textContent =
        "Stop Sharing";

    $("screenStatus")
      .textContent =
        "You are sharing your screen.";

    socket.emit(
      "start-screen-share"
    );


    track.onended =
      () => {

        stopScreenShare();
      };

  } catch (error) {

    console.error(error);

    $("screenStatus")
      .textContent =
        "Screen sharing cancelled.";
  }
}


async function stopScreenShare() {

  if (!screenStream) {
    return;
  }

  screenStream
    .getTracks()
    .forEach(
      track => track.stop()
    );

  screenStream = null;

  const cameraTrack =
    localStream &&
    localStream.getVideoTracks()[0];


  for (
    const pc of peers.values()
  ) {

    const sender =
      pc.getSenders().find(
        s =>
          s.track &&
          s.track.kind === "video"
      );

    if (
      sender &&
      cameraTrack
    ) {

      await sender.replaceTrack(
        cameraTrack
      );
    }
  }


  isScreenSharing = false;

  $("screenButton")
    .textContent =
      "Share My Screen";

  $("screenStatus")
    .textContent =
      "Screen sharing stopped.";

  socket.emit(
    "stop-screen-share"
  );
}


socket.on(
  "screen-started",
  data => {

    $("screenStatus")
      .textContent =
        data.name +
        " is sharing their screen.";
  }
);


socket.on(
  "screen-stopped",
  () => {

    $("screenStatus")
      .textContent =
        "Screen sharing stopped.";
  }
);


socket.on(
  "screen-error",
  message => {

    alert(message);
  }
);


/* =========================
   EID AI
========================= */

$("eidOpen").onclick =
  () => {

    $("eidPanel")
      .classList.remove("hidden");
  };


$("eidClose").onclick =
  () => {

    $("eidPanel")
      .classList.add("hidden");
  };


async function askEid() {

  const input =
    $("eidQuestion");

  const question =
    input.value.trim();

  if (!question) {
    return;
  }

  addEidMessage(
    question,
    true
  );

  input.value = "";

  addEidMessage(
    "Thinking...",
    false,
    "eid-thinking"
  );

  try {

    const response =
      await fetch(
        "/api/eid",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            question
          })
        }
      );


    const data =
      await response.json();


    const thinking =
      document.getElementById(
        "eid-thinking"
      );

    if (thinking) {
      thinking.remove();
    }


    if (!response.ok) {
      throw new Error(
        data.error ||
        "Eid AI error."
      );
    }


    addEidMessage(
      data.answer,
      false
    );

  } catch (error) {

    const thinking =
      document.getElementById(
        "eid-thinking"
      );

    if (thinking) {
      thinking.remove();
    }

    addEidMessage(
      "Eid AI is unavailable right now.",
      false
    );

    console.error(error);
  }
}


function addEidMessage(
  text,
  user,
  id = ""
) {

  const box =
    document.createElement("div");

  box.className =
    "eid-message " +
    (
      user
        ? "eid-user"
        : "eid-ai"
    );

  if (id) {
    box.id = id;
  }

  box.textContent = text;

  $("eidMessages")
    .appendChild(box);

  $("eidMessages").scrollTop =
    $("eidMessages").scrollHeight;
}


$("eidSend").onclick =
  askEid;


$("eidQuestion").addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      askEid();
    }
  }
);


/* =========================
   INITIALIZATION
========================= */

setupWhiteboard();


socket.on(
  "connect",
  () => {

    console.log(
      "StudyConnect connected:",
      socket.id
    );
  }
);


socket.on(
  "room-error",
  message => {

    showMessage(message);
  }
);