const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

let rooms = {};
let games = {};

// 🔒 SICHER: Wörter aus separater JSON-Datei laden
let WORD_DATABASE = {};
try {
  const wordsData = fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8');
  WORD_DATABASE = JSON.parse(wordsData);
  console.log(`📚 Wörter-Datenbank geladen: ${WORD_DATABASE.metadata.totalWords} Wörter in ${WORD_DATABASE.metadata.categories} Kategorien`);
} catch (error) {
  console.error("❌ Fehler beim Laden der Wörter-Datenbank:", error);
  process.exit(1);
}

// 🔒 SICHER: Socket-Verwaltung
let playerSockets = {}; // roomCode_playerName -> WebSocket

// ============ HTTP-Server ============
const server = http.createServer((req, res) => {
  const cleanUrl = req.url.split("?")[0];
  
  if (cleanUrl === "/favicon.ico") {
    res.writeHead(204, { "Content-Type": "image/x-icon" });
    res.end();
    return;
  }

  // 🔒 SICHER: words.json vor Client-Zugriff schützen
  if (cleanUrl === "/words.json") {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("403 Forbidden - Access Denied");
    return;
  }
  
  const filePath = path.join(__dirname, cleanUrl === "/" ? "index.html" : cleanUrl);

  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".json": "application/json"
  };
  const contentType = contentTypes[ext] || "text/plain";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      console.log(`❌ Datei nicht gefunden: ${filePath}`);
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<h1>404 - Datei nicht gefunden</h1>");
    } else {
      res.writeHead(200, { 
        "Content-Type": contentType,
        "Cache-Control": "no-cache"
      });
      res.end(content);
    }
  });
});

server.listen(8080, () => {
  console.log("🌐 HTML-Server läuft auf http://91.99.105.134:8080");
});

// ============ WebSocket-Server ============
const wss = new WebSocket.Server({ port: 3000 });

// 🔒 SICHER: Hilfsfunktionen
function getRandomWord() {
  const categories = Object.keys(WORD_DATABASE.categories);
  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const words = WORD_DATABASE.categories[randomCategory];
  const selectedWord = words[Math.floor(Math.random() * words.length)];
  
  console.log(`🎲 Zufälliges Wort gewählt: "${selectedWord}" aus Kategorie: ${randomCategory}`);
  return selectedWord;
}

function getWordHint(word) {
  return WORD_DATABASE.hints[word] || "Kein Hinweis verfügbar";
}

function selectImposters(players, imposterCount) {
  const shuffled = [...players].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, imposterCount);
}

// 🆕 FIX 2: Random Starting Player
function selectRandomStartingPlayer(players) {
  return players[Math.floor(Math.random() * players.length)];
}

function getSocketKey(roomCode, playerName) {
  return `${roomCode}_${playerName}`;
}

// 🔒 SICHER: Broadcasting-Funktion mit detailliertem Logging
function broadcastToRoom(roomCode, message) {
  if (!rooms[roomCode]) {
    console.log(`❌ Raum ${roomCode} existiert nicht für Broadcast`);
    return 0;
  }

  const room = rooms[roomCode];
  let successCount = 0;
  let failedPlayers = [];

  console.log(`📡 Broadcasting zu Raum ${roomCode}: ${message.type} an ${room.players.length} Spieler`);

  room.players.forEach((playerName) => {
    const socketKey = getSocketKey(roomCode, playerName);
    const socket = playerSockets[socketKey];
    
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
        successCount++;
        console.log(`  ✅ Erfolgreich gesendet an ${playerName}`);
      } catch (error) {
        console.error(`  ❌ Fehler beim Senden an ${playerName}:`, error.message);
        failedPlayers.push(playerName);
        delete playerSockets[socketKey];
      }
    } else {
      console.log(`  ⚠️ Socket nicht verfügbar/bereit für ${playerName}`);
      failedPlayers.push(playerName);
      
      const playerIndex = room.players.indexOf(playerName);
      if (playerIndex !== -1 && room.sockets[playerIndex]) {
        const fallbackSocket = room.sockets[playerIndex];
        if (fallbackSocket.readyState === WebSocket.OPEN) {
          try {
            fallbackSocket.send(JSON.stringify(message));
            playerSockets[socketKey] = fallbackSocket;
            successCount++;
            console.log(`  🔄 Fallback erfolgreich für ${playerName}`);
            failedPlayers = failedPlayers.filter(p => p !== playerName);
          } catch (error) {
            console.error(`  ❌ Auch Fallback fehlgeschlagen für ${playerName}`);
          }
        }
      }
    }
  });

  if (failedPlayers.length > 0) {
    console.log(`⚠️ Broadcasting fehlgeschlagen für: ${failedPlayers.join(", ")}`);
  }

  console.log(`📊 Broadcast Ergebnis: ${successCount}/${room.players.length} erfolgreich`);
  return successCount;
}

