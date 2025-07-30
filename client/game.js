const urlParams = new URLSearchParams(window.location.search);
const playerName = urlParams.get("name")?.trim();
const roomCode = urlParams.get("room");

// DOM Elements - ANGEPASST FÜR VOICE-ONLY
const roomCodeEl = document.getElementById("roomCode");
const playerNameEl = document.getElementById("playerName");
const gamePhaseEl = document.getElementById("gamePhase");
const currentPlayerEl = document.getElementById("currentPlayer");
const roundCounterEl = document.getElementById("roundCounter");
const wordDisplayEl = document.getElementById("wordDisplay");
const roleTitleEl = document.getElementById("roleTitle");
const wordTextEl = document.getElementById("wordText");
const roleDescriptionEl = document.getElementById("roleDescription");
const playersListEl = document.getElementById("playersList");
const voiceGameAreaEl = document.getElementById("voiceGameArea");
const voiceWaitingAreaEl = document.getElementById("voiceWaitingArea");
const currentSpeakerEl = document.getElementById("currentSpeaker");
const votingAreaEl = document.getElementById("votingArea");
const votingButtonsEl = document.getElementById("votingButtons");
const confirmVoteBtnEl = document.getElementById("confirmVoteBtn");
const imposterGuessAreaEl = document.getElementById("imposterGuessArea");
const imposterGuessEl = document.getElementById("imposterGuess");
const gameEndAreaEl = document.getElementById("gameEndArea");
const gameResultEl = document.getElementById("gameResult");
const gameEndDetailsEl = document.getElementById("gameEndDetails");
const waitingAreaEl = document.getElementById("waitingArea");
const waitingTextEl = document.getElementById("waitingText");

let socket;
let gameState = {};
let myRole = null;
let selectedVote = null;
let currentRound = 1;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let isImposter = false;
let gameSettings = {};

// Initialisierung
if (!playerName || !roomCode) {
  alert("Fehler: Spielername oder Raumcode fehlt!");
  window.location.href = "index.html";
} else {
  roomCodeEl.textContent = `Raum: ${roomCode}`;
  playerNameEl.textContent = `Du: ${playerName}`;
  connectToServer();
}

// VOICE-ONLY: Nächster Spieler Funktion
function nextPlayer() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showError("Keine Verbindung zum Server!");
    return;
  }

  console.log("Voice-Only: Sende nextPlayer Signal");

  // Sende "nextPlayer" Signal an Server (OHNE Wort)
  socket.send(JSON.stringify({
    type: "nextPlayer",
    roomCode: roomCode,
    playerName: playerName
  }));

  hideAllInputs();
  showWaiting("Warte auf nächsten Spieler...");
}

function connectToServer() {
  showWaiting("Verbinde mit dem Spiel...");
  
  socket = new WebSocket("wss://theodd.one/ws");

  socket.onopen = () => {
    console.log("Mit Game-Server verbunden");
    reconnectAttempts = 0;
    
    socket.send(JSON.stringify({
      type: "joinRoom",
      roomCode: roomCode,
      name: playerName
    }));
    
    setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "joinGame",
          roomCode: roomCode,
          playerName: playerName
        }));
      }
    }, 500);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("Nachricht erhalten:", data.type, data);
      
      switch(data.type) {
        case "gameStarted":
          handleGameStarted(data);
          break;
          
        case "roleAssignment":
          handleRoleAssignment(data);
          break;
          
        case "gameState":
          handleGameStateUpdate(data);
          break;
          
        case "nextPlayerTurn": // NEUER MESSAGE TYPE
          handleNextPlayerTurn(data);
          break;
          
        case "votingPhase":
          handleVotingPhase(data);
          break;
          
        case "playerEliminated":
          handlePlayerEliminated(data);
          break;
          
        case "gameEnded":
          handleGameEnded(data);
          break;
          
        case "noActiveGame":
          console.log("Kein aktives Spiel - zurück zur Lobby");
          showGameMessage("Kein aktives Spiel gefunden. Du wirst zur Lobby weitergeleitet.");
          setTimeout(() => {
            window.location.href = `lobby.html?room=${roomCode}&name=${encodeURIComponent(playerName)}`;
          }, 2000);
          break;
          
        case "error":
          console.error("Server-Fehler:", data.message);
          showError("Fehler: " + data.message);
          break;
          
        case "connected":
          console.log("Verbindung bestätigt:", data.message);
          break;
          
        case "pong":
          console.log("Pong erhalten");
          break;
          
        default:
          console.log("Unbekannte Nachricht:", data);
      }
    } catch (error) {
      console.error("Fehler beim Parsen der Nachricht:", error);
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocket Fehler:", error);
    showWaiting("Verbindungsfehler - versuche erneut...");
  };

  socket.onclose = (event) => {
    console.log("WebSocket geschlossen:", event.code, event.reason);
    
    if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      showWaiting(`Verbindung verloren - Reconnect ${reconnectAttempts}/${maxReconnectAttempts}...`);
      
      setTimeout(() => {
        console.log(`Reconnect Versuch ${reconnectAttempts}`);
        connectToServer();
      }, 2000 * reconnectAttempts);
    } else if (reconnectAttempts >= maxReconnectAttempts) {
      showWaiting("Verbindung dauerhaft verloren. Bitte lade die Seite neu.");
    }
  };
}

