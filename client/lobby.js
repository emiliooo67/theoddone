const urlParams = new URLSearchParams(window.location.search);
let playerName = urlParams.get("name")?.trim();
const roomCode = urlParams.get("room");

const roomCodeEl = document.getElementById("roomCodeText");
const playerListEl = document.getElementById("playerList");
const nameInputArea = document.getElementById("nameInputArea");
const copyBtn = document.getElementById("copyLinkBtn");
const startBtn = document.getElementById("startGameBtn");
const gameSettingsEl = document.getElementById("gameSettings");

let socket;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let isHost = false;
let currentSettings = {
  imposterCount: 1,
  roundTimeLimit: 300,
  imposterHint: true
};

// Redirect if missing parameters
if (!roomCode) {
  alert("Kein Raumcode gefunden. Du wirst zur Startseite weitergeleitet.");
  window.location.href = "index.html";
}

if (!playerName) {
  nameInputArea.style.display = "block";
} else {
  connectToServer();
}

window.addEventListener("beforeunload", () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
});

function enterWithName() {
  const input = document.getElementById("nameInput");
  const name = input.value.trim();
  if (name === "") {
    alert("Bitte gib einen Namen ein.");
    input.focus();
    return;
  }
  if (name.length > 20) {
    alert("Name ist zu lang (max. 20 Zeichen).");
    return;
  }
  playerName = name;
  nameInputArea.style.display = "none";
  window.history.replaceState({}, "", `?room=${roomCode}&name=${encodeURIComponent(playerName)}`);
  connectToServer();
}

// Enter key support for name input
document.addEventListener('DOMContentLoaded', function() {
  const nameInput = document.getElementById("nameInput");
  if (nameInput) {
    nameInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        enterWithName();
      }
    });
  }
});

function connectToServer() {
  roomCodeEl.textContent = "Verbinde mit Server...";
  roomCodeEl.classList.add("connecting");
  
  socket = new WebSocket("wss://theodd.one");


  // Button-Funktionalität direkt hier definieren
  const base = `${window.location.origin}${window.location.pathname}`;
  const link = `${base}?room=${roomCode}&name=`;

  copyBtn.onclick = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(() => {
        showToast("Link kopiert! Sende ihn an deine Freunde.", "success");
      }).catch((err) => {
        console.error("Clipboard API fehlgeschlagen:", err);
        fallbackCopyText(link);
      });
    } else {
      fallbackCopyText(link);
    }
  };

  socket.onopen = () => {
    console.log("WebSocket verbunden");
    roomCodeEl.classList.remove("connecting");
    reconnectAttempts = 0;
    
    socket.send(JSON.stringify({
      type: "joinRoom",
      name: playerName,
      roomCode: roomCode
    }));
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("Lobby-Nachricht erhalten:", data);

    if (data.type === "roomInfo") {
      roomCodeEl.textContent = "Raumcode: " + data.roomCode;
      if (data.gameSettings) {
        currentSettings = data.gameSettings;
        updateSettingsUI();
      }
    }

    if (data.type === "playerList") {
      updatePlayerList(data.players);
    }

    if (data.type === "gameSettingsUpdated") {
      currentSettings = data.settings;
      updateSettingsUI();
      showToast("Spieleinstellungen aktualisiert!", "success");
    }

    // Game started messages
    if (data.type === "gameStarted" || data.type === "startGame") {
      console.log("Spiel gestartet - weiterleiten zu game.html");
      showToast("Spiel wird gestartet...", "success");
      setTimeout(() => {
        window.location.href = `game.html?room=${roomCode}&name=${encodeURIComponent(playerName)}`;
      }, 1000);
    }

    if (data.type === "error") {
      console.error("Lobby-Fehler:", data.message);
      showToast("Fehler: " + data.message, "error");
    }

    if (data.type === "connected") {
      console.log("Verbindung hergestellt:", data.message);
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocket Fehler:", error);
    roomCodeEl.textContent = "Verbindungsfehler - versuche erneut...";
    roomCodeEl.classList.remove("connecting");
  };

  socket.onclose = (event) => {
    console.log("WebSocket Verbindung geschlossen:", event.code, event.reason);
    roomCodeEl.classList.remove("connecting");
    
    if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      roomCodeEl.textContent = `Verbindung verloren - Reconnect ${reconnectAttempts}/${maxReconnectAttempts}...`;
      
      setTimeout(() => {
        connectToServer();
      }, 2000 * reconnectAttempts);
    } else if (reconnectAttempts >= maxReconnectAttempts) {
      roomCodeEl.textContent = "Verbindung dauerhaft verloren";
      showToast("Verbindung verloren. Bitte lade die Seite neu.", "error");
    }
  };
}