function broadcastToGame(roomCode, message) {
  if (!games[roomCode]) {
    console.log(`❌ Spiel ${roomCode} existiert nicht für Game-Broadcast`);
    return 0;
  }
  return broadcastToRoom(roomCode, message);
}

// 🔒 SICHER: Socket-Cleanup verbessert
function removePlayerFromRoom(roomCode, playerName) {
  if (!rooms[roomCode]) return;
  
  const room = rooms[roomCode];
  const playerIndex = room.players.indexOf(playerName);
  
  if (playerIndex !== -1) {
    console.log(`🔴 Entferne ${playerName} aus Raum ${roomCode}`);
    
    room.players.splice(playerIndex, 1);
    room.sockets.splice(playerIndex, 1);
    
    const socketKey = getSocketKey(roomCode, playerName);
    delete playerSockets[socketKey];
    
    if (games[roomCode]) {
      const game = games[roomCode];
      game.players = game.players.filter(p => p !== playerName);
      
      if (game.players.length < 3) {
        endGame(roomCode, "crewmates", `Spiel beendet - ${playerName} hat das Spiel verlassen`);
      } else if (game.currentPlayer === playerName) {
        nextPlayer(roomCode);
      }
    }
    
    broadcastToRoom(roomCode, {
      type: "playerList", 
      players: room.players
    });
    
    if (room.players.length === 0) {
      console.log(`🗑️ Raum ${roomCode} gelöscht (leer)`);
      delete rooms[roomCode];
      delete games[roomCode];
    }
  }
}

function isValidPlayerName(name) {
  return name && typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 20;
}

function isValidRoomCode(roomCode) {
  return roomCode && typeof roomCode === 'string' && roomCode.trim().length > 0;
}

// 🔥 TIMER FIX: Synchroner Timer für alle Clients
function startRoundTimer(roomCode) {
  const game = games[roomCode];
  if (!game || game.settings.roundTimeLimit === 0) return;

  console.log(`⏰ Starte Timer für ${game.settings.roundTimeLimit} Sekunden in Raum ${roomCode}`);
  
  // Setze Start-Zeit
  game.roundStartTime = Date.now();
  game.roundEndTime = Date.now() + (game.settings.roundTimeLimit * 1000);
  
  // Sende Timer-Update alle Sekunde
  const timerInterval = setInterval(() => {
    if (!games[roomCode] || games[roomCode].phase !== "playing") {
      clearInterval(timerInterval);
      return;
    }
    
    const now = Date.now();
    const timeRemaining = Math.max(0, Math.ceil((game.roundEndTime - now) / 1000));
    
    // Update für alle Clients
    broadcastToGame(roomCode, {
      type: "timerUpdate",
      timeRemaining: timeRemaining,
      totalTime: game.settings.roundTimeLimit
    });
    
    // Zeit abgelaufen
    if (timeRemaining === 0) {
      clearInterval(timerInterval);
      console.log(`⏰ Zeitlimit erreicht in Raum ${roomCode} - zwinge Abstimmung`);
      startVotingPhase(roomCode, true);
    }
  }, 1000);
  
  // Speichere Interval-ID für Cleanup
  game.timerInterval = timerInterval;
}

function startGame(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.players.length < 3) {
    return false;
  }

  const settings = room.gameSettings || {
    imposterCount: 1,
    roundTimeLimit: 300,
    imposterHint: true
  };

  const secretWord = getRandomWord();
  const maxPossibleImposters = Math.floor(room.players.length / 2);
  const actualImposterCount = Math.min(settings.imposterCount, maxPossibleImposters);
  const imposters = selectImposters(room.players, actualImposterCount);
  
  // 🆕 FIX 2: Random Starting Player statt immer Spieler 0
  const startingPlayer = selectRandomStartingPlayer(room.players);
  const startingPlayerIndex = room.players.indexOf(startingPlayer);
  
  console.log(`🎮 Spiel gestartet in Raum ${roomCode}:`);
  console.log(`   Geheimes Wort: ${secretWord}`);
  console.log(`   Imposter(s): ${imposters.join(", ")} (${actualImposterCount}/${room.players.length})`);
  console.log(`   Spieler: ${room.players.join(", ")}`);
  console.log(`   Startender Spieler: ${startingPlayer} (Index: ${startingPlayerIndex})`);
  console.log(`   Timer: ${settings.roundTimeLimit} Sekunden`);

  games[roomCode] = {
    players: [...room.players],
    secretWord: secretWord,
    imposters: imposters,
    currentPlayer: startingPlayer, // 🆕 FIX 2: Random Starting Player
    currentPlayerIndex: startingPlayerIndex, // 🆕 FIX 2: Random Starting Index
    round: 1,
    phase: "playing",
    wordsSpoken: [],
    votes: {},
    playersReady: new Set(),
    startTime: Date.now(),
    roundStartTime: Date.now(),
    roundEndTime: null,
    timerInterval: null,
    settings: settings,
    hostPlayer: room.players[0] // 🆕 FIX 1: Speichere Host für Play Again Control
  };

  broadcastToRoom(roomCode, { type: "startGame" });
  
  setTimeout(() => {
    if (games[roomCode]) {
      broadcastToGame(roomCode, {
        type: "gameStarted",
        gameState: {
          players: games[roomCode].players,
          currentPlayer: games[roomCode].currentPlayer,
          round: games[roomCode].round,
          phase: games[roomCode].phase,
          settings: games[roomCode].settings
        }
      });
    }
  }, 1000);

  // 🔒 KRITISCHER SICHERHEITS-FIX: Rollen SICHER zuweisen
  setTimeout(() => {
    if (games[roomCode]) {
      const game = games[roomCode];
      
      room.players.forEach((playerName) => {
        const socketKey = getSocketKey(roomCode, playerName);
        const socket = playerSockets[socketKey];
        
        if (socket && socket.readyState === WebSocket.OPEN) {
          const isImposter = game.imposters.includes(playerName);
          
          const roleData = {
            type: "roleAssignment",
            role: isImposter ? "imposter" : "crewmate"
          };
          
          // 🔒 SICHER: Wort NUR an Crewmates senden
          if (!isImposter) {
            roleData.word = game.secretWord;
          }
          
          // 🔒 SICHER: Hinweis NUR an Imposter senden
          if (isImposter && game.settings.imposterHint) {
            roleData.hint = getWordHint(game.secretWord);
          }
          
          socket.send(JSON.stringify(roleData));
          console.log(`🎭 Rolle zugewiesen an ${playerName}: ${roleData.role} ${isImposter ? '(mit Hinweis)' : '(mit Wort)'}`);
        }
      });
      
      // 🔥 TIMER FIX: Starte synchronen Timer
      if (game.settings.roundTimeLimit > 0) {
        startRoundTimer(roomCode);
      }
    }
  }, 1500);

  return true;
}