function handleGameStarted(data) {
  console.log("Spiel gestartet! Game-State:", data.gameState);
  gameState = data.gameState;
  gameSettings = data.gameState.settings || {};
  hideWaiting();
  updateGameDisplay();
}

function handleRoleAssignment(data) {
  console.log("Rolle zugewiesen:", data.role, data.word ? `Wort: ${data.word}` : "Kein Wort (Imposter)");
  myRole = data.role;
  isImposter = data.role === "imposter";
  const word = data.word;
  
  wordDisplayEl.style.display = "block";
  
  if (isImposter) {
    roleTitleEl.textContent = "Du bist der IMPOSTER!";
    wordTextEl.textContent = "???";
    
    let description = "Du kennst das geheime Wort nicht! Höre gut zu und versuche herauszufinden, was das Wort ist. Verhalte dich unauffällig!";
    
    if (data.hint && gameSettings.imposterHint) {
      description += `\n\nHinweis: ${data.hint}`;
    }
    
    roleDescriptionEl.textContent = description;
    document.querySelector(".role-card").classList.add("imposter");
    
    setupPermanentImposterGuess();
  } else {
    roleTitleEl.textContent = "Du bist ein CREWMATE!";
    wordTextEl.textContent = word;
    roleDescriptionEl.textContent = "Das ist dein geheimes Wort. Sage passende Begriffe dazu über Voice-Chat, aber verrate nicht zu viel! Finde den Imposter!";
    document.querySelector(".role-card").classList.remove("imposter");
  }
}

function handleGameStateUpdate(data) {
  console.log(`Game State Update erhalten:`, data.gameState);
  
  const oldCurrentPlayer = gameState.currentPlayer;
  gameState = data.gameState;
  
  updateGameDisplay();
  
  if (gameState.currentPlayer === playerName) {
    hideWaiting();
    showVoiceGameArea();
    console.log(`Du bist jetzt dran!`);
  } else {
    if (gameState.phase === "playing") {
      showVoiceWaitingArea(gameState.currentPlayer);
    }
  }
}

// NEUER HANDLER: Für nextPlayer Response
function handleNextPlayerTurn(data) {
  console.log(`Nächster Spieler ist dran: ${data.currentPlayer}`);
  gameState.currentPlayer = data.currentPlayer;
  gameState.currentPlayerIndex = data.currentPlayerIndex;
  
  updateGameDisplay();
  
  if (data.currentPlayer === playerName) {
    hideWaiting();
    showVoiceGameArea();
  } else {
    showVoiceWaitingArea(data.currentPlayer);
  }
}

function handleVotingPhase(data) {
  gamePhaseEl.textContent = "Abstimmungsphase";
  currentPlayerEl.textContent = data.forced ? "Zeit abgelaufen - ZWANGSABSTIMMUNG!" : "Abstimmen oder überspringen";
  
  hideAllInputs();
  
  if (isImposter) {
    showImposterVotingOptions();
  } else {
    showVoting();
  }
}

function handlePlayerEliminated(data) {
  showSuccess(`${data.eliminated} wurde eliminiert! Spiel geht weiter...`);
  gameState = data.gameState;
  updateGameDisplay();
}

function handleGameEnded(data) {
  hideAllInputs();
  
  const floating = document.getElementById("floatingImposterGuess");
  if (floating) {
    floating.remove();
  }
  
  gameEndAreaEl.style.display = "block";
  
  if (data.winner === "imposter") {
    gameResultEl.textContent = "Die Imposter haben gewonnen!";
    gameResultEl.style.color = "#C42000";
    gameEndDetailsEl.innerHTML = `
      <p><strong>Imposter:</strong> ${Array.isArray(data.imposters) ? data.imposters.join(", ") : data.imposters}</p>
      <p><strong>Geheimes Wort:</strong> ${data.secretWord}</p>
      <p class="game-end-reason">${data.reason}</p>
    `;
  } else {
    gameResultEl.textContent = "Die Crewmates haben gewonnen!";
    gameResultEl.style.color = "#000000";
    gameEndDetailsEl.innerHTML = `
      <p><strong>Imposter:</strong> ${Array.isArray(data.imposters) ? data.imposters.join(", ") : data.imposters}</p>
      <p><strong>Geheimes Wort:</strong> ${data.secretWord}</p>
      <p class="game-end-reason">${data.reason}</p>
    `;
  }
}

