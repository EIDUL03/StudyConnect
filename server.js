const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const OpenAI = require("openai");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 12 * 1024 * 1024,
  cors: {
    origin: "*"
  }
});

app.use(express.json({ limit: "12mb" }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;

const rooms = new Map();

function generateRoomCode() {
  let code;

  do {
    code = String(
      Math.floor(10000 + Math.random() * 90000)
    );
  } while (rooms.has(code));

  return code;
}

function cleanName(name) {
  return String(name || "Student")
    .trim()
    .slice(0, 30) || "Student";
}

function publicParticipants(room) {
  return Array.from(room.users.values()).map(user => ({
    id: user.id,
    name: user.name,
    isHost: user.id === room.hostId,
    canWhiteboard: user.id === room.whiteboardWriterId,
    canAudio: user.canAudio,
    canUpload: user.canUpload,
    canScreenShare: user.canScreenShare
  }));
}

function roomState(room) {
  return {
    roomCode: room.code,
    hostId: room.hostId,
    whiteboardWriterId: room.whiteboardWriterId,
    screenSharerId: room.screenSharerId,
    participants: publicParticipants(room),
    whiteboard: room.whiteboard,
    materials: room.materials
  };
}

function emitRoomState(room) {
  io.to(room.code).emit("room-state", roomState(room));
}

function findRoomForSocket(socketId) {
  for (const room of rooms.values()) {
    if (room.users.has(socketId)) {
      return room;
    }
  }

  return null;
}

function requireRoom(socket) {
  return findRoomForSocket(socket.id);
}

/* =========================
   AI
========================= */

app.post("/api/eid", async (req, res) => {
  try {
    const question = String(req.body.question || "").trim();

    if (!question) {
      return res.status(400).json({
        error: "Please enter a question."
      });
    }

    if (!openai) {
      return res.status(503).json({
        error:
          "Eid AI is not configured yet. Add OPENAI_API_KEY to the server environment."
      });
    }

    const response = await openai.responses.create({
      model: "gpt-5.6-luna",
      instructions:
        "You are Eid AI, the study assistant inside StudyConnect. " +
        "Help students understand academic questions clearly. " +
        "Give direct, educational answers. " +
        "For school questions, use simple explanations and examples. " +
        "Do not pretend to know information you are unsure about.",
      input: question
    });

    res.json({
      answer: response.output_text || "I could not generate an answer."
    });

  } catch (error) {
    console.error("Eid AI error:", error);

    res.status(500).json({
      error: "Eid AI could not answer right now."
    });
  }
});

/* =========================
   SOCKET.IO
========================= */

io.on("connection", socket => {
  console.log("Connected:", socket.id);

  socket.on("create-room", name => {
    const code = generateRoomCode();

    const user = {
      id: socket.id,
      name: cleanName(name),
      canAudio: true,
      canUpload: true,
      canScreenShare: true
    };

    const room = {
      code,
      hostId: socket.id,
      users: new Map([[socket.id, user]]),
      whiteboardWriterId: socket.id,
      screenSharerId: null,
      whiteboard: [],
      materials: []
    };

    rooms.set(code, room);

    socket.join(code);

    socket.emit("room-created", code);

    emitRoomState(room);

    console.log(
      `Room ${code} created by ${user.name}`
    );
  });

  socket.on("join-room", (code, name) => {
    code = String(code || "").trim();

    const room = rooms.get(code);

    if (!room) {
      socket.emit(
        "room-error",
        "Room does not exist."
      );
      return;
    }

    if (room.users.size >= 50) {
      socket.emit(
        "room-error",
        "This room is full. Maximum 50 students."
      );
      return;
    }

    if (room.users.has(socket.id)) {
      return;
    }

    const user = {
      id: socket.id,
      name: cleanName(name),
      canAudio: false,
      canUpload: false,
      canScreenShare: false
    };

    room.users.set(socket.id, user);

    socket.join(code);

    socket.emit(
      "room-state",
      roomState(room)
    );

    socket.to(code).emit(
      "user-joined",
      {
        id: socket.id,
        name: user.name
      }
    );

    emitRoomState(room);

    console.log(
      `${user.name} joined room ${code}`
    );
  });

  /* =========================
     WEBRTC SIGNALING
  ========================= */

  socket.on("signal", data => {
    if (!data || !data.to) {
      return;
    }

    io.to(data.to).emit("signal", {
      from: socket.id,
      type: data.type,
      offer: data.offer,
      answer: data.answer,
      candidate: data.candidate
    });
  });

  /* =========================
     WHITEBOARD
  ========================= */

  socket.on("whiteboard-draw", data => {
    const room = requireRoom(socket);

    if (!room) {
      return;
    }

    const canWrite =
      socket.id === room.hostId ||
      socket.id === room.whiteboardWriterId;

    if (!canWrite) {
      return;
    }

    if (!data) {
      return;
    }

    const stroke = {
      x1: Number(data.x1),
      y1: Number(data.y1),
      x2: Number(data.x2),
      y2: Number(data.y2),
      width: Number(data.width) || 3
    };

    room.whiteboard.push(stroke);

    if (room.whiteboard.length > 5000) {
      room.whiteboard.shift();
    }

    socket.to(room.code).emit(
      "whiteboard-draw",
      stroke
    );
  });

  socket.on("clear-whiteboard", () => {
    const room = requireRoom(socket);

    if (!room) {
      return;
    }

    if (socket.id !== room.hostId) {
      return;
    }

    room.whiteboard = [];

    io.to(room.code).emit(
      "whiteboard-cleared"
    );
  });

  socket.on(
    "set-whiteboard-writer",
    targetId => {
      const room = requireRoom(socket);

      if (!room) {
        return;
      }

      if (socket.id !== room.hostId) {
        return;
      }

      if (!room.users.has(targetId)) {
        return;
      }

      room.whiteboardWriterId = targetId;

      emitRoomState(room);
    }
  );

  socket.on(
    "take-whiteboard",
    () => {
      const room = requireRoom(socket);

      if (!room) {
        return;
      }

      if (socket.id !== room.hostId) {
        return;
      }

      room.whiteboardWriterId = room.hostId;

      emitRoomState(room);
    }
  );

  /* =========================
     HOST PERMISSIONS
  ========================= */

  socket.on(
    "set-permission",
    ({ targetId, permission, allowed }) => {
      const room = requireRoom(socket);

      if (!room) {
        return;
      }

      if (socket.id !== room.hostId) {
        return;
      }

      const target = room.users.get(targetId);

      if (!target) {
        return;
      }

      if (
        ![
          "canAudio",
          "canUpload",
          "canScreenShare"
        ].includes(permission)
      ) {
        return;
      }

      target[permission] =
        Boolean(allowed);

      io.to(targetId).emit(
        "permission-updated",
        {
          permission,
          allowed: Boolean(allowed)
        }
      );

      emitRoomState(room);
    }
  );

  /* =========================
     SCREEN SHARING
  ========================= */

  socket.on("start-screen-share", () => {
    const room = requireRoom(socket);

    if (!room) {
      return;
    }

    const user = room.users.get(socket.id);

    if (!user) {
      return;
    }

    const allowed =
      socket.id === room.hostId ||
      user.canScreenShare;

    if (!allowed) {
      socket.emit(
        "screen-error",
        "The host has not allowed screen sharing for you."
      );
      return;
    }

    if (
      room.screenSharerId &&
      room.screenSharerId !== socket.id
    ) {
      socket.emit(
        "screen-error",
        "Someone else is already sharing their screen."
      );
      return;
    }

    room.screenSharerId = socket.id;

    io.to(room.code).emit(
      "screen-started",
      {
        id: socket.id,
        name: user.name
      }
    );

    emitRoomState(room);
  });

  socket.on("stop-screen-share", () => {
    const room = requireRoom(socket);

    if (!room) {
      return;
    }

    if (room.screenSharerId !== socket.id) {
      return;
    }

    room.screenSharerId = null;

    io.to(room.code).emit(
      "screen-stopped",
      {
        id: socket.id
      }
    );

    emitRoomState(room);
  });

  /* =========================
     STUDY MATERIAL
  ========================= */

  socket.on(
    "upload-material",
    material => {
      const room = requireRoom(socket);

      if (!room) {
        return;
      }

      const user = room.users.get(socket.id);

      if (!user) {
        return;
      }

      const allowed =
        socket.id === room.hostId ||
        user.canUpload;

      if (!allowed) {
        socket.emit(
          "material-error",
          "The host has not allowed you to upload."
        );
        return;
      }

      if (!material || !material.data) {
        return;
      }

      const item = {
        id:
          Date.now().toString() +
          Math.random().toString(36).slice(2),

        name:
          String(material.name || "Study material")
            .slice(0, 120),

        type:
          String(material.type || "")
            .slice(0, 100),

        data: material.data,

        uploadedBy:
          user.name
      };

      room.materials.push(item);

      if (room.materials.length > 10) {
        room.materials.shift();
      }

      io.to(room.code).emit(
        "material-added",
        item
      );
    }
  );

  /* =========================
     DISCONNECT
  ========================= */

  socket.on("disconnect", () => {
    const room = findRoomForSocket(socket.id);

    if (!room) {
      console.log(
        "Disconnected:",
        socket.id
      );
      return;
    }

    const user = room.users.get(socket.id);

    room.users.delete(socket.id);

    if (
      room.screenSharerId === socket.id
    ) {
      room.screenSharerId = null;

      io.to(room.code).emit(
        "screen-stopped",
        {
          id: socket.id
        }
      );
    }

    if (
      room.whiteboardWriterId === socket.id
    ) {
      room.whiteboardWriterId =
        room.hostId;
    }

    if (room.hostId === socket.id) {
      const nextHost =
        room.users.values().next().value;

      if (nextHost) {
        room.hostId = nextHost.id;
        nextHost.canAudio = true;
        nextHost.canUpload = true;
        nextHost.canScreenShare = true;
        room.whiteboardWriterId =
          nextHost.id;

        io.to(room.code).emit(
          "new-host",
          {
            hostId: nextHost.id
          }
        );
      }
    }

    socket.to(room.code).emit(
      "user-left",
      {
        id: socket.id
      }
    );

    if (room.users.size === 0) {
      rooms.delete(room.code);
      console.log(
        `Room ${room.code} deleted`
      );
    } else {
      emitRoomState(room);
    }

    console.log(
      `${user ? user.name : socket.id} left ${room.code}`
    );
  });
});

server.listen(PORT, () => {
  console.log(
    `StudyConnect running on port ${PORT}`
  );
});