// 🔥 BUG FIX: Verbesserte nextPlayer Funktion
function nextPlayer(roomCode) {
  const game = games[roomCode];
  if (!game) {
    console.log(`❌ nextPlayer: Spiel ${roomCode} existiert nicht`);
    return;
  }

  console.log(`🔄 nextPlayer in Raum ${roomCode}: Aktueller Index ${game.currentPlayerIndex}`);

  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
  game.currentPlayer = game.players[game.currentPlayerIndex];

  console.log(`➡️ Nächster Spieler: ${game.currentPlayer} (Index: ${game.currentPlayerIndex})`);

  // BUG FIX: Wenn wir wieder bei Index 0 sind, ist die Runde vorbei
  if (game.currentPlayerIndex === 0) {
    game.round++;
    
    // Stop Timer
    if (game.timerInterval) {
      clearInterval(game.timerInterval);
      game.timerInterval = null;
    }
    
    console.log(`🔄 Runde ${game.round} beendet - Abstimmungsphase verfügbar`);
    startVotingPhase(roomCode, false);
  } else {
    // BUG FIX: Für normale Spielerwechsel sende nextPlayerTurn statt gameState
    const now = Date.now();
    const timeRemaining = game.roundEndTime ? Math.max(0, Math.ceil((game.roundEndTime - now) / 1000)) : null;
    
    const nextPlayerMessage = {
      type: "nextPlayerTurn",
      currentPlayer: game.currentPlayer,
      currentPlayerIndex: game.currentPlayerIndex,
      gameState: {
        players: game.players,
        currentPlayer: game.currentPlayer,
        round: game.round,
        phase: game.phase,
        timeRemaining: timeRemaining
      }
    };

    console.log(`📡 Sende nextPlayerTurn an alle Spieler in Raum ${roomCode}`);
    console.log(`🎯 Neuer aktueller Spieler: ${game.currentPlayer}`);
    
    const sentCount = broadcastToGame(roomCode, nextPlayerMessage);
    
    if (sentCount === 0) {
      console.log(`⚠️ Kein Spieler hat nextPlayerTurn erhalten - versuche erneut in 2 Sekunden`);
      setTimeout(() => {
        if (games[roomCode]) {
          console.log(`🔄 Retry nextPlayerTurn Broadcast für Raum ${roomCode}`);
          broadcastToGame(roomCode, nextPlayerMessage);
        }
      }, 2000);
    }
  }
}

function startVotingPhase(roomCode, forced = false) {
  const game = games[roomCode];
  if (!game) return;

  // Stop Timer
  if (game.timerInterval) {
    clearInterval(game.timerInterval);
    game.timerInterval = null;
  }

  game.phase = "voting";
  game.votes = {};
  game.playersReady.clear();

  console.log(`🗳️ Abstimmungsphase gestartet in Raum ${roomCode} ${forced ? '(erzwungen)' : ''}`);

  broadcastToGame(roomCode, {
    type: "votingPhase",
    forced: forced,
    gameState: {
      players: game.players,
      currentPlayer: null,
      round: game.round,
      phase: game.phase
    }
  });
}

