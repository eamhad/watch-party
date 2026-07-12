const socket = io();[cite: 2]

// =========================
// USER INFO
// =========================

const username = localStorage.getItem("username");[cite: 2]
const roomCode = localStorage.getItem("roomCode");[cite: 2]
const isHost = localStorage.getItem("isHost") === "true";[cite: 2]

if (!username || !roomCode) {[cite: 2]
    window.location = "/";[cite: 2]
}

// =========================
// ELEMENTS
// =========================

const usernameDisplay = document.getElementById("usernameDisplay");[cite: 2]
const roomCodeDisplay = document.getElementById("roomCodeDisplay");[cite: 2]

const video = document.getElementById("video");[cite: 2]
const videoList = document.getElementById("videoList");[cite: 2]

const uploadBox = document.getElementById("uploadBox");[cite: 2]
const uploadInput = document.getElementById("uploadInput");[cite: 2]
const uploadBtn = document.getElementById("uploadBtn");[cite: 2]
const uploadStatus = document.getElementById("uploadStatus");[cite: 2]

const usersList = document.getElementById("usersList");[cite: 2]

const messages = document.getElementById("messages");[cite: 2]

const messageInput = document.getElementById("messageInput");[cite: 2]

const sendBtn = document.getElementById("sendBtn");[cite: 2]

const leaveBtn = document.getElementById("leaveRoom");[cite: 2]

// =========================
// DISPLAY USER INFO
// =========================

usernameDisplay.textContent = username;[cite: 2]
roomCodeDisplay.textContent = roomCode;[cite: 2]

document.title = `Room ${roomCode}`;[cite: 2]

if (!isHost) {[cite: 2]

    video.removeAttribute("controls");[cite: 2]

}

// =========================
// UPLOAD VIDEO (host only)
// =========================

if (isHost) {[cite: 2]

    uploadBox.style.display = "flex";[cite: 2]

    uploadBtn.onclick = async () => {[cite: 2]

        const file = uploadInput.files[0];[cite: 2]

        if (!file) {[cite: 2]

            uploadStatus.textContent = "Choose a file first";[cite: 2]

            return;[cite: 2]

        }

        uploadStatus.textContent = "Preparing upload...";[cite: 2]

        try {
            // Dynamically detect file type (fallback to video/mp4 if empty)
            const targetType = file.type || "video/mp4";[cite: 2]

            const urlResponse = await fetch("/api/upload-url", {[cite: 2]

                method: "POST",[cite: 2]

                headers: { "Content-Type": "application/json" },[cite: 2]

                body: JSON.stringify({ 
                    filename: file.name,[cite: 2]
                    contentType: targetType 
                })

            });[cite: 2]

            const urlData = await urlResponse.json();[cite: 2]

            if (!urlResponse.ok) {[cite: 2]

                uploadStatus.textContent = urlData.error || "Could not start upload";[cite: 2]

                return;[cite: 2]

            }

            uploadStatus.textContent = "Uploading to storage...";[cite: 2]

            const uploadResponse = await fetch(urlData.uploadUrl, {[cite: 2]

                method: "PUT",[cite: 2]

                headers: { "Content-Type": targetType }, // Matches signature perfectly

                body: file[cite: 2]

            });[cite: 2]

            if (!uploadResponse.ok) {[cite: 2]

                uploadStatus.textContent = "Upload failed";[cite: 2]

                return;[cite: 2]

            }

            uploadStatus.textContent = "Uploaded! Playing now.";[cite: 2]

            uploadInput.value = "";[cite: 2]

            socket.emit("changeMovie", {[cite: 2]

                roomCode,[cite: 2]

                movie: urlData.key,[cite: 2]

                source: "b2"[cite: 2]

            });[cite: 2]

        } catch (e) {[cite: 2]

            uploadStatus.textContent = "Upload failed";[cite: 2]

        }

    };

}

// =========================
// JOIN ROOM
// =========================

socket.emit("joinRoom", {[cite: 2]
    username,[cite: 2]
    roomCode,[cite: 2]
    isHost[cite: 2]
});[cite: 2]

// =========================
// LOAD MOVIES
// =========================

async function loadMovies() {[cite: 2]

    videoList.innerHTML = "";[cite: 2]

    const response = await fetch("/api/videos");[cite: 2]

    const movies = await response.json();[cite: 2]

    movies.forEach(movie => {[cite: 2]

        const item = document.createElement("div");[cite: 2]

        item.className = "videoItem";[cite: 2]

        let html = "";[cite: 2]

        html += `<div class="videoTitle">${movie.replace(".mp4","")}</div>`;[cite: 2]

        if(isHost){[cite: 2]

            html += `<div class="hostOnly">Click to play</div>`;[cite: 2]

        }

        item.innerHTML = html;[cite: 2]

        if(isHost){[cite: 2]

            item.onclick = ()=>{[cite: 2]

                socket.emit("changeMovie",{[cite: 2]

                    roomCode,[cite: 2]

                    movie[cite: 2]

                });[cite: 2]

            }[cite: 2]

        }

        videoList.appendChild(item);[cite: 2]

    });[cite: 2]

}

loadMovies();[cite: 2]

// =========================
// PLAYBACK SYNC (host drives, others follow)
// =========================

let suppressEvents = false;[cite: 2]