function updateGameDisplay() {
  if (!gameState.players) return;
  
  if (gameState.phase === "playing") {
    gamePhaseEl.textContent = "Spielphase";
    currentPlayerEl.textContent = `${gameState.currentPlayer} ist dran`;
    
    if (gameState.timeRemaining !== null && gameState.timeRemaining !== undefined) {
      const minutes = Math.floor(gameState.timeRemaining / 60);
      const seconds = gameState.timeRemaining % 60;
      currentPlayerEl.textContent += ` (${minutes}:${seconds.toString().padStart(2, '0')} verbleibend)`;
    }
  } else if (gameState.phase === "voting") {
    gamePhaseEl.textContent = "Abstimmungsphase";
  }
  
  roundCounterEl.textContent = `Runde ${gameState.round || 1}`;
  updatePlayersList();
}

// VOICE-ONLY: Angepasste Spielerliste (OHNE Wörter)
function updatePlayersList() {
  if (!playersListEl || !gameState.players) return;
  
  playersListEl.innerHTML = "";
  
  gameState.players.forEach(player => {
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-card";
    
    if (player === gameState.currentPlayer) {
      playerDiv.classList.add("current");
    }
    
    if (player === playerName) {
      playerDiv.classList.add("self");
    }
    
    // VOICE-ONLY: Zeige Status statt Wörter
    const playerStatus = player === gameState.currentPlayer ? "🎤 Spricht..." : "👂 Hört zu...";
    
    playerDiv.innerHTML = `
      <div class="player-name">${player}</div>
      <div class="player-word">${playerStatus}</div>
    `;
    
    playersListEl.appendChild(playerDiv);
  });
}

// VOICE-ONLY: Neue UI Funktionen
function showVoiceGameArea() {
  hideAllInputs();
  voiceGameAreaEl.style.display = "block";
}

function showVoiceWaitingArea(currentPlayer) {
  hideAllInputs();
  voiceWaitingAreaEl.style.display = "block";
  currentSpeakerEl.textContent = currentPlayer;
}

function showVoting() {
  hideAllInputs();
  votingAreaEl.style.display = "block";
  
  votingButtonsEl.innerHTML = "";
  selectedVote = null;
  confirmVoteBtnEl.style.display = "none";
  
  gameState.players.forEach(player => {
    if (player !== playerName) {
      const button = document.createElement("button");
      button.className = "vote-btn";
      button.textContent = player;
      button.onclick = () => selectVote(player, button);
      votingButtonsEl.appendChild(button);
    }
  });
}

// VOICE-ONLY: Angepasste hideAllInputs
function hideAllInputs() {
  voiceGameAreaEl.style.display = "none";
  voiceWaitingAreaEl.style.display = "none";
  votingAreaEl.style.display = "none";
  imposterGuessAreaEl.style.display = "none";
  
  const imposterVoting = document.getElementById("imposterVotingOptions");
  if (imposterVoting) {
    imposterVoting.remove();
  }
}

function showWaiting(message = "Warte auf andere Spieler...") {
  waitingAreaEl.style.display = "block";
  waitingTextEl.textContent = message;
}

function hideWaiting() {
  waitingAreaEl.style.display = "none";
}

function setupPermanentImposterGuess() {
  const floatingGuess = document.createElement("div");
  floatingGuess.id = "floatingImposterGuess";
  floatingGuess.className = "floating-imposter-guess";
  floatingGuess.innerHTML = `
    <div class="floating-content">
      <h4>Imposter Guess</h4>
      <input type="text" id="floatingGuessInput" placeholder="Das geheime Wort ist..." maxlength="30" />
      <button onclick="submitFloatingGuess()" class="guess-btn">Wort raten</button>
      <button onclick="toggleFloatingGuess()" class="minimize-btn">−</button>
    </div>
  `;
  
  document.body.appendChild(floatingGuess);
  
  document.getElementById("floatingGuessInput").addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      submitFloatingGuess();
    }
  });
}

function toggleFloatingGuess() {
  const floating = document.getElementById("floatingImposterGuess");
  if (floating) {
    floating.classList.toggle("minimized");
  }
}