function processVote(roomCode, voter, votedPlayer) {
  const game = games[roomCode];
  if (!game || game.phase !== "voting") return;

  game.votes[voter] = votedPlayer;
  game.playersReady.add(voter);

  console.log(`🗳️ ${voter} hat für ${votedPlayer} gestimmt`);

  checkVotingComplete(roomCode);
}

function skipVote(roomCode, player) {
  const game = games[roomCode];
  if (!game || game.phase !== "voting") return;

  game.playersReady.add(player);
  console.log(`⏭️ ${player} hat Abstimmung übersprungen`);

  checkVotingComplete(roomCode);
}

// 🆕 FIX 4: Verbesserte Voting Logic
function checkVotingComplete(roomCode) {
  const game = games[roomCode];
  if (!game) return;

  const crewmates = game.players.filter(p => !game.imposters.includes(p));
  
  if (crewmates.every(player => game.playersReady.has(player))) {
    const voteCounts = {};
    const totalVotes = Object.keys(game.votes).length;
    const totalCrewmates = crewmates.length;
    
    console.log(`🗳️ Voting Complete Check:`);
    console.log(`   Total Crewmates: ${totalCrewmates}`);
    console.log(`   Total Votes Cast: ${totalVotes}`);
    console.log(`   Votes: ${JSON.stringify(game.votes)}`);
    
    // Count votes
    Object.values(game.votes).forEach(votedPlayer => {
      voteCounts[votedPlayer] = (voteCounts[votedPlayer] || 0) + 1;
    });

    console.log(`   Vote Counts: ${JSON.stringify(voteCounts)}`);

    // 🆕 FIX 4: Neue Voting Logic
    const maxVotes = Math.max(...Object.values(voteCounts), 0);
    const eliminatedPlayers = Object.keys(voteCounts).filter(p => voteCounts[p] === maxVotes);
    
    // 🆕 FIX 4: Verbesserte Voting Logic - Echte Mehrheit erforderlich
    // Bedingungen für Elimination:
    // 1. MEHR als die Hälfte der Crewmates muss voten (51%+)
    // 2. Es muss einen eindeutigen Gewinner geben (kein Tie)
    // 3. Der Gewinner muss mindestens 2 Stimmen haben (außer bei sehr wenigen Spielern)
    
    const minimumVotesRequired = Math.floor(totalCrewmates / 2) + 1; // 51%+ = echte Mehrheit
    const minimumVotesToEliminate = Math.max(1, Math.ceil(totalCrewmates / 3)); // Mindestens 1/3 der Crewmates
    
    console.log(`   Minimum Votes Required: ${minimumVotesRequired}`);
    console.log(`   Minimum Votes to Eliminate: ${minimumVotesToEliminate}`);
    console.log(`   Max Votes Received: ${maxVotes}`);
    console.log(`   Players with Max Votes: ${eliminatedPlayers.join(", ")}`);
    
    if (totalVotes >= minimumVotesRequired && 
        maxVotes >= minimumVotesToEliminate && 
        eliminatedPlayers.length === 1) {
      
      const eliminated = eliminatedPlayers[0];
      console.log(`✅ Elimination Conditions Met - ${eliminated} wird eliminiert`);
      
      // 🆕 FIX 4: Imposter Last Chance Feature
      if (game.imposters.includes(eliminated)) {
        console.log(`🕵️ Imposter ${eliminated} wurde gewählt - gebe letzte Chance zum Raten`);
        
        // Starte "Last Chance" Phase
        game.phase = "imposterLastChance";
        game.eliminatedImposter = eliminated;
        game.playersReady.clear();
        
        broadcastToGame(roomCode, {
          type: "imposterLastChance",
          eliminatedImposter: eliminated,
          gameState: {
            players: game.players,
            currentPlayer: null,
            round: game.round,
            phase: game.phase
          }
        });
        
        // Timeout für letzte Chance (30 Sekunden)
        setTimeout(() => {
          if (games[roomCode] && games[roomCode].phase === "imposterLastChance") {
            console.log(`⏰ Imposter ${eliminated} hat Zeit überschritten - Crewmates gewinnen`);
            
            // Imposter aus Spiel entfernen
            const remainingImposters = game.imposters.filter(imp => imp !== eliminated);
            if (remainingImposters.length === 0) {
              endGame(roomCode, "crewmates", `Crewmates haben gewonnen! Imposter ${eliminated} wurde eliminiert und konnte das Wort nicht erraten.`);
            } else {
              game.imposters = remainingImposters;
              game.players = game.players.filter(p => p !== eliminated);
              continueGameAfterElimination(roomCode, eliminated, false);
            }
          }
        }, 30000); // 30 Sekunden Zeit
        
      } else {
        // Crewmate wurde eliminiert - Imposter gewinnen sofort
        endGame(roomCode, "imposter", `Imposter haben gewonnen! Ein unschuldiger Crewmate (${eliminated}) wurde eliminiert.`);
      }
    } else {
      // 🆕 FIX 4: Keine Elimination - detailliertes Logging
      let reason = "";
      if (totalVotes < minimumVotesRequired) {
        reason = `Nicht genug Stimmen (${totalVotes}/${minimumVotesRequired} erforderlich)`;
      } else if (maxVotes < minimumVotesToEliminate) {
        reason = `Nicht genug Stimmen für Elimination (${maxVotes}/${minimumVotesToEliminate} erforderlich)`;
      } else if (eliminatedPlayers.length > 1) {
        reason = `Unentschieden zwischen ${eliminatedPlayers.join(", ")}`;
      }
      
      console.log(`❌ Keine Elimination: ${reason}`);
      
      // Spiel geht weiter
      game.phase = "playing";
      game.currentPlayerIndex = 0;
      game.currentPlayer = game.players[0];
      
      // 🔥 TIMER FIX: Starte neuen Timer für nächste Runde
      if (game.settings.roundTimeLimit > 0) {
        startRoundTimer(roomCode);
      }
      
      broadcastToGame(roomCode, {
        type: "gameState",
        gameState: {
          players: game.players,
          currentPlayer: game.currentPlayer,
          round: game.round,
          phase: game.phase
        }
      });
    }
  }
}

