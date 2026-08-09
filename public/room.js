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

const videoWrapper = document.getElementById("videoWrapper");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const chatPanel = document.getElementById("chatPanel");
const sidePanel = document.querySelector(".side");

const uploadBox = document.getElementById("uploadBox");
const uploadInput = document.getElementById("uploadInput");
const uploadBtn = document.getElementById("uploadBtn");
const uploadStatus = document.getElementById("uploadStatus");

const urlBox = document.getElementById("urlBox");
const urlInput = document.getElementById("urlInput");
const urlPlayBtn = document.getElementById("urlPlayBtn");

const usersList = document.getElementById("usersList");

const messages = document.getElementById("messages");

const messageInput = document.getElementById("messageInput");

const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");

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
// FULLSCREEN (available to host and viewers)
// =========================

fullscreenBtn.onclick = () => {

    if (!document.fullscreenElement) {

        videoWrapper.requestFullscreen().catch(() => {});

    } else {

        document.exitFullscreen();

    }

};

document.addEventListener("fullscreenchange", () => {

    if (document.fullscreenElement === videoWrapper) {

        videoWrapper.classList.add("fsLayout");

        videoWrapper.appendChild(chatPanel);

        chatPanel.classList.add("chatSidebarFS");

        if (screen.orientation && screen.orientation.lock) {

            screen.orientation.lock("landscape").catch(() => {});

        }

    } else {

        videoWrapper.classList.remove("fsLayout");

        sidePanel.appendChild(chatPanel);

        chatPanel.classList.remove("chatSidebarFS");

        if (screen.orientation && screen.orientation.unlock) {

            screen.orientation.unlock();

        }

    }

});

// =========================
// UPLOAD VIDEO (host only)
// =========================