function updatePlayerList(players) {
  playerListEl.innerHTML = "";
  
  // Check if current player is host
  isHost = players[0] === playerName;
  
  players.forEach((name, index) => {
    const li = document.createElement("li");
    li.textContent = name;
    
    if (index === 0) {
      li.classList.add("host");
    }
    
    if (name === playerName) {
      li.classList.add("current-player");
    }
    
    playerListEl.appendChild(li);
  });

  // Show/hide game settings and start button based on host status
  if (isHost) {
    gameSettingsEl.style.display = "block";
    startBtn.style.display = "inline-block";
    startBtn.disabled = players.length < 3;
    
    if (players.length < 3) {
      startBtn.textContent = `Spiel starten (${players.length}/3)`;
      startBtn.classList.add("disabled");
    } else {
      startBtn.textContent = "Spiel starten";
      startBtn.classList.remove("disabled");
    }
    
    // Update imposter count options based on player count
    updateImposterOptions(players.length);
  } else {
    gameSettingsEl.style.display = "none";
    startBtn.style.display = "none";
  }
  
  // Update player count info
  const playerCountEl = document.querySelector(".player-count");
  if (playerCountEl) {
    if (players.length < 3) {
      playerCountEl.textContent = `Noch ${3 - players.length} Spieler benötigt`;
      playerCountEl.style.color = "#dc3545";
    } else {
      playerCountEl.textContent = `Bereit zum Starten! (${players.length} Spieler)`;
      playerCountEl.style.color = "#28a745";
    }
  }
}

function updateImposterOptions(playerCount) {
  const imposterSelect = document.getElementById("imposterCount");
  const maxImposters = Math.floor(playerCount / 2);
  
  // Clear existing options
  imposterSelect.innerHTML = "";
  
  // Add options based on player count
  for (let i = 1; i <= Math.max(1, maxImposters); i++) {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = `${i} Imposter${i > 1 ? '' : ''}`;
    if (i === currentSettings.imposterCount) {
      option.selected = true;
    }
    imposterSelect.appendChild(option);
  }
}

function updateSettingsUI() {
  document.getElementById("imposterCount").value = currentSettings.imposterCount;
  document.getElementById("roundTimeLimit").value = currentSettings.roundTimeLimit;
  document.getElementById("imposterHint").checked = currentSettings.imposterHint;
}

function updateSettings() {
  if (!isHost) {
    showToast("Nur der Host kann Einstellungen ändern!", "error");
    return;
  }

  const newSettings = {
    imposterCount: parseInt(document.getElementById("imposterCount").value),
    roundTimeLimit: parseInt(document.getElementById("roundTimeLimit").value),
    imposterHint: document.getElementById("imposterHint").checked
  };

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "updateGameSettings",
      roomCode: roomCode,
      settings: newSettings
    }));
  } else {
    showToast("Keine Verbindung zum Server!", "error");
  }
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  const colors = {
    success: "#28a745",
    error: "#dc3545",
    info: "#17a2b8",
    warning: "#ffc107"
  };
  
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${colors[type] || colors.info};
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    z-index: 1000;
    animation: slideIn 0.3s ease;
    max-width: 300px;
    word-wrap: break-word;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-weight: 500;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease";
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }, type === "error" ? 5000 : 3000);
}

function fallbackCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      showToast("Link kopiert! Sende ihn an deine Freunde.", "success");
    } else {
      showToast("Kopieren fehlgeschlagen.", "error");
    }
  } catch (err) {
    console.error("Fallback copy fehlgeschlagen:", err);
    showToast("Kopieren nicht möglich.", "error");
  }
  
  document.body.removeChild(textArea);
}

// Start Button Event Handler
startBtn.onclick = () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    const players = Array.from(playerListEl.children).map(li => li.textContent.replace(" 👑", ""));
    
    if (players.length < 3) {
      showToast("Mindestens 3 Spieler erforderlich!", "error");
      return;
    }
    
    startBtn.disabled = true;
    startBtn.textContent = "🎮 Starte Spiel...";
    
    socket.send(JSON.stringify({
      type: "startGame",
      roomCode
    }));
    
    // Re-enable button after 5 seconds in case of error
    setTimeout(() => {
      if (startBtn.disabled) {
        startBtn.disabled = false;
        startBtn.textContent = "Spiel starten";
      }
    }, 5000);
    
  } else {
    showToast("Keine Verbindung zum Server", "error");
  }
};

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
  // Hier war der Code abgeschnitten - das ist der fehlende Teil:

      opacity: 0;
    }
  }
  
  .connecting {
    animation: pulse 1.5s infinite;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  
  .host {
    background: #d4edda !important;
    border-color: #c3e6cb !important;
    font-weight: bold;
  }
  
  .host::after {
    content: " 👑";
  }
  
  .current-player {
    border: 2px solid #007bff !important;
    background: #e3f2fd !important;
  }
  
  .disabled {
    opacity: 0.6;
    cursor: not-allowed !important;
  }
  
  .toast {
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-weight: 500;
  }
`;
document.head.appendChild(style);