function continueGameAfterElimination(roomCode, eliminated, imposterWon) {
  const game = games[roomCode];
  if (!game) return;
  
  game.phase = "playing";
  game.currentPlayerIndex = 0;
  game.currentPlayer = game.players[0];
  
  // 🔥 TIMER FIX: Starte neuen Timer
  if (game.settings.roundTimeLimit > 0) {
    startRoundTimer(roomCode);
  }
  
  broadcastToGame(roomCode, {
    type: "playerEliminated",
    eliminated: eliminated,
    imposterWon: imposterWon,
    gameState: {
      players: game.players,
      currentPlayer: game.currentPlayer,
      round: game.round,
      phase: game.phase
    }
  });
}

// 🔥 NEW: Erweiterte processImposterGuess Funktion
function processImposterGuess(roomCode, playerName, guess) {
  const game = games[roomCode];
  if (!game) return;

  const isCorrect = guess.toLowerCase().trim() === game.secretWord.toLowerCase().trim();
  
  console.log(`🕵️ Imposter ${playerName} rät: "${guess}" - ${isCorrect ? 'RICHTIG' : 'FALSCH'}`);
  
  if (isCorrect) {
    endGame(roomCode, "imposter", `Imposter haben gewonnen! Das geheime Wort "${game.secretWord}" wurde erraten von ${playerName}.`);
  } else {
    // 🔥 NEW: Unterscheide zwischen normaler Phase und Last Chance
    if (game.phase === "imposterLastChance" && playerName === game.eliminatedImposter) {
      console.log(`💀 Imposter ${playerName} hat in der letzten Chance falsch geraten - Crewmates gewinnen`);
      
      // Imposter aus Spiel entfernen
      const remainingImposters = game.imposters.filter(imp => imp !== playerName);
      if (remainingImposters.length === 0) {
        endGame(roomCode, "crewmates", `Crewmates haben gewonnen! Imposter ${playerName} wurde eliminiert und hat falsch geraten: "${guess}" statt "${game.secretWord}".`);
      } else {
        game.imposters = remainingImposters;
        game.players = game.players.filter(p => p !== playerName);
        continueGameAfterElimination(roomCode, playerName, false);
      }
    } else {
      // Normale Phase - Spiel endet sofort bei falschem Guess
      endGame(roomCode, "crewmates", `Crewmates haben gewonnen! Imposter ${playerName} hat falsch geraten: "${guess}" statt "${game.secretWord}".`);
    }
  }
}

function endGame(roomCode, winner, reason) {
  const game = games[roomCode];
  if (!game) return;

  // Stop Timer
  if (game.timerInterval) {
    clearInterval(game.timerInterval);
    game.timerInterval = null;
  }

  console.log(`🏁 Spiel beendet in Raum ${roomCode}: ${winner} gewinnt - ${reason}`);

  broadcastToGame(roomCode, {
    type: "gameEnded",
    winner: winner,
    imposters: game.imposters,
    secretWord: game.secretWord,
    reason: reason,
    isHost: game.hostPlayer // 🆕 FIX 1: Sende Host-Info mit
  });

  delete games[roomCode];
}

// DEBUGGING: Status-Check Funktion
function debugSocketStatus(roomCode) {
  if (!rooms[roomCode]) return;
  
  const room = rooms[roomCode];
  console.log(`\n🔍 Socket Status für Raum ${roomCode}:`);
  console.log(`📊 ${room.players.length} Spieler registriert`);
  
  room.players.forEach((playerName, index) => {
    const socketKey = getSocketKey(roomCode, playerName);
    const mappedSocket = playerSockets[socketKey];
    const arraySocket = room.sockets[index];
    
    const mappedStatus = mappedSocket && mappedSocket.readyState === WebSocket.OPEN ? '✅' : '❌';
    const arrayStatus = arraySocket && arraySocket.readyState === WebSocket.OPEN ? '✅' : '❌';
    
    console.log(`  ${playerName}: Mapped=${mappedStatus} Array=${arrayStatus}`);
    
    if (mappedSocket !== arraySocket) {
      console.log(`    ⚠️ Socket-Mismatch detektiert für ${playerName}!`);
      // Auto-Fix
      if (mappedSocket && mappedSocket.readyState === WebSocket.OPEN) {
        room.sockets[index] = mappedSocket;
        console.log(`    🔧 Auto-Fix: Array-Socket aktualisiert`);
      }
    }
  });
  console.log(`🔍 Ende Socket Status\n`);
}

