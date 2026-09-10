const socket = io();

let localStream = null;
let peerConnection = null;
let roomCode = "";
let isCaller = false;

let pendingCandidates = [];

const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};


// ===============================
// START CAMERA + MICROPHONE
// ===============================

async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    document.getElementById("localVideo").srcObject = localStream;

    console.log("Camera and microphone started.");

    return true;

  } catch (error) {

    console.error("Camera error:", error);

    document.getElementById("roomStatus").textContent =
      "Camera/microphone permission denied.";

    return false;
  }
}


// ===============================
// CREATE WEBRTC CONNECTION
// ===============================

function createPeerConnection() {

  if (peerConnection) {
    return peerConnection;
  }

  peerConnection = new RTCPeerConnection(configuration);

  // Add camera + microphone tracks
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });


  // Receive other student's video/audio
  peerConnection.ontrack = event => {

    console.log("Remote stream received.");

    if (event.streams && event.streams[0]) {

      document.getElementById("remoteVideo").srcObject =
        event.streams[0];

      document.getElementById("roomStatus").textContent =
        "Other student connected.";

      document.getElementById("remoteVideo").play().catch(() => {});
    }
  };


  // Send ICE candidates through server
  peerConnection.onicecandidate = event => {

    if (event.candidate) {

      socket.emit("signal", {
        room: roomCode,
        candidate: event.candidate
      });
    }
  };


  peerConnection.onconnectionstatechange = () => {

    console.log(
      "Connection state:",
      peerConnection.connectionState
    );

    if (peerConnection.connectionState === "connected") {

      document.getElementById("roomStatus").textContent =
        "Connected — video and audio active.";
    }

    if (
      peerConnection.connectionState === "disconnected" ||
      peerConnection.connectionState === "failed"
    ) {

      document.getElementById("roomStatus").textContent =
        "Connection lost. Trying to reconnect...";
    }
  };


  return peerConnection;
}


// ===============================
// CREATE ROOM
// ===============================

function createRoom() {

  const name =
    document.getElementById("name").value.trim();

  if (!name) {

    document.getElementById("message").textContent =
      "Please enter your name first.";

    return;
  }


  roomCode =
    Math.floor(10000 + Math.random() * 90000).toString();

  isCaller = true;

  socket.emit("create-room", roomCode);
}


// ===============================
// ROOM CREATED
// ===============================

socket.on("room-created", async code => {

  roomCode = code;

  alert("Your Study Room Code is: " + roomCode);

  document.getElementById("lobby").style.display = "none";

  document.getElementById("room").style.display = "block";

  document.getElementById("roomStatus").textContent =
    "Room Code: " + roomCode + " — waiting for student...";

  await startCamera();
});


// ===============================
// JOIN ROOM
// ===============================

async function joinRoom() {

  const name =
    document.getElementById("name").value.trim();

  roomCode =
    document.getElementById("roomCode").value.trim();


  if (!name) {

    document.getElementById("message").textContent =
      "Please enter your name first.";

    return;
  }


  if (!/^\d{5}$/.test(roomCode)) {

    document.getElementById("message").textContent =
      "Enter a valid 5-digit room code.";

    return;
  }


  isCaller = false;

  document.getElementById("lobby").style.display = "none";

  document.getElementById("room").style.display = "block";

  document.getElementById("roomStatus").textContent =
    "Starting camera and microphone...";


  const started = await startCamera();

  if (!started) {
    return;
  }


  socket.emit("join-room", roomCode);

  document.getElementById("roomStatus").textContent =
    "Joined room. Waiting for connection...";
}


// ===============================
// OTHER STUDENT JOINED
// ===============================

socket.on("user-joined", async () => {

  console.log("Other student joined.");

  document.getElementById("roomStatus").textContent =
    "Student joined. Connecting...";


  if (!localStream) {

    const started = await startCamera();

    if (!started) {
      return;
    }
  }


  const pc = createPeerConnection();


  // Only room creator creates the offer
  if (isCaller) {

    console.log("Creating offer...");

    const offer =
      await pc.createOffer();

    await pc.setLocalDescription(offer);


    socket.emit("signal", {

      room: roomCode,

      offer: pc.localDescription
    });
  }
});


// ===============================
// SIGNALING
// ===============================

socket.on("signal", async data => {

  console.log("Signal received:", data);

  if (!localStream) {

    const started = await startCamera();

    if (!started) {
      return;
    }
  }


  const pc = createPeerConnection();


  // -------------------------------
  // RECEIVED OFFER
  // -------------------------------

  if (data.offer) {

    console.log("Offer received.");

    await pc.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );


    // Add any ICE candidates that arrived early
    for (const candidate of pendingCandidates) {

      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.error(
          "ICE candidate error:",
          error
        );
      }
    }

    pendingCandidates = [];


    const answer =
      await pc.createAnswer();

    await pc.setLocalDescription(answer);


    socket.emit("signal", {

      room: roomCode,

      answer: pc.localDescription
    });
  }


  // -------------------------------
  // RECEIVED ANSWER
  // -------------------------------

  if (data.answer) {

    console.log("Answer received.");

    await pc.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );


    // Add early ICE candidates
    for (const candidate of pendingCandidates) {

      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.error(
          "ICE candidate error:",
          error
        );
      }
    }

    pendingCandidates = [];
  }


  // -------------------------------
  // RECEIVED ICE CANDIDATE
  // -------------------------------

  if (data.candidate) {

    const candidate =
      new RTCIceCandidate(data.candidate);


    // If remote description is not ready,
    // temporarily store candidate.
    if (!pc.remoteDescription) {

      pendingCandidates.push(candidate);

      console.log(
        "ICE candidate stored temporarily."
      );

    } else {

      try {

        await pc.addIceCandidate(candidate);

        console.log(
          "ICE candidate added."
        );

      } catch (error) {

        console.error(
          "Failed to add ICE candidate:",
          error
        );
      }
    }
  }
});


// ===============================
// OTHER STUDENT LEFT
// ===============================

socket.on("user-left", () => {

  console.log("Other student left.");

  document.getElementById("remoteVideo").srcObject =
    null;


  if (peerConnection) {

    peerConnection.close();

    peerConnection = null;
  }


  pendingCandidates = [];


  document.getElementById("roomStatus").textContent =
    "Other student left the room. Waiting...";
});