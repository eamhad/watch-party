const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Folder on disk where video files live.
// Set VIDEOS_PATH to point anywhere on your system, e.g.
//   Windows: C:\Users\you\Movies
//   Mac/Linux: /home/you/Movies
// Falls back to a local "videos" folder if not set.
const VIDEOS_DIR = process.env.VIDEOS_PATH || path.join(__dirname, "videos");

app.use(express.static(path.join(__dirname, "public")));
app.use("/videos", express.static(VIDEOS_DIR));

// Make sure the videos folder actually exists before anyone tries to upload to it
try {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
} catch (e) {
    console.error("Could not create videos directory:", e.message);
}

// =========================
// FILE UPLOAD (host uploads a movie directly from the room)
// =========================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, VIDEOS_DIR);
    },
    filename: (req, file, cb) => {
        const safeName = Date.now() + "-" +
            file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        cb(null, safeName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB cap
    fileFilter: (req, file, cb) => {
        const isMp4 =
            file.mimetype === "video/mp4" ||
            file.originalname.toLowerCase().endsWith(".mp4");

        if (isMp4) {
            cb(null, true);
        } else {
            cb(new Error("Only .mp4 files are allowed"));
        }
    }
});

app.post("/api/upload", (req, res) => {
    upload.single("video")(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        res.json({ filename: req.file.filename });
    });
});

// =========================
// IN-MEMORY ROOM STORE
// =========================
// rooms[code] = {
//   users: { socketId: username },
//   hostId: socketId | null,
//   movie: string | null,
//   currentTime: number,
//   playing: boolean
// }
const rooms = {};

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do {
        code = "";
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms[code]);
    return code;
}

function emitUsers(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    const names = Object.values(room.users);
    io.to(roomCode).emit("users", names);
}

function timeNow() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// =========================
// VIDEO LIST API
// =========================
app.get("/api/videos", (req, res) => {
    fs.readdir(VIDEOS_DIR, (err, files) => {
        if (err) {
            return res.json([]);
        }

        const videos = files.filter(file =>
            file.toLowerCase().endsWith(".mp4")
        );

        res.json(videos);
    });
});

// =========================
// SOCKET.IO
// =========================
io.on("connection", (socket) => {

    // ---- CREATE ROOM ----
    socket.on("createRoom", ({ username }) => {
        if (!username || !username.trim()) {
            socket.emit("createError", "Name is required");
            return;
        }

        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            users: {},
            hostId: null,
            movie: null,
            currentTime: 0,
            playing: false
        };

        socket.emit("roomCreated", { roomCode });
    });

    // ---- CHECK ROOM EXISTS (used by home page before joining) ----
    socket.on("checkRoom", ({ roomCode }, callback) => {
        const exists = !!rooms[roomCode];
        if (typeof callback === "function") callback(exists);
    });

    // ---- JOIN ROOM (called from room.html on load) ----
    socket.on("joinRoom", ({ username, roomCode, isHost }) => {
        const room = rooms[roomCode];

        if (!room) {
            socket.emit("joinError", "Room not found");
            return;
        }

        socket.join(roomCode);
        socket.data.username = username;
        socket.data.roomCode = roomCode;

        room.users[socket.id] = username;

        // First host to actually connect on the room page claims host status
        if (isHost && !room.hostId) {
            room.hostId = socket.id;
        }

        io.to(roomCode).emit("systemMessage", `${username} joined the room`);
        emitUsers(roomCode);

        // Sync the newcomer to current state
        socket.emit("syncState", {
            movie: room.movie,
            currentTime: room.currentTime,
            playing: room.playing
        });
    });

    // ---- CHAT ----
    socket.on("chat", ({ roomCode, username, message }) => {
        if (!rooms[roomCode]) return;

        io.to(roomCode).emit("chat", {
            username,
            message,
            time: timeNow()
        });
    });

    // ---- CHANGE MOVIE (host only) ----
    socket.on("changeMovie", ({ roomCode, movie }) => {
        const room = rooms[roomCode];
        if (!room) return;
        if (socket.id !== room.hostId) return; // ignore non-host attempts

        room.movie = movie;
        room.currentTime = 0;
        room.playing = false;

        io.to(roomCode).emit("movieChanged", movie);
    });

    // ---- PLAYBACK CONTROL (play/pause/seek, host only) ----
    socket.on("playbackControl", ({ roomCode, action, currentTime }) => {
        const room = rooms[roomCode];
        if (!room) return;
        if (socket.id !== room.hostId) return; // only host drives playback

        room.currentTime = currentTime;
        room.playing = action === "play";

        socket.to(roomCode).emit("playbackControl", { action, currentTime });
    });

    // ---- DISCONNECT ----
    socket.on("disconnect", () => {
        const roomCode = socket.data.roomCode;
        const username = socket.data.username;
        const room = rooms[roomCode];

        if (!room) return;

        delete room.users[socket.id];

        if (socket.id === room.hostId) {
            // Host left -> close the room for everyone
            io.to(roomCode).emit("roomClosed");
            delete rooms[roomCode];
            return;
        }

        if (username) {
            io.to(roomCode).emit("systemMessage", `${username} left the room`);
        }

        if (Object.keys(room.users).length === 0) {
            delete rooms[roomCode];
        } else {
            emitUsers(roomCode);
        }
    });

});

server.listen(PORT, () => {
    console.log(`Watch Party server running on http://localhost:${PORT}`);
});