wss.on("connection", (ws) => {
  console.log("🟢 Neue Verbindung hergestellt");
  ws.playerInfo = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log("📩 Nachricht erhalten:", data);

      if (data.type === "joinRoom") {
        const { roomCode, name } = data;
        
        if (!isValidRoomCode(roomCode)) {
          ws.send(JSON.stringify({ type: "error", message: "Ungültiger Raumcode" }));
          return;
        }
        
        if (!isValidPlayerName(name)) {
          ws.send(JSON.stringify({ type: "error", message: "Ungültiger Spielername" }));
          return;
        }

        const playerName = name.trim();
        
        if (!rooms[roomCode]) {
          rooms[roomCode] = { 
            players: [], 
            sockets: [],
            gameSettings: {
              imposterCount: 1,
              roundTimeLimit: 300,
              imposterHint: true
            }
          };
          console.log(`🆕 Neuer Raum erstellt: ${roomCode}`);
        }

        const room = rooms[roomCode];
        const socketKey = getSocketKey(roomCode, playerName);
        
        if (room.players.includes(playerName)) {
          console.log(`🔄 ${playerName} reconnected to room ${roomCode}`);
          const playerIndex = room.players.indexOf(playerName);
          
          if (room.sockets[playerIndex]) {
            console.log(`🗑️ Entferne alte Socket-Referenz für ${playerName}`);
          }
          
          room.sockets[playerIndex] = ws;
          playerSockets[socketKey] = ws;
          
        } else {
          console.log(`➕ ${playerName} neu in Raum ${roomCode}`);
          room.players.push(playerName);
          room.sockets.push(ws);
          playerSockets[socketKey] = ws;
        }
        
        ws.playerInfo = { roomCode, name: playerName };
        ws.socketKey = socketKey;

        ws.send(JSON.stringify({ 
          type: "roomInfo", 
          roomCode,
          gameSettings: room.gameSettings
        }));
        
        setTimeout(() => {
          broadcastToRoom(roomCode, {
            type: "playerList",
            players: room.players
          });
        }, 100);
      }

      else if (data.type === "updateGameSettings") {
        const { roomCode, settings } = data;
        
        if (!rooms[roomCode]) {
          ws.send(JSON.stringify({ type: "error", message: "Raum nicht gefunden" }));
          return;
        }

        const room = rooms[roomCode];
        const playerIndex = room.sockets.indexOf(ws);
        
        if (playerIndex !== 0) {
          ws.send(JSON.stringify({ type: "error", message: "Nur der Host kann Einstellungen ändern" }));
          return;
        }

        const playerCount = room.players.length;
        const maxImposters = Math.max(1, Math.floor(playerCount / 2));
        
        const validatedSettings = {
          imposterCount: Math.max(1, Math.min(settings.imposterCount || 1, maxImposters)),
          roundTimeLimit: Math.max(0, Math.min(settings.roundTimeLimit || 300, 1800)),
          imposterHint: Boolean(settings.imposterHint)
        };

        room.gameSettings = validatedSettings;
        
        console.log(`⚙️ Spieleinstellungen aktualisiert in Raum ${roomCode}:`, validatedSettings);
        
        broadcastToRoom(roomCode, {
          type: "gameSettingsUpdated",
          settings: validatedSettings
        });
      }

      else if (data.type === "startGame") {
        const { roomCode } = data;
        
        if (!isValidRoomCode(roomCode) || !rooms[roomCode]) {
          ws.send(JSON.stringify({ type: "error", message: "Raum nicht gefunden" }));
          return;
        }

        const room = rooms[roomCode];
        const playerIndex = room.sockets.indexOf(ws);
        
        if (playerIndex !== 0) {
          ws.send(JSON.stringify({ type: "error", message: "Nur der Host kann das Spiel starten" }));
          return;
        }

        if (room.players.length < 3) {
          ws.send(JSON.stringify({ type: "error", message: "Mindestens 3 Spieler erforderlich für TheOddOne" }));
          return;
        }

        if (startGame(roomCode)) {
          console.log(`🚀 Spiel gestartet in Raum ${roomCode} mit ${room.players.length} Spielern`);
        }
      }

      else if (data.type === "joinGame") {
        const { roomCode, playerName } = data;
        const game = games[roomCode];
        const room = rooms[roomCode];
        
        if (!room) {
          ws.send(JSON.stringify({ 
            type: "error", 
            message: "Raum nicht gefunden. Gehe zurück zur Lobby." 
          }));
          return;
        }
        
       if (!room.players.includes(playerName)) {
          ws.send(JSON.stringify({ 
            type: "error", 
            message: "Du bist nicht in diesem Raum. Gehe zurück zur Lobby." 
          }));
          return;
        }
        
        if (game && game.players.includes(playerName)) {
          console.log(`🎮 ${playerName} ist dem laufenden Spiel in Raum ${roomCode} beigetreten`);
          
          const socketKey = getSocketKey(roomCode, playerName);
          playerSockets[socketKey] = ws;
          ws.socketKey = socketKey;
          
          ws.send(JSON.stringify({
            type: "gameStarted",
            gameState: {
              players: game.players,
              currentPlayer: game.currentPlayer,
              round: game.round,
              phase: game.phase,
              settings: game.settings
            }
          }));
          
          setTimeout(() => {
            if (games[roomCode] && ws.readyState === WebSocket.OPEN) {
              const currentGame = games[roomCode];
              const isImposter = currentGame.imposters.includes(playerName);
              
              const roleData = {
                type: "roleAssignment",
                role: isImposter ? "imposter" : "crewmate"
              };
              
              // 🔒 SICHER: Wort NUR an Crewmates senden
              if (!isImposter) {
                roleData.word = currentGame.secretWord;
              }
              
              // 🔒 SICHER: Hinweis NUR an Imposter senden
              if (isImposter && currentGame.settings.imposterHint) {
                roleData.hint = getWordHint(currentGame.secretWord);
              }
              
              ws.send(JSON.stringify(roleData));
              
              // Alle bisherigen Wörter senden
              currentGame.wordsSpoken.forEach(wordData => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: "wordSubmitted",
                    player: wordData.player,
                    word: wordData.word
                  }));
                }
              });
            }
          }, 1000);
          
        } else {
          ws.send(JSON.stringify({ 
            type: "noActiveGame", 
            message: "Kein aktives Spiel. Warte in der Lobby auf den Spielstart." 
          }));
        }
      }

      // 🔥 BUG FIX: Verbesserte submitWord Handler
      else if (data.type === "submitWord") {
        const { roomCode, playerName, word } = data;
        const game = games[roomCode];
        
        if (!game || game.phase !== "playing") {
          ws.send(JSON.stringify({ type: "error", message: "Spiel nicht in Wort-Phase" }));
          return;
        }

        if (game.currentPlayer !== playerName) {
          ws.send(JSON.stringify({ type: "error", message: "Du bist nicht dran" }));
          return;
        }

        if (!word || word.trim().length === 0) {
          ws.send(JSON.stringify({ type: "error", message: "Wort darf nicht leer sein" }));
          return;
        }

        const trimmedWord = word.trim();
        
        // VOICE-ONLY: Speichere nur Marker, nicht das echte Wort
        game.wordsSpoken.push({ player: playerName, word: "[VOICE_CHAT]" });
        
        console.log(`🎤 ${playerName} hat über Voice-Chat gesprochen - Broadcasting Marker...`);

        // Broadcasting nur des Voice-Markers
        const wordMessage = {
          type: "wordSubmitted",
          player: playerName,
          word: "[VOICE_CHAT]"
        };
        
        const room = rooms[roomCode];
        console.log(`🔍 Debug vor Broadcasting:`);
        console.log(`   Raum ${roomCode} hat ${room.players.length} Spieler: ${room.players.join(", ")}`);
        
        const successCount = broadcastToGame(roomCode, wordMessage);
        console.log(`📊 Broadcasting Ergebnis: ${successCount}/${room.players.length} erfolgreich`);
        
        if (successCount < room.players.length) {
          console.log(`⚠️ Nicht alle Spieler haben das Wort erhalten - versuche erneut in 500ms`);
          setTimeout(() => {
            console.log(`🔄 Retry Broadcasting für Voice-Chat von ${playerName}`);
            broadcastToGame(roomCode, wordMessage);
          }, 500);
        }

        // BUG FIX: Warte kurz, dann wechsle zum nächsten Spieler oder starte Voting
        setTimeout(() => {
          if (games[roomCode]) {
            console.log(`⏭️ Wechsel zum nächsten Spieler in Raum ${roomCode}`);
            console.log(`🔍 Aktueller Index: ${game.currentPlayerIndex}, Player Count: ${game.players.length}`);
            
            // BUG FIX: Prüfe ob wir am Ende der Runde sind BEVOR wir nextPlayer aufrufen
            const willBeEndOfRound = (game.currentPlayerIndex + 1) % game.players.length === 0;
            
            if (willBeEndOfRound) {
              console.log(`🔄 Ende der Runde erreicht - starte Voting Phase`);
              // Setze Round +1 und starte direkt Voting
              game.round++;
              
              // Stop Timer
              if (game.timerInterval) {
                clearInterval(game.timerInterval);
                game.timerInterval = null;
              }
              
              startVotingPhase(roomCode, false);
            } else {
              console.log(`➡️ Normaler Spielerwechsel`);
              nextPlayer(roomCode);
            }
          }
        }, 1000);
      }

      else if (data.type === "vote") {
        const { roomCode, playerName, votedPlayer } = data;
        processVote(roomCode, playerName, votedPlayer);
      }

      else if (data.type === "skipVote") {
        const { roomCode, playerName } = data;
        skipVote(roomCode, playerName);
      }

      else if (data.type === "imposterGuess") {
        const { roomCode, playerName, guess } = data;
        const game = games[roomCode];
        
        if (!game) {
          ws.send(JSON.stringify({ type: "error", message: "Kein aktives Spiel" }));
          return;
        }

        if (!game.imposters.includes(playerName)) {
          ws.send(JSON.stringify({ type: "error", message: "Du bist nicht der Imposter" }));
          return;
        }

        console.log(`🕵️ Imposter ${playerName} rät: "${guess}"`);
        processImposterGuess(roomCode, playerName, guess);
      }

      else if (data.type === "skipImposterGuess") {
        const { roomCode, playerName } = data;
        const game = games[roomCode];
        
        if (!game || !game.imposters.includes(playerName)) {
          ws.send(JSON.stringify({ type: "error", message: "Du bist nicht der Imposter" }));
          return;
        }

        game.playersReady.add(playerName);
        checkVotingComplete(roomCode);
      }

      // 🆕 FIX 1: Nur Host kann Play Again starten
      else if (data.type === "playAgain") {
        const { roomCode, playerName } = data;
        const room = rooms[roomCode];
        const game = games[roomCode];
        
        if (!room) {
          ws.send(JSON.stringify({ type: "error", message: "Raum nicht gefunden" }));
          return;
        }
        
        // 🆕 FIX 1: Prüfe ob Spieler der Host ist
        if (room.players[0] !== playerName) {
          ws.send(JSON.stringify({ type: "error", message: "Nur der Host kann das Spiel neu starten" }));
          return;
        }
        
        if (room.players.length >= 3) {
          console.log(`🎮 Host ${playerName} startet neues Spiel in Raum ${roomCode}`);
          startGame(roomCode);
        } else {
          ws.send(JSON.stringify({ type: "error", message: "Mindestens 3 Spieler für neues Spiel erforderlich" }));
        }
      }

      else if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }

      else {
        console.log(`⚠️ Unbekannter Message-Type: ${data.type}`);
        ws.send(JSON.stringify({ type: "error", message: "Unbekannter Befehl" }));
      }

    } catch (error) {
      console.error("❌ Fehler beim Verarbeiten der Nachricht:", error);
      ws.send(JSON.stringify({ type: "error", message: "Nachricht konnte nicht verarbeitet werden" }));
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`🔴 Verbindung getrennt (Code: ${code}, Grund: ${reason})`);
    
    if (ws.socketKey) {
      console.log(`🧹 Cleanup für Socket: ${ws.socketKey}`);
      delete playerSockets[ws.socketKey];
    }
    
    if (ws.playerInfo) {
      const { roomCode, name } = ws.playerInfo;
      console.log(`👋 ${name} hat Raum ${roomCode} verlassen`);
      
      setTimeout(() => {
        const socketKey = getSocketKey(roomCode, name);
        if (!playerSockets[socketKey]) {
          console.log(`⏰ ${name} hat sich nicht wieder verbunden - entferne aus Raum`);
          removePlayerFromRoom(roomCode, name);
        }
      }, 10000);
    }
  });

  ws.on("error", (error) => {
    console.error("❌ WebSocket Fehler:", error);
    if (ws.socketKey) {
      delete playerSockets[ws.socketKey];
    }
  });

  ws.send(JSON.stringify({ type: "connected", message: "Verbindung hergestellt" }));
});

// Status-Check alle 30 Sekunden
setInterval(() => {
  Object.keys(rooms).forEach(roomCode => {
    if (games[roomCode]) {
      debugSocketStatus(roomCode);
    }
  });
}, 30000);

// Clean up old disconnected players every 5 minutes
setInterval(() => {
  const roomCount = Object.keys(rooms).length;
  const gameCount = Object.keys(games).length;
  const totalPlayers = Object.values(rooms).reduce((sum, room) => sum + room.players.length, 0);
  const connectionCount = Object.keys(playerSockets).length;
  console.log(`📊 Status: ${roomCount} Räume, ${gameCount} aktive Spiele, ${totalPlayers} Spieler, ${connectionCount} Verbindungen`);
}, 60000);

process.on('SIGINT', () => {
  console.log('\n🛑 Server wird heruntergefahren...');
  
  wss.clients.forEach((ws) => {
    ws.close(1000, 'Server shutdown');
  });
  
  server.close(() => {
    console.log('✅ Server erfolgreich heruntergefahren');
    process.exit(0);
  });
});

console.log("✅ TheOddOne WebSocket-Server läuft auf Port 3000");
console.log("🎯 Bereit für Verbindungen!");