if (isHost) {[cite: 2]

    video.addEventListener("play", () => {[cite: 2]

        if (suppressEvents) return;[cite: 2]

        socket.emit("playbackControl", {[cite: 2]
            roomCode,[cite: 2]
            action: "play",[cite: 2]
            currentTime: video.currentTime[cite: 2]
        });[cite: 2]

    });[cite: 2]

    video.addEventListener("pause", () => {[cite: 2]

        if (suppressEvents) return;[cite: 2]

        socket.emit("playbackControl", {[cite: 2]
            roomCode,[cite: 2]
            action: "pause",[cite: 2]
            currentTime: video.currentTime[cite: 2]
        });[cite: 2]

    });[cite: 2]

    video.addEventListener("seeked", () => {[cite: 2]

        if (suppressEvents) return;[cite: 2]

        socket.emit("playbackControl", {[cite: 2]
            roomCode,[cite: 2]
            action: video.paused ? "pause" : "play",[cite: 2]
            currentTime: video.currentTime[cite: 2]
        });[cite: 2]

    });[cite: 2]

}

socket.on("playbackControl", ({ action, currentTime }) => {[cite: 2]

    suppressEvents = true;[cite: 2]

    if (Math.abs(video.currentTime - currentTime) > 0.75) {[cite: 2]

        video.currentTime = currentTime;[cite: 2]

    }[cite: 2]

    if (action === "play") {[cite: 2]

        video.play().catch(() => {});[cite: 2]

    } else {[cite: 2]

        video.pause();[cite: 2]

    }[cite: 2]

    setTimeout(() => { suppressEvents = false; }, 150);[cite: 2]

});[cite: 2]

// =========================
// LEAVE ROOM
// =========================

leaveBtn.onclick = ()=>{[cite: 2]

    localStorage.removeItem("roomCode");[cite: 2]

    localStorage.removeItem("isHost");[cite: 2]

    window.location="/";[cite: 2]

};

// =========================
// ENTER TO SEND
// =========================

messageInput.addEventListener("keydown",(e)=>{[cite: 2]

    if(e.key==="Enter"){[cite: 2]

        sendBtn.click();[cite: 2]

    }[cite: 2]

});

// =========================
// AUTO SCROLL
// =========================

function scrollChat(){[cite: 2]

    messages.scrollTop=messages.scrollHeight;[cite: 2]

}

// =========================
// MESSAGE HELPERS
// =========================

function addSystemMessage(text){[cite: 2]

    const div=document.createElement("div");[cite: 2]

    div.className="system";[cite: 2]

    div.innerText=text;[cite: 2]

    messages.appendChild(div);[cite: 2]

    scrollChat();[cite: 2]

}

function addChatMessage(data){[cite: 2]

    const div=document.createElement("div");[cite: 2]

    div.className="message";[cite: 2]

    div.innerHTML=`[cite: 2]

        <span class="sender">${data.username}</span>[cite: 2]

        <span class="time">${data.time}</span>[cite: 2]

        <br>[cite: 2]

        ${data.message}[cite: 2]

    `;[cite: 2]

    messages.appendChild(div);[cite: 2]

    scrollChat();[cite: 2]

}
// =========================
// SEND CHAT
// =========================

sendBtn.onclick = () => {[cite: 2]

    const text = messageInput.value.trim();[cite: 2]

    if (text === "") return;[cite: 2]

    socket.emit("chat", {[cite: 2]

        roomCode,[cite: 2]
        username,[cite: 2]
        message: text[cite: 2]

    });[cite: 2]

    messageInput.value = "";[cite: 2]

};

// =========================
// RECEIVE CHAT
// =========================

socket.on("chat", data => {[cite: 2]

    addChatMessage(data);[cite: 2]

});

// =========================
// SYSTEM MESSAGES
// =========================

socket.on("systemMessage", text => {[cite: 2]

    addSystemMessage(text);[cite: 2]

});

// =========================
// USERS LIST
// =========================

socket.on("users", users => {[cite: 2]

    usersList.innerHTML = "";[cite: 2]

    users.forEach(name => {[cite: 2]

        const div = document.createElement("div");[cite: 2]

        div.className = "user";[cite: 2]

        let badge = "";[cite: 2]

        if (name === username && isHost) {[cite: 2]

            badge = `<span class="hostBadge">Host</span>`;[cite: 2]

        }[cite: 2]

        div.innerHTML = `[cite: 2]

            <span>${name}</span>[cite: 2]

            ${badge}[cite: 2]

        `;[cite: 2]

        usersList.appendChild(div);[cite: 2]

    });[cite: 2]

});

// =========================
// MOVIE CHANGED
// =========================

socket.on("movieChanged", movie => {[cite: 2]

    video.src = movie;[cite: 2]

    video.load();[cite: 2]

    addSystemMessage("Movie changed");[cite: 2]

});

// =========================
// ROOM CLOSED
// =========================

socket.on("roomClosed", () => {[cite: 2]

    alert("The host closed the room.");[cite: 2]

    localStorage.removeItem("roomCode");[cite: 2]
    localStorage.removeItem("isHost");[cite: 2]

    window.location="/";[cite: 2]

});

// =========================
// INITIAL SYNC
// =========================

socket.on("syncState", state => {[cite: 2]

    if(state.movie){[cite: 2]

        video.src=state.movie;[cite: 2]

        video.load();[cite: 2]

    }[cite: 2]

    video.currentTime=state.currentTime||0;[cite: 2]

    if(state.playing){[cite: 2]

        video.play().catch(()=>{});[cite: 2]

    }[cite: 2]

});