if (isHost) {

    uploadBox.style.display = "flex";
    urlBox.style.display = "flex";

    urlPlayBtn.onclick = () => {

        const url = urlInput.value.trim();

        if (!url) return;

        socket.emit("changeMovie", {

            roomCode,

            movie: url,

            source: "url"

        });

    };

    uploadBtn.onclick = async () => {

        const file = uploadInput.files[0];

        if (!file) {

            uploadStatus.textContent = "Choose a file first";

            return;

        }

        uploadStatus.textContent = "Preparing upload...";

        try {

            const urlResponse = await fetch("/api/upload-url", {

                method: "POST",

                headers: { "Content-Type": "application/json" },

                body: JSON.stringify({ filename: file.name })

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

socket.emit("joinRoom", {
    username,
    roomCode,
    isHost
});

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

        let html = "";

        html += `<div class="videoTitle">${movie.replace(".mp4","")}</div>`;

        if(isHost){

            html += `<div class="hostOnly">Click to play</div>`;

        }

        item.innerHTML = html;

        if(isHost){

            item.onclick = ()=>{

                socket.emit("changeMovie",{

                    roomCode,

                    movie

                });

            }

        }

        videoList.appendChild(item);

    });

    const b2Response = await fetch("/api/b2-videos");

    const b2Movies = await b2Response.json();

    if (Array.isArray(b2Movies)) {

        b2Movies.forEach(key => {

        const item = document.createElement("div");

        item.className = "videoItem";

        const displayName = key.replace(/^\d+-/, "").replace(".mp4", "");

        let html = "";

        html += `<div class="videoTitle">${displayName}</div>`;

        if(isHost){

            html += `<div class="hostOnly">Click to play</div>`;

        }

        item.innerHTML = html;

        if(isHost){

            item.onclick = ()=>{

                socket.emit("changeMovie",{

                    roomCode,

                    movie: key,

                    source: "b2"

                });

            }

        }

        videoList.appendChild(item);

    });

    }

}

loadMovies();

// =========================
// PLAYBACK SYNC (host drives, others follow)
// =========================

let suppressEvents = false; // avoids re-broadcasting changes we just applied ourselves

if (isHost) {

    video.addEventListener("play", () => {

        if (suppressEvents) return;

        socket.emit("playbackControl", {
            roomCode,
            action: "play",
            currentTime: video.currentTime
        });

    });

    video.addEventListener("pause", () => {

        if (suppressEvents) return;

        socket.emit("playbackControl", {
            roomCode,
            action: "pause",
            currentTime: video.currentTime
        });

    });

    video.addEventListener("seeked", () => {

        if (suppressEvents) return;

        socket.emit("playbackControl", {
            roomCode,
            action: video.paused ? "pause" : "play",
            currentTime: video.currentTime
        });

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
// VOICE NOTES
// =========================

const MAX_RECORDING_MS = 60 * 1000; // 1 minute cap

let mediaRecorder = null;
let recordedChunks = [];
let recordingTimeout = null;

function blobToBase64(blob) {

    return new Promise((resolve, reject) => {

        const reader = new FileReader();

        reader.onloadend = () => resolve(reader.result);

        reader.onerror = reject;

        reader.readAsDataURL(blob);

    });

}

async function startRecording() {

    try {

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        mediaRecorder = new MediaRecorder(stream);

        recordedChunks = [];

        mediaRecorder.ondataavailable = (e) => {

            if (e.data.size > 0) recordedChunks.push(e.data);

        };

        mediaRecorder.onstop = async () => {

            stream.getTracks().forEach(track => track.stop());

            clearTimeout(recordingTimeout);

            micBtn.classList.remove("recording");

            if (recordedChunks.length === 0) return;

            const blob = new Blob(recordedChunks, { type: "audio/webm" });

            const base64Audio = await blobToBase64(blob);

            socket.emit("voiceNote", {

                roomCode,

                username,

                audio: base64Audio

            });

        };

        mediaRecorder.start();

        micBtn.classList.add("recording");

        recordingTimeout = setTimeout(() => {

            if (mediaRecorder && mediaRecorder.state === "recording") {

                mediaRecorder.stop();

            }

        }, MAX_RECORDING_MS);

    } catch (e) {

        alert("Could not access microphone");

    }

}

function stopRecording() {

    if (mediaRecorder && mediaRecorder.state === "recording") {

        mediaRecorder.stop();

    }

}

micBtn.onclick = () => {

    if (mediaRecorder && mediaRecorder.state === "recording") {

        stopRecording();

    } else {

        startRecording();

    }

};

function addVoiceMessage(data) {

    const div = document.createElement("div");

    div.className = "voiceNote message";

    div.innerHTML = `

        <span class="sender">${data.username}</span>

        <span class="time">${data.time}</span>

        <audio controls src="${data.audio}"></audio>

    `;

    messages.appendChild(div);

    scrollChat();

}

socket.on("voiceNote", data => {

    addVoiceMessage(data);

});

// =========================
// LEAVE ROOM
// =========================

leaveBtn.onclick = ()=>{

    localStorage.removeItem("roomCode");

    localStorage.removeItem("isHost");

    window.location="/";

};

// =========================
// ENTER TO SEND
// =========================

messageInput.addEventListener("keydown",(e)=>{

    if(e.key==="Enter"){

        sendBtn.click();

    }

});

// =========================
// AUTO SCROLL
// =========================

function scrollChat(){

    messages.scrollTop=messages.scrollHeight;

}

// =========================
// MESSAGE HELPERS
// =========================

function addSystemMessage(text){

    const div=document.createElement("div");

    div.className="system";

    div.innerText=text;

    messages.appendChild(div);

    scrollChat();

}

function addChatMessage(data){

    const div=document.createElement("div");

    div.className="message";

    div.innerHTML=`

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

    socket.emit("chat", {

        roomCode,
        username,
        message: text

    });

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

        div.innerHTML = `

            <span>${name}</span>

            ${badge}

        `;

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

    window.location="/";

});

// =========================
// INITIAL SYNC
// =========================

socket.on("syncState", state => {

    if(state.movie){

        video.src=state.movie;

        video.load();

    }

    video.currentTime=state.currentTime||0;

    if(state.playing){

        video.play().catch(()=>{});

    }

});