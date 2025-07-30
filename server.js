const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

let rooms = {};
let games = {};

// Wörter-Datenbank
const WORD_CATEGORIES = {
  animals: ["Hund", "Katze", "Elefant", "Pinguin", "Giraffe", "Löwe", "Tiger", "Bär"],
  food: ["Pizza", "Hamburger", "Spaghetti", "Sushi", "Schokolade", "Eis", "Kuchen", "Brot"],
  objects: ["Auto", "Stuhl", "Fernseher", "Handy", "Buch", "Brille", "Uhr", "Schlüssel"],
  places: ["Strand", "Wald", "Stadt", "Schule", "Krankenhaus", "Restaurant", "Kino", "Park"],
  activities: ["Schwimmen", "Lesen", "Kochen", "Tanzen", "Singen", "Malen", "Joggen", "Schlafen"]
};

// Hinweise für Imposter
const WORD_HINTS = {
  // Tiere
  "Hund": "Ein treuer Begleiter des Menschen",
  "Katze": "Schnurrt gerne und jagt Mäuse",
  "Elefant": "Das größte Landtier der Welt",
  "Pinguin": "Schwarz-weißer Vogel, der nicht fliegen kann",
  "Giraffe": "Das Tier mit dem längsten Hals",
  "Löwe": "Der König der Tiere",
  "Tiger": "Große Raubkatze mit Streifen",
  "Bär": "Großes, pelziges Säugetier",
  
  // Essen
  "Pizza": "Italienisches Gericht mit Teig und Belag",
  "Hamburger": "Fast Food zwischen zwei Brötchenhälften",
  "Spaghetti": "Lange, dünne Nudeln",
  "Sushi": "Japanische Spezialität mit rohem Fisch",
  "Schokolade": "Süße Leckerei aus Kakao",
  "Eis": "Kalte, gefrorene Süßspeise",
  "Kuchen": "Süße Backware für besondere Anlässe",
  "Brot": "Grundnahrungsmittel aus Getreide",
  
  // Gegenstände
  "Auto": "Fortbewegungsmittel mit vier Rädern",
  "Stuhl": "Sitzgelegenheit mit Rückenlehne",
  "Fernseher": "Gerät zum Schauen von Filmen und Serien",
  "Handy": "Mobiles Kommunikationsgerät",
  "Buch": "Sammlung von bedruckten Seiten",
  "Brille": "Sehhilfe für die Augen",
  "Uhr": "Zeigt die aktuelle Zeit an",
  "Schlüssel": "Öffnet Türen und Schlösser",
  
  // Orte
  "Strand": "Sandiger Ort am Meer",
  "Wald": "Viele Bäume stehen hier dicht beieinander",
  "Stadt": "Viele Menschen leben hier zusammen",
  "Schule": "Ort zum Lernen für Kinder",
  "Krankenhaus": "Hier werden kranke Menschen behandelt",
  "Restaurant": "Hier kann man Essen bestellen",
  "Kino": "Hier werden Filme gezeigt",
  "Park": "Grünfläche in der Stadt",
  
  // Aktivitäten
  "Schwimmen": "Bewegung im Wasser",
  "Lesen": "Bücher oder Texte durchgehen",
  "Kochen": "Zubereitung von Mahlzeiten",
  "Tanzen": "Bewegung zur Musik",
  "Singen": "Melodien mit der Stimme erzeugen",
  "Malen": "Bilder mit Farben erstellen",
  "Joggen": "Langsames Laufen als Sport",
  "Schlafen": "Nächtliche Ruhephase"
};

// FIXED: Bessere Socket-Verwaltung
let playerSockets = {}; // roomCode_playerName -> WebSocket

