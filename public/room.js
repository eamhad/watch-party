const socket = io();

// =========================
// USER INFO
// =========================
const username = localStorage.getItem("username");
const roomCode = localStorage.getItem("roomCode");
const isHost = localStorage.getItem("isHost") === "true";

if (!username || !roomCode) {
    window.location = "/";
}

// =========================
// ELEMENTS
// =========================
const usernameDisplay = document.getElementById("usernameDisplay");
const roomCodeDisplay = document.getElementById("roomCodeDisplay");
const video = document.getElementById("video");
const videoList = document.getElementById("videoList");
const uploadBox = document.getElementById("uploadBox");
const uploadInput = document.getElementById("uploadInput");
const uploadBtn = document.getElementById("uploadBtn");
const uploadStatus = document.getElementById("uploadStatus");
const usersList = document.getElementById("usersList");
const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const leaveBtn = document.getElementById("leaveRoom");

// =========================
// DISPLAY USER INFO
// =========================
usernameDisplay.textContent = username;
roomCodeDisplay.textContent = roomCode;
document.title = `Room ${roomCode}`;

if (!isHost) {
    video.removeAttribute("controls");
}

// =========================
// UPLOAD VIDEO (host only)
// =========================
if (isHost) {
    uploadBox.style.display = "flex";

    uploadBtn.onclick = async () => {
        const file = uploadInput.files[0];
        if (!file) {
            uploadStatus.textContent = "Choose a file first";
            return;
        }

        uploadStatus.textContent = "Preparing upload...";

        try {
            const targetType = file.type || "video/mp4";

            const urlResponse = await fetch("/api/upload-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    filename: file.name,
                    contentType: targetType 
                })
            });

            const urlData = await urlResponse.json();
            if (!urlResponse.ok) {
                uploadStatus.textContent = urlData.error || "Could not start upload";
                return;
            }

             uploadStatus.textContent = "Uploading to storage...";

            const uploadResponse = await fetch(urlData.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: file
});

            if (!uploadResponse.ok) {
                uploadStatus.textContent = "Upload failed";
                return;
            }

            uploadStatus.textContent = "Uploaded! Playing now.";
            uploadInput.value = "";

            socket.emit("changeMovie", {
                roomCode,
                movie: urlData.key,
                source: "b2"
            });
        } catch (e) {
            uploadStatus.textContent = "Upload failed";
        }
    };
}
// =========================
// JOIN ROOM
// =========================
socket.emit("joinRoom", { username, roomCode, isHost });

// =========================
// LOAD MOVIES
// =========================
async function loadMovies() {
    videoList.innerHTML = "";
    const response = await fetch("/api/videos");
    const movies = await response.json();

    movies.forEach(movie => {
        const item = document.createElement("div");
        item.className = "videoItem";
        let html = `<div class="videoTitle">${movie.replace(".mp4","")}</div>`;

        if (isHost) {
            html += `<div class="hostOnly">Click to play</div>`;
        }
        item.innerHTML = html;

        if (isHost) {
            item.onclick = () => {
                socket.emit("changeMovie", { roomCode, movie });
            };
        }
        videoList.appendChild(item);
    });
}
loadMovies();

// =========================
// PLAYBACK SYNC (host drives, others follow)
// =========================
let suppressEvents = false;

if (isHost) {
    video.addEventListener("play", () => {
        if (suppressEvents) return;
        socket.emit("playbackControl", { roomCode, action: "play", currentTime: video.currentTime });
    });

    video.addEventListener("pause", () => {
        if (suppressEvents) return;
        socket.emit("playbackControl", { roomCode, action: "pause", currentTime: video.currentTime });
    });

    video.addEventListener("seeked", () => {
        if (suppressEvents) return;
        socket.emit("playbackControl", { roomCode, action: video.paused ? "pause" : "play", currentTime: video.currentTime });
    });
}

socket.on("playbackControl", ({ action, currentTime }) => {
    suppressEvents = true;
    if (Math.abs(video.currentTime - currentTime) > 0.75) {
        video.currentTime = currentTime;
    }
    if (action === "play") {
        video.play().catch(() => {});
    } else {
        video.pause();
    }
    setTimeout(() => { suppressEvents = false; }, 150);
});

// =========================
// LEAVE ROOM
// =========================
leaveBtn.onclick = () => {
    localStorage.removeItem("roomCode");
    localStorage.removeItem("isHost");
    window.location = "/";
};

// =========================
// ENTER TO SEND
// =========================
messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        sendBtn.click();
    }
});

// =========================
// AUTO SCROLL
// =========================
function scrollChat() {
    messages.scrollTop = messages.scrollHeight;
}

// =========================
// MESSAGE HELPERS
// =========================
function addSystemMessage(text) {
    const div = document.createElement("div");
    div.className = "system";
    div.innerText = text;
    messages.appendChild(div);
    scrollChat();
}

function addChatMessage(data) {
    const div = document.createElement("div");
    div.className = "message";
    div.innerHTML = `
        <span class="sender">${data.username}</span>
        <span class="time">${data.time}</span>
        <br>
        ${data.message}
    `;
    messages.appendChild(div);
    scrollChat();
}

// =========================
// SEND CHAT
// =========================
sendBtn.onclick = () => {
    const text = messageInput.value.trim();
    if (text === "") return;
    socket.emit("chat", { roomCode, username, message: text });
    messageInput.value = "";
};

// =========================
// RECEIVE CHAT
// =========================
socket.on("chat", data => {
    addChatMessage(data);
});

// =========================
// SYSTEM MESSAGES
// =========================
socket.on("systemMessage", text => {
    addSystemMessage(text);
});

// =========================
// USERS LIST
// =========================
socket.on("users", users => {
    usersList.innerHTML = "";
    users.forEach(name => {
        const div = document.createElement("div");
        div.className = "user";
        let badge = "";
        if (name === username && isHost) {
            badge = `<span class="hostBadge">Host</span>`;
        }
        div.innerHTML = `<span>${name}</span>${badge}`;
        usersList.appendChild(div);
    });
});

// =========================
// MOVIE CHANGED
// =========================
socket.on("movieChanged", movie => {
    video.src = movie;
    video.load();
    addSystemMessage("Movie changed");
});

// =========================
// ROOM CLOSED
// =========================
socket.on("roomClosed", () => {
    alert("The host closed the room.");
    localStorage.removeItem("roomCode");
    localStorage.removeItem("isHost");
    window.location = "/";
});

// =========================
// INITIAL SYNC
// =========================
socket.on("syncState", state => {
    if (state.movie) {
        video.src = state.movie;
        video.load();
    }
    video.currentTime = state.currentTime || 0;
    if (state.playing) {
        video.play().catch(() => {});
    }
});