function submitFloatingGuess() {
  const input = document.getElementById("floatingGuessInput");
  const guess = input.value.trim();
  
  if (guess === "") {
    showError("Bitte gib deine Vermutung ein!");
    return;
  }
  
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showError("Keine Verbindung zum Server!");
    return;
  }
  
  socket.send(JSON.stringify({
    type: "imposterGuess",
    roomCode: roomCode,
    playerName: playerName,
    guess: guess
  }));
  
  input.value = "";
  showSuccess("Vermutung abgegeben!");
}

// IMPOSTER VOTING (behält die komplexe Logik bei)
function showImposterVotingOptions() {
  const imposterVotingDiv = document.createElement("div");
  imposterVotingDiv.id = "imposterVotingOptions";
  imposterVotingDiv.className = "imposter-voting";
  imposterVotingDiv.innerHTML = `
    <h3>Du bist der Imposter!</h3>
    <p>Du kannst abstimmen, das Wort raten oder die Abstimmung überspringen:</p>
    
    <div class="imposter-actions">
      <button onclick="showImposterVoting()" class="vote-btn" style="margin: 5px; width: auto; display: inline-block;">
        Abstimmen
      </button>
      <button onclick="showImposterGuessInVoting()" class="guess-btn" style="margin: 5px; width: auto; display: inline-block;">
        Wort raten
      </button>
      <button onclick="skipVote()" class="skip-btn" style="margin: 5px; width: auto; display: inline-block;">
        ⏭Überspringen
      </button>
    </div>
    
    <div id="imposterVotingArea" style="display: none; margin-top: 20px;">
      <h4>Wähle einen Spieler:</h4>
      <div id="imposterVotingButtons" class="voting-buttons"></div>
      <div class="voting-controls">
        <button id="imposterConfirmVoteBtn" onclick="confirmVote()" class="confirm-btn" style="display:none;">
          Stimme bestätigen
        </button>
        <button onclick="hideImposterVoting()" class="skip-btn">
          Zurück
        </button>
      </div>
    </div>
    
    <div id="imposterGuessInVotingArea" style="display: none; margin-top: 20px;">
      <h4>Rate das geheime Wort:</h4>
      <div class="input-group">
        <input type="text" id="imposterVotingGuess" placeholder="Das geheime Wort ist..." maxlength="30" />
        <button onclick="submitImposterVotingGuess()" class="guess-btn">Wort raten</button>
        <button onclick="hideImposterGuess()" class="skip-btn">Zurück</button>
      </div>
    </div>
  `;
  
  const gameStatus = document.querySelector(".game-status-header") || document.querySelector(".game-status");
  if (gameStatus.nextSibling) {
    gameStatus.parentNode.insertBefore(imposterVotingDiv, gameStatus.nextSibling);
  } else {
    gameStatus.parentNode.appendChild(imposterVotingDiv);
  }
}

function showImposterVoting() {
  document.querySelector(".imposter-actions").style.display = "none";
  
  const votingArea = document.getElementById("imposterVotingArea");
  votingArea.style.display = "block";
  
  const votingButtons = document.getElementById("imposterVotingButtons");
  votingButtons.innerHTML = "";
  selectedVote = null;
  document.getElementById("imposterConfirmVoteBtn").style.display = "none";
  
  gameState.players.forEach(player => {
    if (player !== playerName) {
      const button = document.createElement("button");
      button.className = "vote-btn";
      button.textContent = player;
      button.onclick = () => selectImposterVote(player, button);
      votingButtons.appendChild(button);
    }
  });
}

