const socket = io();

// =========================
// ELEMENTS
// =========================

const usernameInput = document.getElementById("username");
const roomCodeInput = document.getElementById("roomCode");

const createBtn = document.getElementById("createRoom");
const joinBtn = document.getElementById("joinRoom");

const errorDiv = document.getElementById("error");

// =========================
// HELPERS
// =========================

function showError(text) {
    errorDiv.textContent = text;
}

function clearError() {
    errorDiv.textContent = "";
}

function goToRoom(roomCode, username, isHost) {
    localStorage.setItem("username", username);
    localStorage.setItem("roomCode", roomCode);
    localStorage.setItem("isHost", isHost ? "true" : "false");
    window.location = "room.html";
}

// =========================
// CREATE ROOM
// =========================

createBtn.onclick = () => {
    clearError();

    const username = usernameInput.value.trim();

    if (!username) {
        showError("Please enter your name");
        return;
    }

    socket.emit("createRoom", { username });
};

socket.on("roomCreated", ({ roomCode }) => {
    const username = usernameInput.value.trim();
    goToRoom(roomCode, username, true);
});

socket.on("createError", (msg) => {
    showError(msg);
});

// =========================
// JOIN ROOM
// =========================

joinBtn.onclick = () => {
    clearError();

    const username = usernameInput.value.trim();
    const roomCode = roomCodeInput.value.trim().toUpperCase();

    if (!username) {
        showError("Please enter your name");
        return;
    }

    if (!roomCode) {
        showError("Please enter a room code");
        return;
    }

    socket.emit("checkRoom", { roomCode }, (exists) => {
        if (!exists) {
            showError("Room not found");
            return;
        }

        goToRoom(roomCode, username, false);
    });
};

// =========================
// ENTER TO SUBMIT
// =========================

[usernameInput, roomCodeInput].forEach(input => {
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            if (roomCodeInput.value.trim()) {
                joinBtn.click();
            } else {
                createBtn.click();
            }
        }
    });
});