// ============ HTTP-Server ============
const server = http.createServer((req, res) => {
  const cleanUrl = req.url.split("?")[0];
  
  if (cleanUrl === "/favicon.ico") {
    res.writeHead(204, { "Content-Type": "image/x-icon" });
    res.end();
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

// Hilfsfunktionen
function getRandomWord() {
  const categories = Object.keys(WORD_CATEGORIES);
  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const words = WORD_CATEGORIES[randomCategory];
  return words[Math.floor(Math.random() * words.length)];
}

function selectImposters(players, imposterCount) {
  const shuffled = [...players].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, imposterCount);
}

function getSocketKey(roomCode, playerName) {
  return `${roomCode}_${playerName}`;
}

// FIXED: Verbesserte Broadcasting-Funktion mit detailliertem Logging
function broadcastToRoom(roomCode, message) {
  if (!rooms[roomCode]) {
    console.log(`❌ Raum ${roomCode} existiert nicht für Broadcast`);
    return 0;
  }

  const room = rooms[roomCode];
  let successCount = 0;
  let failedPlayers = [];

  console.log(`📡 Broadcasting zu Raum ${roomCode}: ${message.type} an ${room.players.length} Spieler`);

  // WICHTIGER FIX: Verwende playerSockets anstatt room.sockets Array
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
        
        // Socket ist defekt - entfernen
        delete playerSockets[socketKey];
      }
    } else {
      console.log(`  ⚠️ Socket nicht verfügbar/bereit für ${playerName}`);
      failedPlayers.push(playerName);
      
      // Versuche Socket aus room.sockets Array zu holen (Fallback)
      const playerIndex = room.players.indexOf(playerName);
      if (playerIndex !== -1 && room.sockets[playerIndex]) {
        const fallbackSocket = room.sockets[playerIndex];
        if (fallbackSocket.readyState === WebSocket.OPEN) {
          try {
            fallbackSocket.send(JSON.stringify(message));
            playerSockets[socketKey] = fallbackSocket; // Update mapping
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

// FIXED: Socket-Cleanup verbessert
function removePlayerFromRoom(roomCode, playerName) {
  if (!rooms[roomCode]) return;
  
  const room = rooms[roomCode];
  const playerIndex = room.players.indexOf(playerName);
  
  if (playerIndex !== -1) {
    console.log(`🔴 Entferne ${playerName} aus Raum ${roomCode}`);
    
    // Entferne aus Arrays
    room.players.splice(playerIndex, 1);
    room.sockets.splice(playerIndex, 1);
    
    // Entferne Socket-Mapping
    const socketKey = getSocketKey(roomCode, playerName);
    delete playerSockets[socketKey];
    
    // Game-Logic
    if (games[roomCode]) {
      const game = games[roomCode];
      game.players = game.players.filter(p => p !== playerName);
      
      if (game.players.length < 3) {
        endGame(roomCode, "crewmates", `Spiel beendet - ${playerName} hat das Spiel verlassen`);
      } else if (game.currentPlayer === playerName) {
        nextPlayer(roomCode);
      }
    }
    
    // Broadcast Update
    broadcastToRoom(roomCode, {
      type: "playerList", 
      players: room.players
    });
    
    // Raum löschen wenn leer
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
  
  console.log(`🎮 Spiel gestartet in Raum ${roomCode}:`);
  console.log(`   Geheimes Wort: ${secretWord}`);
  console.log(`   Imposter(s): ${imposters.join(", ")} (${actualImposterCount}/${room.players.length})`);
  console.log(`   Spieler: ${room.players.join(", ")}`);

  games[roomCode] = {
    players: [...room.players],
    secretWord: secretWord,
    imposters: imposters,
    currentPlayer: room.players[0],
    currentPlayerIndex: 0,
    round: 1,
    phase: "playing",
    wordsSpoken: [],
    votes: {},
    playersReady: new Set(),
    startTime: Date.now(),
    roundStartTime: Date.now(),
    settings: settings
  };

  // WICHTIG: Zuerst den gameStarted Event senden
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

  // Rollen zuweisen
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
            role: isImposter ? "imposter" : "crewmate",
            word: isImposter ? null : game.secretWord
          };
          
          if (isImposter && game.settings.imposterHint && WORD_HINTS[game.secretWord]) {
            roleData.hint = WORD_HINTS[game.secretWord];
          }
          
          socket.send(JSON.stringify(roleData));
          console.log(`🎭 Rolle zugewiesen an ${playerName}: ${roleData.role}`);
        }
      });
    }
  }, 1500);

  // Timer für Runde
  if (settings.roundTimeLimit > 0) {
    setTimeout(() => {
      if (games[roomCode] && games[roomCode].phase === "playing") {
        console.log(`⏰ Zeitlimit erreicht in Raum ${roomCode} - zwinge Abstimmung`);
        startVotingPhase(roomCode, true);
      }
    }, settings.roundTimeLimit * 1000);
  }

  return true;
}

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

  if (game.currentPlayerIndex === 0) {
    game.round++;
    
    const timeElapsed = (Date.now() - game.roundStartTime) / 1000;
    if (game.settings.roundTimeLimit > 0 && timeElapsed >= game.settings.roundTimeLimit) {
      console.log(`⏰ Zeitlimit erreicht - zwinge Abstimmung in Raum ${roomCode}`);
      startVotingPhase(roomCode, true);
    } else {
      console.log(`🔄 Runde ${game.round} beendet - Abstimmungsphase verfügbar`);
      startVotingPhase(roomCode, false);
    }
  } else {
    const gameStateMessage = {
      type: "gameState",
      gameState: {
        players: game.players,
        currentPlayer: game.currentPlayer,
        round: game.round,
        phase: game.phase,
        timeRemaining: game.settings.roundTimeLimit > 0 ? 
          Math.max(0, game.settings.roundTimeLimit - Math.floor((Date.now() - game.roundStartTime) / 1000)) : null
      }
    };

    console.log(`📡 Sende gameState Update an alle Spieler in Raum ${roomCode}`);
    console.log(`🎯 Neuer aktueller Spieler: ${game.currentPlayer}`);
    
    const sentCount = broadcastToGame(roomCode, gameStateMessage);
    
    // WICHTIG: Falls niemand das Update erhalten hat, versuche es nochmal
    if (sentCount === 0) {
      console.log(`⚠️ Kein Spieler hat gameState erhalten - versuche erneut in 2 Sekunden`);
      setTimeout(() => {
        if (games[roomCode]) {
          console.log(`🔄 Retry gameState Broadcast für Raum ${roomCode}`);
          broadcastToGame(roomCode, gameStateMessage);
        }
      }, 2000);
    }
  }
}

