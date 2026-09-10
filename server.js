const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("create-room", (roomCode) => {
    socket.join(roomCode);
    socket.roomCode = roomCode;

    socket.emit("room-created", roomCode);
  });

  socket.on("join-room", (roomCode) => {
    socket.join(roomCode);
    socket.roomCode = roomCode;

    socket.to(roomCode).emit("user-joined");
  });

  socket.on("signal", (data) => {
    socket.to(data.room).emit("signal", data);
  });

  socket.on("disconnect", () => {
    if (socket.roomCode) {
      socket.to(socket.roomCode).emit("user-left");
    }

    console.log("A user disconnected");
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`StudyConnect is running at http://localhost:${PORT}`);
});