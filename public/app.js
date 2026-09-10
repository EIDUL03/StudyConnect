const socket = io();

let localStream = null;
let peerConnection = null;
let roomCode = "";

const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    document.getElementById("localVideo").srcObject = localStream;

    return true;
  } catch (error) {
    console.error(error);
    document.getElementById("roomStatus").textContent =
      "Camera/microphone permission denied.";
    return false;
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(configuration);

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = event => {
    document.getElementById("remoteVideo").srcObject =
      event.streams[0];

    document.getElementById("roomStatus").textContent =
      "Other student connected";
  };

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("signal", {
        room: roomCode,
        candidate: event.candidate
      });
    }
  };
}

function createRoom() {
  const name = document.getElementById("name").value.trim();

  if (!name) {
    document.getElementById("message").textContent =
      "Please enter your name first.";
    return;
  }

  roomCode = Math.floor(10000 + Math.random() * 90000).toString();

  socket.emit("create-room", roomCode);
}

socket.on("room-created", async code => {
  roomCode = code;

  alert("Your Study Room Code is: " + roomCode);

  document.getElementById("lobby").style.display = "none";
  document.getElementById("room").style.display = "block";

  document.getElementById("roomStatus").textContent =
    "Room Code: " + roomCode;

  await startCamera();
});

function joinRoom() {
  const name = document.getElementById("name").value.trim();
  roomCode = document.getElementById("roomCode").value.trim();

  if (!name) {
    document.getElementById("message").textContent =
      "Please enter your name first.";
    return;
  }

  if (roomCode.length !== 5) {
    document.getElementById("message").textContent =
      "Enter a valid 5-digit room code.";
    return;
  }

  socket.emit("join-room", roomCode);

  document.getElementById("lobby").style.display = "none";
  document.getElementById("room").style.display = "block";

  document.getElementById("roomStatus").textContent =
    "Starting camera...";

  startCamera();
}

socket.on("user-joined", async () => {
  document.getElementById("roomStatus").textContent =
    "Student joined. Connecting...";

  if (!localStream) {
    await startCamera();
  }

  createPeerConnection();

  const offer = await peerConnection.createOffer();

  await peerConnection.setLocalDescription(offer);

  socket.emit("signal", {
    room: roomCode,
    offer: offer
  });
});

socket.on("signal", async data => {
  if (!localStream) {
    await startCamera();
  }

  if (!peerConnection) {
    createPeerConnection();
  }

  if (data.offer) {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );

    const answer = await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(answer);

    socket.emit("signal", {
      room: roomCode,
      answer: answer
    });
  }

  if (data.answer) {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );
  }

  if (data.candidate) {
    try {
      await peerConnection.addIceCandidate(
        new RTCIceCandidate(data.candidate)
      );
    } catch (error) {
      console.error(error);
    }
  }
});

socket.on("user-left", () => {
  document.getElementById("remoteVideo").srcObject = null;

  document.getElementById("roomStatus").textContent =
    "Other student left the room.";
});