function startVotingPhase(roomCode, forced = false) {
  const game = games[roomCode];
  if (!game) return;

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

function checkVotingComplete(roomCode) {
  const game = games[roomCode];
  if (!game) return;

  const crewmates = game.players.filter(p => !game.imposters.includes(p));
  
  if (crewmates.every(player => game.playersReady.has(player))) {
    const voteCounts = {};
    Object.values(game.votes).forEach(votedPlayer => {
      voteCounts[votedPlayer] = (voteCounts[votedPlayer] || 0) + 1;
    });

    const maxVotes = Math.max(...Object.values(voteCounts), 0);
    const eliminatedPlayers = Object.keys(voteCounts).filter(p => voteCounts[p] === maxVotes);

    if (maxVotes > 0 && eliminatedPlayers.length === 1) {
      const eliminated = eliminatedPlayers[0];
      if (game.imposters.includes(eliminated)) {
        const remainingImposters = game.imposters.filter(imp => imp !== eliminated);
        if (remainingImposters.length === 0) {
          endGame(roomCode, "crewmates", `Crewmates haben gewonnen! Alle Imposter wurden eliminiert.`);
        } else {
          game.imposters = remainingImposters;
          game.players = game.players.filter(p => p !== eliminated);
          continueGameAfterElimination(roomCode, eliminated, false);
        }
      } else {
        endGame(roomCode, "imposter", `Imposter haben gewonnen! Ein unschuldiger Crewmate (${eliminated}) wurde eliminiert.`);
      }
    } else {
      game.phase = "playing";
      game.currentPlayerIndex = 0;
      game.currentPlayer = game.players[0];
      game.roundStartTime = Date.now();
      
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
  game.roundStartTime = Date.now();
  
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

function processImposterGuess(roomCode, playerName, guess) {
  const game = games[roomCode];
  if (!game) return;

  const isCorrect = guess.toLowerCase().trim() === game.secretWord.toLowerCase().trim();
  
  console.log(`🕵️ Imposter ${playerName} rät: "${guess}" - ${isCorrect ? 'RICHTIG' : 'FALSCH'}`);
  
  if (isCorrect) {
    endGame(roomCode, "imposter", `Imposter haben gewonnen! Das geheime Wort "${game.secretWord}" wurde erraten von ${playerName}.`);
  } else {
    endGame(roomCode, "crewmates", `Crewmates haben gewonnen! Imposter ${playerName} hat falsch geraten: "${guess}" statt "${game.secretWord}".`);
  }
}

function endGame(roomCode, winner, reason) {
  const game = games[roomCode];
  if (!game) return;

  console.log(`🏁 Spiel beendet in Raum ${roomCode}: ${winner} gewinnt - ${reason}`);

  broadcastToGame(roomCode, {
    type: "gameEnded",
    winner: winner,
    imposters: game.imposters,
    secretWord: game.secretWord,
    reason: reason
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
        
        // WICHTIGER FIX: Bessere Socket-Verwaltung
        if (room.players.includes(playerName)) {
          console.log(`🔄 ${playerName} reconnected to room ${roomCode}`);
          const playerIndex = room.players.indexOf(playerName);
          
          // Alte Socket-Referenz entfernen falls vorhanden
          if (room.sockets[playerIndex]) {
            console.log(`🗑️ Entferne alte Socket-Referenz für ${playerName}`);
          }
          
          // Neue Socket setzen
          room.sockets[playerIndex] = ws;
          playerSockets[socketKey] = ws;
          
        } else {
          console.log(`➕ ${playerName} neu in Raum ${roomCode}`);
          room.players.push(playerName);
          room.sockets.push(ws);
          playerSockets[socketKey] = ws;
        }
        
        // WebSocket-Metadaten setzen
        ws.playerInfo = { roomCode, name: playerName };
        ws.socketKey = socketKey;

        // WICHTIG: Sofort bestätigen und Liste broadcasten
        ws.send(JSON.stringify({ 
          type: "roomInfo", 
          roomCode,
          gameSettings: room.gameSettings
        }));
        
        // SOFORT die Spielerliste an alle senden
        setTimeout(() => {
          broadcastToRoom(roomCode, {
            type: "playerList",
            players: room.players
          });
        }, 100); // Sehr kleine Verzögerung um sicherzustellen dass Socket bereit ist
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
          roundTimeLimit: Math.max(60, Math.min(settings.roundTimeLimit || 300, 1800)),
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
          
          // Sofort Socket registrieren
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
                role: isImposter ? "imposter" : "crewmate",
                word: isImposter ? null : currentGame.secretWord
              };
              
              if (isImposter && currentGame.settings.imposterHint && WORD_HINTS[currentGame.secretWord]) {
                roleData.hint = WORD_HINTS[currentGame.secretWord];
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

      // KRITISCHER FIX: submitWord Handler - Broadcasting Problem lösen
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
        
        // WICHTIG: Erst ins Game-Array speichern
        game.wordsSpoken.push({ player: playerName, word: trimmedWord });
        
        console.log(`💬 ${playerName} hat gesagt: "${trimmedWord}" - Broadcasting an alle...`);

        // SOFORT Broadcasting - DAS IST DER WICHTIGSTE FIX!
        const wordMessage = {
          type: "wordSubmitted",
          player: playerName,
          word: trimmedWord
        };
        
        // Debug: Aktuelle Socket-Situation prüfen
        const room = rooms[roomCode];
        console.log(`🔍 Debug vor Broadcasting:`);
        console.log(`   Raum ${roomCode} hat ${room.players.length} Spieler: ${room.players.join(", ")}`);
        
        room.players.forEach((player, index) => {
          const socketKey = getSocketKey(roomCode, player);
          const socket = playerSockets[socketKey];
          const status = socket && socket.readyState === WebSocket.OPEN ? '✅ BEREIT' : '❌ NICHT BEREIT';
          console.log(`   ${player}: ${status}`);
        });

        // Broadcasting mit detailliertem Logging
        const successCount = broadcastToGame(roomCode, wordMessage);
        
        console.log(`📊 Broadcasting Ergebnis: ${successCount}/${room.players.length} erfolgreich`);
        
        // ZUSÄTZLICHER FIX: Falls Broadcasting fehlschlägt, sofort nochmal versuchen
        if (successCount < room.players.length) {
          console.log(`⚠️ Nicht alle Spieler haben das Wort erhalten - versuche erneut in 500ms`);
          setTimeout(() => {
            console.log(`🔄 Retry Broadcasting für "${trimmedWord}" von ${playerName}`);
            broadcastToGame(roomCode, wordMessage);
          }, 500);
        }

        // DANN den nächsten Spieler nach einer kleinen Verzögerung
        setTimeout(() => {
          if (games[roomCode]) {
            console.log(`⏭️ Wechsel zum nächsten Spieler in Raum ${roomCode}`);
            nextPlayer(roomCode);
          }
        }, 1000); // Verkürzt von 1500ms auf 1000ms
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

      else if (data.type === "playAgain") {
        const { roomCode } = data;
        if (rooms[roomCode] && rooms[roomCode].players.length >= 3) {
          startGame(roomCode);
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

  // ZUSÄTZLICHER FIX: Socket cleanup bei Disconnect verbessern
  ws.on("close", (code, reason) => {
    console.log(`🔴 Verbindung getrennt (Code: ${code}, Grund: ${reason})`);
    
    if (ws.socketKey) {
      console.log(`🧹 Cleanup für Socket: ${ws.socketKey}`);
      delete playerSockets[ws.socketKey];
    }
    
    if (ws.playerInfo) {
      const { roomCode, name } = ws.playerInfo;
      console.log(`👋 ${name} hat Raum ${roomCode} verlassen`);
      
      // Verzögerter Cleanup um Reconnections zu ermöglichen
      setTimeout(() => {
        const socketKey = getSocketKey(roomCode, name);
        if (!playerSockets[socketKey]) {
          console.log(`⏰ ${name} hat sich nicht wieder verbunden - entferne aus Raum`);
          removePlayerFromRoom(roomCode, name);
        }
      }, 10000); // 10 Sekunden Reconnection-Zeit
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
    if (games[roomCode]) { // Nur für aktive Spiele
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