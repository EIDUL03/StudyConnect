const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// Maximum students allowed in one room
const MAX_STUDENTS = 50;

// Store all active rooms
const rooms = new Map();


// =====================================
// CREATE RANDOM 5-DIGIT ROOM CODE
// =====================================

function generateRoomCode() {

  let code;

  do {
    code = Math.floor(10000 + Math.random() * 90000).toString();
  } while (rooms.has(code));

  return code;
}


// =====================================
// SEND ROOM INFORMATION
// =====================================

function sendRoomState(roomCode) {

  const room = rooms.get(roomCode);

  if (!room) {
    return;
  }

  const participants = [];

  for (const [socketId, participant] of room.participants) {

    participants.push({
      id: socketId,
      name: participant.name,
      isHost: socketId === room.hostId,
      canWhiteboard: participant.canWhiteboard,
      canAudio: participant.canAudio,
      canUpload: participant.canUpload
    });
  }

  io.to(roomCode).emit("room-state", {
    roomCode: roomCode,
    hostId: room.hostId,
    participants: participants,
    whiteboardWriterId: room.whiteboardWriterId
  });
}


// =====================================
// SOCKET CONNECTION
// =====================================

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);


  // ===================================
  // CREATE ROOM
  // ===================================

  socket.on("create-room", (requestedCode, requestedName) => {

    // Support old client format temporarily
    let roomCode = requestedCode;
    let name = requestedName;

    if (!name && typeof requestedCode === "object") {
      roomCode = requestedCode.roomCode;
      name = requestedCode.name;
    }

    name = String(name || "Student").trim().substring(0, 30);


    // If requested room code already exists,
    // create a new unique code.
    if (!roomCode || rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }


    // Create room
    const room = {

      hostId: socket.id,

      participants: new Map(),

      // Only one person can write at a time
      whiteboardWriterId: socket.id,

      // Whiteboard data will be added in the next stage
      whiteboardData: []
    };


    // Add host
    room.participants.set(socket.id, {

      name: name,

      canWhiteboard: true,

      canAudio: true,

      canUpload: true
    });


    rooms.set(roomCode, room);

    socket.join(roomCode);

    socket.roomCode = roomCode;
    socket.studentName = name;


    console.log(
      `Room ${roomCode} created by ${name}`
    );


    socket.emit("room-created", roomCode);

    sendRoomState(roomCode);
  });


  // ===================================
  // JOIN ROOM
  // ===================================

  socket.on("join-room", (roomCode, requestedName) => {

    roomCode = String(roomCode || "").trim();

    let name = requestedName;

    // Support object format
    if (typeof requestedName === "object") {
      name = requestedName.name;
    }

    name = String(name || "Student").trim().substring(0, 30);


    // Check room
    const room = rooms.get(roomCode);

    if (!room) {

      socket.emit(
        "room-error",
        "Room does not exist."
      );

      return;
    }


    // =================================
    // MAXIMUM 50 STUDENTS
    // =================================

    if (room.participants.size >= MAX_STUDENTS) {

      socket.emit(
        "room-error",
        "Room is full. Maximum 50 students are allowed."
      );

      return;
    }


    // Add student
    room.participants.set(socket.id, {

      name: name,

      // New students cannot write initially
      canWhiteboard: false,

      // Audio allowed initially
      canAudio: true,

      // Upload disabled initially
      canUpload: false
    });


    socket.join(roomCode);

    socket.roomCode = roomCode;
    socket.studentName = name;


    console.log(
      `${name} joined room ${roomCode}`
    );


    // Tell existing students that someone joined
    socket.to(roomCode).emit("user-joined");


    // Send updated participant list
    sendRoomState(roomCode);
  });


  // ===================================
  // EXISTING WEBRTC SIGNALING
  // ===================================

  socket.on("signal", (data) => {

    if (!data || !data.room) {
      return;
    }

    socket.to(data.room).emit("signal", data);
  });


  // ===================================
  // HOST: WHITEBOARD PERMISSION
  // ===================================

  socket.on("set-whiteboard-permission", (targetId) => {

    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      return;
    }


    // Only host can control whiteboard
    if (socket.id !== room.hostId) {

      console.log(
        "Unauthorized whiteboard permission request."
      );

      return;
    }


    // Target must exist
    if (!room.participants.has(targetId)) {
      return;
    }


    // Remove permission from everyone
    for (const participant of room.participants.values()) {
      participant.canWhiteboard = false;
    }


    // Give permission to selected student
    room.participants.get(targetId).canWhiteboard = true;

    room.whiteboardWriterId = targetId;


    console.log(
      `Whiteboard permission given to ${targetId}`
    );


    sendRoomState(roomCode);
  });


  // ===================================
  // HOST: AUDIO PERMISSION
  // ===================================

  socket.on("set-audio-permission", (data) => {

    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      return;
    }


    // Only host can control audio
    if (socket.id !== room.hostId) {
      return;
    }


    if (!data || !room.participants.has(data.targetId)) {
      return;
    }


    room.participants.get(data.targetId).canAudio =
      Boolean(data.allowed);


    // Tell the selected student
    io.to(data.targetId).emit(
      "audio-permission",
      Boolean(data.allowed)
    );


    sendRoomState(roomCode);
  });


  // ===================================
  // HOST: UPLOAD PERMISSION
  // ===================================

  socket.on("set-upload-permission", (data) => {

    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      return;
    }


    // Only host can control uploads
    if (socket.id !== room.hostId) {
      return;
    }


    if (!data || !room.participants.has(data.targetId)) {
      return;
    }


    room.participants.get(data.targetId).canUpload =
      Boolean(data.allowed);


    // Tell selected student
    io.to(data.targetId).emit(
      "upload-permission",
      Boolean(data.allowed)
    );


    sendRoomState(roomCode);
  });


  // ===================================
  // WHITEBOARD DRAWING
  // ===================================

  socket.on("whiteboard-draw", (drawingData) => {

    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      return;
    }


    // Only the currently authorized writer
    // can send drawing data.
    if (socket.id !== room.whiteboardWriterId) {
      return;
    }


    // Save drawing operation
    room.whiteboardData.push(drawingData);


    // Prevent unlimited memory growth
    if (room.whiteboardData.length > 10000) {
      room.whiteboardData.shift();
    }


    // Send drawing to everyone else
    socket.to(roomCode).emit(
      "whiteboard-draw",
      drawingData
    );
  });


  // ===================================
  // NEW USER REQUESTS WHITEBOARD
  // ===================================

  socket.on("request-whiteboard", () => {

    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      return;
    }


    // Send request to host
    io.to(room.hostId).emit(
      "whiteboard-request",
      {
        studentId: socket.id,
        studentName: room.participants.get(socket.id)?.name
      }
    );
  });


  // ===================================
  // SEND WHITEBOARD DATA TO NEW USER
  // ===================================

  socket.on("request-whiteboard-data", () => {

    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      return;
    }


    socket.emit(
      "whiteboard-data",
      room.whiteboardData
    );
  });


  // ===================================
  // DISCONNECT
  // ===================================

  socket.on("disconnect", () => {

    const roomCode = socket.roomCode;

    if (!roomCode) {
      console.log(
        "User disconnected:",
        socket.id
      );

      return;
    }


    const room = rooms.get(roomCode);

    if (!room) {
      return;
    }


    const wasHost =
      socket.id === room.hostId;


    // Remove participant
    room.participants.delete(socket.id);


    // =================================
    // HOST LEFT
    // =================================

    if (wasHost) {

      const remaining =
        Array.from(room.participants.keys());


      if (remaining.length === 0) {

        // Nobody left
        rooms.delete(roomCode);

        console.log(
          `Room ${roomCode} deleted.`
        );

        return;
      }


      // Give host role to first remaining student
      const newHostId = remaining[0];

      room.hostId = newHostId;


      // New host automatically gets
      // full permissions
      const newHost =
        room.participants.get(newHostId);

      newHost.canWhiteboard = true;
      newHost.canAudio = true;
      newHost.canUpload = true;

      room.whiteboardWriterId = newHostId;


      io.to(roomCode).emit(
        "new-host",
        {
          hostId: newHostId
        }
      );


      console.log(
        `New host for room ${roomCode}: ${newHostId}`
      );
    }


    // If the whiteboard writer left,
    // give writing permission to host.
    if (socket.id === room.whiteboardWriterId) {

      room.whiteboardWriterId =
        room.hostId;


      for (const [
        participantId,
        participant
      ] of room.participants) {

        participant.canWhiteboard =
          participantId === room.hostId;
      }
    }


    // Tell other students
    socket.to(roomCode).emit("user-left");


    // Update everyone
    sendRoomState(roomCode);


    console.log(
      `User ${socket.id} left room ${roomCode}`
    );
  });
});


// =====================================
// START SERVER
// =====================================

server.listen(PORT, () => {

  console.log(
    `StudyConnect is running on port ${PORT}`
  );

});