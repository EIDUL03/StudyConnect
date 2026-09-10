const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const MAX_STUDENTS = 50;

const rooms = new Map();


// =====================================
// CREATE RANDOM 5-DIGIT ROOM CODE
// =====================================

function generateRoomCode() {

  let code;

  do {

    code =
      Math.floor(
        10000 + Math.random() * 90000
      ).toString();

  } while (rooms.has(code));

  return code;
}


// =====================================
// SEND ROOM STATE
// =====================================

function sendRoomState(roomCode) {

  const room = rooms.get(roomCode);

  if (!room) {
    return;
  }

  const participants = [];

  for (
    const [socketId, participant]
    of room.participants
  ) {

    participants.push({

      id: socketId,

      name: participant.name,

      isHost:
        socketId === room.hostId,

      canWhiteboard:
        participant.canWhiteboard,

      canAudio:
        participant.canAudio,

      canUpload:
        participant.canUpload,

      canScreenShare:
        participant.canScreenShare

    });

  }


  io.to(roomCode).emit(
    "room-state",
    {

      roomCode: roomCode,

      hostId: room.hostId,

      participants: participants,

      whiteboardWriterId:
        room.whiteboardWriterId,

      screenSharerId:
        room.screenSharerId

    }
  );

}


// =====================================
// SOCKET CONNECTION
// =====================================

