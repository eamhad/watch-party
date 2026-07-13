const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

const PORT = process.env.PORT || 3000;

// =========================
// BACKBLAZE B2 (S3-compatible, private bucket — no card needed)
// =========================
const b2 = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APPLICATION_KEY
    }
});

// Get a fresh, temporary link to stream/watch a stored video (bucket is private)
async function getPlaybackUrl(key) {
    if (!key) return null;

    const command = new GetObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key
    });

    return await getSignedUrl(b2, command, { expiresIn: 6 * 60 * 60 }); // 6 hours
}

// Get a temporary link the host's browser can upload directly to
app.post("/api/upload-url", async (req, res) => {
    try {
        const { filename } = req.body;

        if (!filename) {
            return res.status(400).json({ error: "filename is required" });
        }

        const key = Date.now() + "-" +
            filename.replace(/[^a-zA-Z0-9.\-_]/g, "_");

        const command = new PutObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: key,
            ContentType: "video/mp4"
        });

        const uploadUrl = await getSignedUrl(b2, command, { expiresIn: 3600 });

        res.json({ uploadUrl, key });

    } catch (e) {
        console.error("[b2] failed to create upload URL:", e.message);
        res.status(500).json({ error: "Could not create upload URL" });
    }
});

// List videos already sitting in the B2 bucket (e.g. uploaded via Backblaze's own dashboard)
app.get("/api/b2-videos", async (req, res) => {
    try {
        const command = new ListObjectsV2Command({
            Bucket: process.env.B2_BUCKET_NAME
        });

        const result = await b2.send(command);
        const keys = (result.Contents || [])
            .map(obj => obj.Key)
            .filter(key => key.toLowerCase().endsWith(".mp4"));

        res.json(keys);

    } catch (e) {
        console.error("[b2] failed to list videos:", e.message);
        res.status(500).json({ error: "Could not list videos" });
    }
});

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
    console.log(`[upload] request started, content-length: ${req.headers["content-length"]}`);

    req.on("aborted", () => {
        console.error("[upload] request ABORTED by client mid-upload");
    });

    req.on("close", () => {
        if (!res.writableEnded) {
            console.error("[upload] connection CLOSED before response was sent");
        }
    });

    upload.single("video")(req, res, (err) => {
        if (err) {
            console.error("[upload] multer error:", err.message);
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            console.error("[upload] no file received");
            return res.status(400).json({ error: "No file uploaded" });
        }
        console.log(`[upload] success: ${req.file.filename} (${req.file.size} bytes)`);
        res.json({ filename: req.file.filename });
    });
});

// =========================
// IN-MEMORY ROOM STORE
// =========================
// rooms[code] = {
//   users: { socketId: username },
//   hostId: socketId | null,
//   movieKey: string | null,      // filename (local) or object key (b2)
//   movieSource: "local" | "b2" | null,
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

async function resolveMovieSrc(room) {
    if (!room.movieKey) return null;

    if (room.movieSource === "b2") {
        return await getPlaybackUrl(room.movieKey);
    }

    return "/videos/" + room.movieKey;
}

async function deleteMovieFile(room) {
    if (room.movieSource !== "b2" || !room.movieKey) return;

    try {
        await b2.send(new DeleteObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: room.movieKey
        }));
        console.log(`[b2] deleted ${room.movieKey}`);
    } catch (e) {
        console.error("[b2] failed to delete file:", e.message);
    }
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
            movieKey: null,
            movieSource: null,
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
    socket.on("joinRoom", async ({ username, roomCode, isHost }) => {
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
            movie: await resolveMovieSrc(room),
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
    socket.on("changeMovie", async ({ roomCode, movie, source }) => {
        const room = rooms[roomCode];
        if (!room) return;
        if (socket.id !== room.hostId) return; // ignore non-host attempts

        room.movieKey = movie;
        room.movieSource = source === "b2" ? "b2" : "local";
        room.currentTime = 0;
        room.playing = false;

        const src = await resolveMovieSrc(room);
        io.to(roomCode).emit("movieChanged", src);
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
    socket.on("disconnect", async () => {
        const roomCode = socket.data.roomCode;
        const username = socket.data.username;
        const room = rooms[roomCode];

        if (!room) return;

        delete room.users[socket.id];

        if (socket.id === room.hostId) {
            // Host left -> close the room for everyone
            io.to(roomCode).emit("roomClosed");
            await deleteMovieFile(room);
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

process.on("uncaughtException", (err) => {
    console.error("[FATAL] uncaught exception:", err);
});

process.on("unhandledRejection", (err) => {
    console.error("[FATAL] unhandled rejection:", err);
});

server.listen(PORT, () => {
    console.log(`Watch Party server running on http://localhost:${PORT}`);
});