function selectImposterVote(player, buttonEl) {
  document.querySelectorAll('#imposterVotingButtons .vote-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  
  buttonEl.classList.add('selected');
  selectedVote = player;
  document.getElementById("imposterConfirmVoteBtn").style.display = "inline-block";
}

function hideImposterVoting() {
  document.querySelector(".imposter-actions").style.display = "block";
  document.getElementById("imposterVotingArea").style.display = "none";
  selectedVote = null;
}

function showImposterGuessInVoting() {
  document.querySelector(".imposter-actions").style.display = "none";
  
  const guessArea = document.getElementById("imposterGuessInVotingArea");
  guessArea.style.display = "block";
  
  document.getElementById("imposterVotingGuess").focus();
}

function hideImposterGuess() {
  document.querySelector(".imposter-actions").style.display = "block";
  document.getElementById("imposterGuessInVotingArea").style.display = "none";
  document.getElementById("imposterVotingGuess").value = "";
}

function submitImposterVotingGuess() {
  const guess = document.getElementById("imposterVotingGuess").value.trim();
  
  if (guess === "") {
    showError("Bitte gib deine Vermutung ein!");
    return;
  }
  
  socket.send(JSON.stringify({
    type: "imposterGuess",
    roomCode: roomCode,
    playerName: playerName,
    guess: guess
  }));
  
  document.getElementById("imposterVotingGuess").value = "";
  hideAllInputs();
  showWaiting("Vermutung abgegeben - warte auf Ergebnis...");
}

// STANDARD VOTING FUNKTIONEN
function selectVote(player, buttonEl) {
  document.querySelectorAll('.vote-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  
  buttonEl.classList.add('selected');
  selectedVote = player;
  confirmVoteBtnEl.style.display = "inline-block";
}

function confirmVote() {
  if (!selectedVote) {
    showError("Bitte wähle einen Spieler aus!");
    return;
  }
  
  socket.send(JSON.stringify({
    type: "vote",
    roomCode: roomCode,
    playerName: playerName,
    votedPlayer: selectedVote
  }));
  
  hideAllInputs();
  showWaiting("Stimme abgegeben - warte auf andere...");
}

function skipVote() {
  socket.send(JSON.stringify({
    type: "skipVote",
    roomCode: roomCode,
    playerName: playerName
  }));
  
  hideAllInputs();
  showWaiting("Abstimmung übersprungen - warte auf andere...");
}

function submitImposterGuess() {
  const guess = imposterGuessEl.value.trim();
  if (guess === "") {
    showError("Bitte gib deine Vermutung ein!");
    return;
  }
  
  socket.send(JSON.stringify({
    type: "imposterGuess",
    roomCode: roomCode,
    playerName: playerName,
    guess: guess
  }));
  
  imposterGuessEl.value = "";
  hideAllInputs();
  showWaiting("Vermutung abgegeben - warte auf Ergebnis...");
}

function skipImposterGuess() {
  socket.send(JSON.stringify({
    type: "skipImposterGuess",
    roomCode: roomCode,
    playerName: playerName
  }));
  
  hideAllInputs();
  showWaiting("Noch nicht bereit - warte auf nächste Runde...");
}

function playAgain() {
  socket.send(JSON.stringify({
    type: "playAgain",
    roomCode: roomCode,
    playerName: playerName
  }));
  
  currentRound = 1;
  myRole = null;
  isImposter = false;
  selectedVote = null;
  gameEndAreaEl.style.display = "none";
  wordDisplayEl.style.display = "none";
  
  const floating = document.getElementById("floatingImposterGuess");
  if (floating) {
    floating.remove();
  }
  
  showWaiting("Neues Spiel wird gestartet...");
}

function backToLobby() {
  window.location.href = `lobby.html?room=${roomCode}&name=${encodeURIComponent(playerName)}`;
}

// TOAST FUNKTIONEN
function showError(message) {
  const toast = document.createElement("div");
  toast.className = "toast error";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #C42000;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    z-index: 1000;
    animation: slideIn 0.3s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-weight: 500;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

function showSuccess(message) {
  const toast = document.createElement("div");
  toast.className = "toast success";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #000000;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    z-index: 1000;
    animation: slideIn 0.3s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-weight: 500;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function showGameMessage(message) {
  const toast = document.createElement("div");
  toast.className = "toast info";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #616161;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    z-index: 1000;
    animation: slideIn 0.3s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-weight: 500;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

// EVENT LISTENERS
imposterGuessEl.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    submitImposterGuess();
  }
});

document.addEventListener('DOMContentLoaded', function() {
  document.addEventListener('keypress', function(e) {
    if (e.target && e.target.id === 'imposterVotingGuess' && e.key === 'Enter') {
      submitImposterVotingGuess();
    }
  });
});

window.addEventListener("beforeunload", () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
});

setInterval(() => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "ping" }));
  }
}, 30000);

// CSS für Voice-Only
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
  
  .game-end-reason {
    font-style: italic;
    margin-top: 15px;
    padding: 15px;
    background: rgba(107, 114, 128, 0.1);
    border-radius: 8px;
    border-left: 4px solid #6B7280;
    font-size: 14px;
    line-height: 1.5;
  }
  
  .imposter-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
    flex-wrap: wrap;
    margin: 20px 0;
  }
  
  .imposter-actions button {
    min-width: 120px;
    padding: 12px 16px;
    font-size: 14px;
    font-weight: 600;
    border-radius: 8px;
    transition: all 0.3s ease;
  }
  
  @media (max-width: 768px) {
    .imposter-actions {
      flex-direction: column;
      align-items: center;
    }
    
    .imposter-actions button {
      width: 100%;
      max-width: 250px;
    }
  }
`;
document.head.appendChild(style);