io.on("connection", (socket) => {

  console.log(
    "User connected:",
    socket.id
  );


  // ===================================
  // CREATE ROOM
  // ===================================

  socket.on(
    "create-room",
    (requestedCode, requestedName) => {

      let roomCode = requestedCode;

      let name = requestedName;


      if (
        !name &&
        typeof requestedCode === "object"
      ) {

        roomCode =
          requestedCode.roomCode;

        name =
          requestedCode.name;

      }


      name =
        String(
          name || "Student"
        )
        .trim()
        .substring(0, 30);


      if (
        !roomCode ||
        rooms.has(roomCode)
      ) {

        roomCode =
          generateRoomCode();

      }


      const room = {

        hostId: socket.id,

        participants: new Map(),

        whiteboardWriterId:
          socket.id,

        whiteboardData: [],

        // Only one person can share screen
        screenSharerId: null

      };


      room.participants.set(
        socket.id,
        {

          name: name,

          canWhiteboard: true,

          canAudio: true,

          canUpload: true,

          canScreenShare: true

        }
      );


      rooms.set(
        roomCode,
        room
      );


      socket.join(roomCode);

      socket.roomCode =
        roomCode;

      socket.studentName =
        name;


      console.log(
        `Room ${roomCode} created by ${name}`
      );


      socket.emit(
        "room-created",
        roomCode
      );


      sendRoomState(
        roomCode
      );

    }
  );


  // ===================================
  // JOIN ROOM
  // ===================================

  socket.on(
    "join-room",
    (roomCode, requestedName) => {

      roomCode =
        String(
          roomCode || ""
        ).trim();


      let name =
        requestedName;


      if (
        typeof requestedName ===
        "object"
      ) {

        name =
          requestedName.name;

      }


      name =
        String(
          name || "Student"
        )
        .trim()
        .substring(0, 30);


      const room =
        rooms.get(roomCode);


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

      if (
        room.participants.size >=
        MAX_STUDENTS
      ) {

        socket.emit(
          "room-error",
          "Room is full. Maximum 50 students are allowed."
        );

        return;

      }


      room.participants.set(
        socket.id,
        {

          name: name,

          canWhiteboard: false,

          canAudio: true,

          canUpload: false,

          // Screen sharing disabled
          // until host allows it
          canScreenShare: false

        }
      );


      socket.join(roomCode);

      socket.roomCode =
        roomCode;

      socket.studentName =
        name;


      console.log(
        `${name} joined room ${roomCode}`
      );


      socket.to(roomCode).emit(
        "user-joined"
      );


      sendRoomState(
        roomCode
      );

    }
  );


  // ===================================
  // WEBRTC SIGNALING
  // ===================================

  socket.on(
    "signal",
    (data) => {

      if (
        !data ||
        !data.room
      ) {

        return;

      }


      socket.to(
        data.room
      ).emit(
        "signal",
        data
      );

    }
  );


  // ===================================
  // HOST:
  // WHITEBOARD PERMISSION
  // ===================================

  socket.on(
    "set-whiteboard-permission",
    (targetId) => {

      const roomCode =
        socket.roomCode;

      const room =
        rooms.get(roomCode);


      if (!room) {
        return;
      }


      if (
        socket.id !==
        room.hostId
      ) {

        return;

      }


      if (
        !room.participants.has(
          targetId
        )
      ) {

        return;

      }


      for (
        const participant
        of room.participants.values()
      ) {

        participant.canWhiteboard =
          false;

      }


      room.participants
        .get(targetId)
        .canWhiteboard =
          true;


      room.whiteboardWriterId =
        targetId;


      sendRoomState(
        roomCode
      );

    }
  );


  // ===================================
  // HOST:
  // AUDIO PERMISSION
  // ===================================

  socket.on(
    "set-audio-permission",
    (data) => {

      const roomCode =
        socket.roomCode;

      const room =
        rooms.get(roomCode);


      if (!room) {
        return;
      }


      if (
        socket.id !==
        room.hostId
      ) {

        return;

      }


      if (
        !data ||
        !room.participants.has(
          data.targetId
        )
      ) {

        return;

      }


      const allowed =
        Boolean(
          data.allowed
        );


      room.participants
        .get(data.targetId)
        .canAudio =
          allowed;


      io.to(
        data.targetId
      ).emit(
        "audio-permission",
        allowed
      );


      sendRoomState(
        roomCode
      );

    }
  );


  // ===================================
  // HOST:
  // UPLOAD PERMISSION
  // ===================================

  socket.on(
    "set-upload-permission",
    (data) => {

      const roomCode =
        socket.roomCode;

      const room =
        rooms.get(roomCode);


      if (!room) {
        return;
      }


      if (
        socket.id !==
        room.hostId
      ) {

        return;

      }


      if (
        !data ||
        !room.participants.has(
          data.targetId
        )
      ) {

        return;

      }


      const allowed =
        Boolean(
          data.allowed
        );


      room.participants
        .get(data.targetId)
        .canUpload =
          allowed;


      io.to(
        data.targetId
      ).emit(
        "upload-permission",
        allowed
      );


      sendRoomState(
        roomCode
      );

    }
  );


  // ===================================
  // HOST:
  // SCREEN SHARE PERMISSION
  // ===================================

  socket.on(
    "set-screen-share-permission",
    (data) => {

      const roomCode =
        socket.roomCode;

      const room =
        rooms.get(roomCode);


      if (!room) {
        return;
      }


      // Only host can control
      // screen sharing permission.
      if (
        socket.id !==
        room.hostId
      ) {

        return;

      }


      if (
        !data ||
        !room.participants.has(
          data.targetId
        )
      ) {

        return;

      }


      const allowed =
        Boolean(
          data.allowed
        );


      room.participants
        .get(data.targetId)
        .canScreenShare =
          allowed;


      // If permission is removed
      // while that student is sharing,
      // stop their screen share.
      if (
        !allowed &&
        room.screenSharerId ===
          data.targetId
      ) {

        room.screenSharerId =
          null;


        io.to(
          roomCode
        ).emit(
          "screen-share-stopped",
          {
            userId:
              data.targetId
          }
        );

      }


      io.to(
        data.targetId
      ).emit(
        "screen-share-permission",
        allowed
      );


      sendRoomState(
        roomCode
      );

    }
  );


  // ===================================
  // SCREEN SHARE START REQUEST
  // ===================================

  socket.on(
    "start-screen-share",
    () => {

      const roomCode =
        socket.roomCode;

      const room =
        rooms.get(roomCode);


      if (!room) {
        return;
      }


      const participant =
        room.participants.get(
          socket.id
        );


      if (!participant) {
        return;
      }


      // Host is always allowed.
      const allowed =
        socket.id ===
          room.hostId ||
        participant.canScreenShare;


      if (!allowed) {

        socket.emit(
          "screen-share-error",
          "The host has not allowed you to share your screen."
        );

        return;

      }


      // Only one screen sharer
      // at a time.
      if (
        room.screenSharerId &&
        room.screenSharerId !==
          socket.id
      ) {

        socket.emit(
          "screen-share-error",
          "Someone else is already sharing their screen."
        );

        return;

      }


      room.screenSharerId =
        socket.id;


      io.to(
        roomCode
      ).emit(
        "screen-share-started",
        {
          userId:
            socket.id,

          userName:
            participant.name

        }
      );


      sendRoomState(
        roomCode
      );

    }
  );


  // ===================================
  // SCREEN SHARE STOP
  // ===================================

  socket.on(
    "stop-screen-share",
    () => {

      const roomCode =
        socket.roomCode;

      const room =
        rooms.get(roomCode);


      if (!room) {
        return;
      }


      if (
        room.screenSharerId !==
        socket.id
      ) {

        return;

      }


      room.screenSharerId =
        null;


      io.to(
        roomCode
      ).emit(
        "screen-share-stopped",
        {
          userId:
            socket.id
        }
      );


      sendRoomState(
        roomCode
      );

    }
  );


  // ===================================
  // WHITEBOARD DRAWING
  // ===================================

  socket.on(
    "whiteboard-draw",
    (drawingData) => {

      const roomCode =
        socket.roomCode;

      const room =
        rooms.get(roomCode);


      if (!room) {
        return;
      }


      if (
        socket.id !==
        room.whiteboardWriterId
      ) {

        return;

      }


      room.whiteboardData.push(
        drawingData
      );


      if (
        room.whiteboardData.length >
        10000
      ) {

        room.whiteboardData.shift();

      }


      socket.to(
        roomCode
      ).emit(
        "whiteboard-draw",
        drawingData
      );

    }
  );


  // ===================================
  // WHITEBOARD REQUEST
  // ===================================

  socket.on(
    "request-whiteboard",
    () => {

      const roomCode =
        socket.roomCode;

      const room =
        rooms.get(roomCode);


      if (!room) {
        return;
      }


      const participant =
        room.participants.get(
          socket.id
        );


      if (!participant) {
        return;
      }


      io.to(
        room.hostId
      ).emit(
        "whiteboard-request",
        {

          studentId:
            socket.id,

          studentName:
            participant.name

        }
      );

    }
  );


  // ===================================
  // SEND WHITEBOARD DATA
  // ===================================

  socket.on(
    "request-whiteboard-data",
    () => {

      const roomCode =
        socket.roomCode;

      const room =
        rooms.get(roomCode);


      if (!room) {
        return;
      }


      socket.emit(
        "whiteboard-data",
        room.whiteboardData
      );

    }
  );


  // ===================================
  // DISCONNECT
  // ===================================

  socket.on(
    "disconnect",
    () => {

      const roomCode =
        socket.roomCode;


      if (!roomCode) {

        console.log(
          "User disconnected:",
          socket.id
        );

        return;

      }


      const room =
        rooms.get(roomCode);


      if (!room) {
        return;
      }


      const wasHost =
        socket.id ===
        room.hostId;


      // =================================
      // STOP SCREEN SHARE IF ACTIVE
      // =================================

      if (
        room.screenSharerId ===
        socket.id
      ) {

        room.screenSharerId =
          null;


        socket.to(
          roomCode
        ).emit(
          "screen-share-stopped",
          {
            userId:
              socket.id
          }
        );

      }


      // Remove participant
      room.participants.delete(
        socket.id
      );


      // =================================
      // HOST LEFT
      // =================================

      if (wasHost) {

        const remaining =
          Array.from(
            room.participants.keys()
          );


        if (
          remaining.length === 0
        ) {

          rooms.delete(
            roomCode
          );


          console.log(
            `Room ${roomCode} deleted.`
          );


          return;

        }


        const newHostId =
          remaining[0];


        room.hostId =
          newHostId;


        const newHost =
          room.participants.get(
            newHostId
          );


        newHost.canWhiteboard =
          true;

        newHost.canAudio =
          true;

        newHost.canUpload =
          true;

        newHost.canScreenShare =
          true;


        room.whiteboardWriterId =
          newHostId;


        io.to(
          roomCode
        ).emit(
          "new-host",
          {
            hostId:
              newHostId
          }
        );


        console.log(
          `New host for room ${roomCode}: ${newHostId}`
        );

      }


      // =================================
      // WHITEBOARD WRITER LEFT
      // =================================

      if (
        socket.id ===
        room.whiteboardWriterId
      ) {

        room.whiteboardWriterId =
          room.hostId;


        for (
          const [
            participantId,
            participant
          ]
          of room.participants
        ) {

          participant.canWhiteboard =
            participantId ===
            room.hostId;

        }

      }


      socket.to(
        roomCode
      ).emit(
        "user-left"
      );


      sendRoomState(
        roomCode
      );


      console.log(
        `User ${socket.id} left room ${roomCode}`
      );

    }
  );

});


// =====================================
// START SERVER
// =====================================

server.listen(
  PORT,
  () => {

    console.log(
      `StudyConnect is running on port ${PORT}`
    );

  }
);