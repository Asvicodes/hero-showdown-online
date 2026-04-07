const ATTRIBUTES = [
  { key: "totalMovies", label: "Total Movies" },
  { key: "hits", label: "Hits" },
  { key: "flops", label: "Flops" },
  { key: "heightCm", label: "Height (cm)" },
  { key: "imdbStarmeter", label: "IMDb Starmeter" },
];

const storageKey = "hero-showdown-session";

const elements = {
  lobbyPage: document.getElementById("lobbyPage"),
  gamePage: document.getElementById("gamePage"),
  playerName: document.getElementById("playerName"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  startMatchBtn: document.getElementById("startMatchBtn"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  backToLobbyBtn: document.getElementById("backToLobbyBtn"),
  nextRoundBtn: document.getElementById("nextRoundBtn"),
  connectionHint: document.getElementById("connectionHint"),
  statusMessage: document.getElementById("statusMessage"),
  roomDisplay: document.getElementById("roomDisplay"),
  turnLabel: document.getElementById("turnLabel"),
  selfName: document.getElementById("selfName"),
  selfDeckCount: document.getElementById("selfDeckCount"),
  selfCard: document.getElementById("selfCard"),
  opponentName: document.getElementById("opponentName"),
  opponentDeckCount: document.getElementById("opponentDeckCount"),
  roundOverlay: document.getElementById("roundOverlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayMessage: document.getElementById("overlayMessage"),
  overlayCelebration: document.getElementById("overlayCelebration"),
  overlayCards: document.getElementById("overlayCards"),
};

const session = {
  roomCode: "",
  token: "",
  pollId: null,
  state: null,
  selectedAttributeKey: "",
  lastResolvedRoundKey: "",
  revealActive: false,
  pendingNext: false,
  renderedOverlayRoundKey: "",
  nextRoundClicked: false,
};

let audioContext = null;
let audioUnlocked = false;

initialize();

function initialize() {
  attachEvents();
  restoreSession();
  updateConnectionHint();
  renderDisconnectedView();
  startPolling();
}

function attachEvents() {
  elements.createRoomBtn.addEventListener("click", createRoom);
  elements.joinRoomBtn.addEventListener("click", joinRoom);
  elements.startMatchBtn.addEventListener("click", startMatch);
  elements.leaveRoomBtn.addEventListener("click", leaveRoom);
  elements.backToLobbyBtn.addEventListener("click", returnToLobby);
  elements.nextRoundBtn.addEventListener("click", goToNextRound);
  window.addEventListener("pointerdown", unlockAudio, { passive: true });
}

function updateConnectionHint() {
  elements.connectionHint.textContent = `Open this app on both devices using ${window.location.origin}.`;
}

function getPlayerName() {
  return elements.playerName.value.trim() || "Player";
}

async function createRoom() {
  unlockAudio();
  const response = await postJson("/api/rooms/create", { playerName: getPlayerName() });
  if (!response.ok) {
    setStatus(response.error || "Could not create room.");
    return;
  }

  setSession(response.roomCode, response.token);
  elements.roomCodeInput.value = response.roomCode;
  setStatus(`Room ${response.roomCode} created. Share this code with the other player.`);
  await refreshState(true);
}

async function joinRoom() {
  unlockAudio();
  const roomCode = elements.roomCodeInput.value.trim().toUpperCase();
  if (!roomCode) {
    setStatus("Enter a room code first.");
    return;
  }

  const response = await postJson("/api/rooms/join", {
    roomCode,
    playerName: getPlayerName(),
  });

  if (!response.ok) {
    setStatus(response.error || "Could not join room.");
    return;
  }

  setSession(response.roomCode, response.token);
  setStatus(`Joined room ${response.roomCode}. Waiting for the host to start.`);
  await refreshState(true);
}

async function startMatch() {
  unlockAudio();
  if (!session.token) {
    setStatus("Create or join a room first.");
    return;
  }

  const response = await postJson("/api/rooms/start", {
    roomCode: session.roomCode,
    token: session.token,
  });

  if (!response.ok) {
    setStatus(response.error || "Could not start the match.");
    return;
  }

  await refreshState(true);
}

async function selectAttribute(attributeKey) {
  unlockAudio();
  if (!session.token || !session.state || session.pendingNext) {
    return;
  }

  session.selectedAttributeKey = attributeKey;
  renderOwnCard(getDisplayedSelfCard());

  const response = await postJson("/api/rooms/select-attribute", {
    roomCode: session.roomCode,
    token: session.token,
    attributeKey,
  });

  if (!response.ok) {
    session.selectedAttributeKey = "";
    renderOwnCard(getDisplayedSelfCard());
    setStatus(response.error || "Could not play that round.");
    return;
  }

  await refreshState(true);
}

async function goToNextRound() {
  unlockAudio();
  if (session.state?.status === "finished") {
    session.revealActive = false;
    session.pendingNext = false;
    session.selectedAttributeKey = "";
    session.renderedOverlayRoundKey = "";
    renderState(session.state);
    return;
  }

  if (!session.token || !session.state?.lastRound) {
    return;
  }

  session.nextRoundClicked = true;
  updateLobbyControls(session.state);

  const response = await postJson("/api/rooms/next-round", {
    roomCode: session.roomCode,
    token: session.token,
  });

  if (!response.ok) {
    session.nextRoundClicked = false;
    updateLobbyControls(session.state);
    setStatus(response.error || "Could not continue to the next round.");
    return;
  }

  await refreshState(true);
}

function leaveRoom() {
  clearSession();
  renderDisconnectedView();
  setStatus("You left the room.");
}

function returnToLobby() {
  clearSession();
  renderDisconnectedView();
  setStatus("Back in the lobby. Create or join a room for a new game.");
}

function showLobbyPage() {
  const shouldStayInGame = Boolean(session.state && (session.state.status === "active" || session.pendingNext));
  elements.lobbyPage.classList.toggle("page-active", !shouldStayInGame);
  elements.gamePage.classList.toggle("page-active", shouldStayInGame);
}

function setSession(roomCode, token) {
  session.roomCode = roomCode;
  session.token = token;
  localStorage.setItem(storageKey, JSON.stringify({ roomCode, token }));
}

function clearSession() {
  session.roomCode = "";
  session.token = "";
  session.state = null;
  session.selectedAttributeKey = "";
  session.lastResolvedRoundKey = "";
  session.revealActive = false;
  session.pendingNext = false;
  session.renderedOverlayRoundKey = "";
  session.nextRoundClicked = false;
  elements.roomCodeInput.value = "";
  localStorage.removeItem(storageKey);
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!saved?.roomCode || !saved?.token) {
      return;
    }

    session.roomCode = saved.roomCode;
    session.token = saved.token;
    elements.roomCodeInput.value = saved.roomCode;
  } catch (error) {
    clearSession();
  }
}

function startPolling() {
  if (session.pollId) {
    clearInterval(session.pollId);
  }

  session.pollId = window.setInterval(refreshState, 1500);
  refreshState(false);
}

async function refreshState(isUserInitiated = false) {
  if (!session.roomCode || !session.token) {
    return;
  }

  try {
    const response = await fetch(
      `/api/rooms/state?roomCode=${encodeURIComponent(session.roomCode)}&token=${encodeURIComponent(session.token)}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      clearSession();
      renderDisconnectedView();
      setStatus("Session expired. Create or join a room again.");
      return;
    }

    const state = await response.json();
    session.state = state;
    renderState(state);
  } catch (error) {
    if (isUserInitiated) {
      setStatus("The room was created, but the app could not refresh the latest game state. Please try once more.");
    } else {
      setStatus("Trying to reconnect to the game server...");
    }
  }
}

function renderState(state) {
  if (!state) {
    renderDisconnectedView();
    return;
  }

  handleRoundTransition(state);
  showRelevantPage(state);

  elements.roomDisplay.textContent = state.roomCode;
  elements.selfName.textContent = state.self.name;
  elements.selfDeckCount.textContent = `${state.self.deckCount} cards`;
  elements.opponentName.textContent = state.opponent.name || "Waiting...";
  elements.opponentDeckCount.textContent = `${state.opponent.deckCount} cards`;
  elements.turnLabel.textContent = getTurnMessage(state);

  renderOwnCard(getDisplayedSelfCard());
  renderRoundOverlay(state.lastRound);
  updateLobbyControls(state);

  if (state.status === "waiting") {
    setStatus("Room ready. Ask the second player to join with the room code.");
  } else if (state.status === "active") {
    if (session.pendingNext) {
      setStatus(state.selfReadyNext ? "Waiting for the other player to tap next round." : "Round complete. Tap next round.");
    } else {
      setStatus(state.isYourTurn ? "Your turn. Tap a stat on your card." : "Opponent is choosing a stat.");
    }
  } else if (state.status === "finished") {
    setStatus(state.winnerName === state.self.name ? "You won the match." : `${state.winnerName} won the match.`);
  }
}

function renderDisconnectedView() {
  elements.lobbyPage.classList.add("page-active");
  elements.gamePage.classList.remove("page-active");
  elements.roomDisplay.textContent = "Not connected";
  elements.turnLabel.textContent = "Waiting for players";
  elements.selfName.textContent = "Player";
  elements.selfDeckCount.textContent = "0 cards";
  elements.opponentName.textContent = "Waiting...";
  elements.opponentDeckCount.textContent = "0 cards";
  elements.selfCard.className = "player-card empty-card";
  elements.selfCard.innerHTML = "<p>Your active card will appear here.</p>";
  elements.roundOverlay.classList.remove("overlay-active");
  elements.roundOverlay.classList.remove("overlay-finale");
  elements.overlayCelebration.innerHTML = "";
  elements.overlayCelebration.setAttribute("aria-hidden", "true");
  session.renderedOverlayRoundKey = "";
  session.nextRoundClicked = false;
  updateLobbyControls(null);
}

function showRelevantPage(state) {
  const showGame = state.status === "active" || state.status === "finished" || session.pendingNext;
  elements.lobbyPage.classList.toggle("page-active", !showGame);
  elements.gamePage.classList.toggle("page-active", showGame);
}

function renderOwnCard(card) {
  if (!card) {
    elements.selfCard.className = "player-card empty-card";
    elements.selfCard.innerHTML = "<p>No cards left.</p>";
    return;
  }

  const canPick = Boolean(session.state && session.state.status === "active" && session.state.isYourTurn && !session.pendingNext);
  elements.selfCard.className = "player-card card-live";
  elements.selfCard.innerHTML = `
    ${card.image ? `<img class="card-image" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" />` : `<div class="card-image card-image-fallback">Photo not found</div>`}
    <div class="card-content">
      <div class="card-headline">
        <div>
          <p class="label">Your Current Card</p>
          <h2>${escapeHtml(card.name)}</h2>
          <p class="subtle">${escapeHtml(card.role)}</p>
        </div>
        <div class="card-badge">Top Card</div>
      </div>
      <div class="inline-attributes">
        ${ATTRIBUTES.map((attribute) => buildAttributeButton(card, attribute, canPick)).join("")}
      </div>
    </div>
  `;

  elements.selfCard.querySelectorAll("[data-attribute]").forEach((button) => {
    button.addEventListener("click", () => selectAttribute(button.dataset.attribute));
  });
}

function buildAttributeButton(card, attribute, canPick) {
  const isSelected = session.selectedAttributeKey === attribute.key;
  const value = formatStat(card[attribute.key]);
  return `
    <button
      type="button"
      class="attribute-chip ${isSelected ? "selected-property" : ""}"
      data-attribute="${attribute.key}"
      ${canPick ? "" : "disabled"}
    >
      <span class="attribute-label">${escapeHtml(attribute.label)}</span>
      <span class="attribute-value">${escapeHtml(value)}</span>
    </button>
  `;
}

function renderRoundOverlay(lastRound) {
  if (!lastRound || !session.pendingNext) {
    elements.roundOverlay.classList.remove("overlay-active");
    elements.roundOverlay.classList.remove("overlay-finale");
    elements.roundOverlay.setAttribute("aria-hidden", "true");
    elements.overlayCelebration.innerHTML = "";
    elements.overlayCelebration.setAttribute("aria-hidden", "true");
    session.renderedOverlayRoundKey = "";
    return;
  }

  const roundKey = getRoundKey(lastRound);
  if (session.renderedOverlayRoundKey !== roundKey) {
    elements.overlayTitle.textContent = session.state?.status === "finished"
      ? `${session.state?.winnerName || "Winner"} Wins TFI Banisa`
      : "Round Result";
    elements.overlayMessage.textContent = buildOverlayMessage(lastRound);
    elements.overlayCards.innerHTML = `
      ${buildRevealMarkup(lastRound.selfCard, "Your card", lastRound.attributeKey, getRevealOutcome(lastRound, "self"), true)}
      ${buildRevealMarkup(lastRound.opponentCard, "Opponent card", lastRound.attributeKey, getRevealOutcome(lastRound, "opponent"), true)}
    `;
    session.renderedOverlayRoundKey = roundKey;
  }
  renderOverlayCelebration();
  if (session.state?.status === "finished") {
    elements.nextRoundBtn.textContent = "Close Result";
  } else if (session.state?.selfReadyNext) {
    elements.nextRoundBtn.textContent = session.state?.opponentReadyNext ? "Loading next round..." : "Waiting for opponent...";
  } else {
    elements.nextRoundBtn.textContent = "Next Round";
  }
  elements.roundOverlay.classList.toggle("overlay-finale", session.state?.status === "finished");
  elements.roundOverlay.classList.add("overlay-active");
  elements.roundOverlay.setAttribute("aria-hidden", "false");
}

function renderOverlayCelebration() {
  const winnerName = session.state?.winnerName;
  const isFinale = session.state?.status === "finished" && winnerName;
  if (!isFinale) {
    elements.overlayCelebration.innerHTML = "";
    elements.overlayCelebration.setAttribute("aria-hidden", "true");
    return;
  }

  const selfWon = session.state?.winnerName === session.state?.self?.name;
  elements.overlayCelebration.innerHTML = `
    <div class="winner-marquee ${selfWon ? "winner-marquee-self" : "winner-marquee-opponent"}">
      <div class="winner-lightning winner-lightning-left"></div>
      <div class="winner-lightning winner-lightning-right"></div>
      <div class="winner-crackers winner-crackers-left"></div>
      <div class="winner-crackers winner-crackers-right"></div>
      <p class="label">Grand Finale</p>
      <h2>${escapeHtml(winnerName)}</h2>
      <p class="subtle">${selfWon ? "You conquered the deck." : "Match winner announced."}</p>
    </div>
  `;
  elements.overlayCelebration.setAttribute("aria-hidden", "false");
}

function buildRevealMarkup(card, label, attributeKey, outcome, animateFlip) {
  if (!card) {
    return `<article class="reveal-card"><p>No card data available.</p></article>`;
  }

  const selectedLabel = getAttributeLabel(attributeKey);
  const selectedValue = formatStat(card[attributeKey]);
  const outcomeLabel = outcome === "winner" ? "Winner" : outcome === "loser" ? "Runner Up" : "Tie";
  const comparisonLine = buildComparisonLine(card, attributeKey, outcome);
  const selectedChip = `
    <div class="reveal-property-chip">
      <div>
        <span class="attribute-label">Selected Property</span>
        <strong class="comparison-property-name">${escapeHtml(selectedLabel)}</strong>
      </div>
      <span class="attribute-value">${escapeHtml(selectedValue)}</span>
    </div>
  `;

  return `
    <article class="reveal-card reveal-${escapeHtml(outcome)} reveal-card-flip">
      <div class="reveal-card-inner is-flipped ${animateFlip ? "animate-flip" : ""}">
        <div class="reveal-face reveal-face-front">
          <div class="reveal-card-backdrop">
            <span class="frame-seal">TFI Banisa</span>
          </div>
          <p class="label">Hidden card</p>
          <h4>Reveal</h4>
        </div>
        <div class="reveal-face reveal-face-back">
          <div class="reveal-burst"></div>
          <div class="comparison-frame">
            <div class="frame-topline">
              <p class="label">${escapeHtml(label)}</p>
              <span class="frame-outcome">${escapeHtml(outcomeLabel)}</span>
            </div>
            <div class="frame-photo-shell">
              ${card.image ? `<img class="overlay-photo" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" />` : `<div class="card-image card-image-fallback">Photo not found</div>`}
            </div>
            <div class="frame-copy">
              <h3>${escapeHtml(card.name)}</h3>
              <p class="subtle">${escapeHtml(card.role)}</p>
            </div>
            ${selectedChip}
            <p class="reveal-stat reveal-stat-active">
              <strong>Comparison:</strong> ${escapeHtml(comparisonLine)}
            </p>
          </div>
        </div>
      </div>
    </article>
  `;
}

function handleRoundTransition(state) {
  const roundKey = getRoundKey(state.lastRound);
  if (!roundKey) {
    session.revealActive = false;
    session.pendingNext = false;
    session.selectedAttributeKey = "";
    session.renderedOverlayRoundKey = "";
    session.nextRoundClicked = false;
    return;
  }

  if (roundKey === session.lastResolvedRoundKey) {
    return;
  }

  session.lastResolvedRoundKey = roundKey;
  session.selectedAttributeKey = state.lastRound.attributeKey;
  session.revealActive = true;
  session.pendingNext = true;
  session.nextRoundClicked = false;
  session.renderedOverlayRoundKey = "";
  playRoundSound(state.lastRound);
}

function getDisplayedSelfCard() {
  if (session.pendingNext && session.state?.lastRound?.selfCard) {
    return session.state.lastRound.selfCard;
  }
  return session.state?.self?.card || null;
}

function updateLobbyControls(state) {
  const canCreateOrJoin = !session.token;
  elements.createRoomBtn.disabled = !canCreateOrJoin;
  elements.joinRoomBtn.disabled = !canCreateOrJoin;
  elements.leaveRoomBtn.disabled = !session.token;
  elements.startMatchBtn.disabled = !state || !state.canStart;
  elements.nextRoundBtn.disabled = !session.pendingNext || (Boolean(state?.selfReadyNext) && state?.status !== "finished");
}

function getTurnMessage(state) {
  if (state.status === "waiting") {
    return "Waiting for both players to join";
  }
  if (state.status === "finished") {
    return `${state.winnerName} won the match`;
  }
  if (session.pendingNext) {
    return "Round complete. Reveal both cards and continue.";
  }
  return state.isYourTurn ? "Tap one stat on your card" : `${state.opponent.name} is choosing a stat`;
}

function getAttributeLabel(attributeKey) {
  return ATTRIBUTES.find((attribute) => attribute.key === attributeKey)?.label || attributeKey;
}

function getRoundKey(lastRound) {
  if (!lastRound) {
    return "";
  }
  return [lastRound.attributeKey, lastRound.message, lastRound.selfCard?.name || "", lastRound.opponentCard?.name || ""].join("|");
}

function getRevealOutcome(lastRound, side) {
  if (!lastRound || lastRound.winnerSide === "tie") {
    return "tie";
  }
  return lastRound.winnerSide === side ? "winner" : "loser";
}

function playRoundSound(lastRound) {
  if (!lastRound) {
    return;
  }

  const outcome = getRevealOutcome(lastRound, "self");
  if (session.state?.status === "finished") {
    if (outcome === "winner") {
      playFinalVictorySound();
    } else if (outcome === "loser") {
      playFinalDefeatSound();
    }
    return;
  }

  if (outcome === "winner") {
    playVictorySound();
  } else if (outcome === "loser") {
    playDefeatSound();
  }
}

function playVictorySound() {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  const now = ctx.currentTime;
  playBassHit(ctx, 130.81, now, 0.22, 0.09);
  playTone(ctx, 523.25, now, 0.14, "square", 0.12);
  playTone(ctx, 659.25, now + 0.1, 0.14, "square", 0.13);
  playTone(ctx, 783.99, now + 0.2, 0.18, "triangle", 0.15);
  playTone(ctx, 1046.5, now + 0.34, 0.22, "triangle", 0.16);
  playTone(ctx, 1318.51, now + 0.5, 0.28, "sawtooth", 0.12);
  playNoiseBurst(ctx, now + 0.12, 0.16, 0.08);
  playNoiseBurst(ctx, now + 0.34, 0.18, 0.07);
  playNoiseBurst(ctx, now + 0.58, 0.18, 0.06);
}

function playDefeatSound() {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  const now = ctx.currentTime;
  playTone(ctx, 261.63, now, 0.14, "square", 0.07);
  playTone(ctx, 220.0, now + 0.14, 0.16, "sawtooth", 0.08);
  playTone(ctx, 174.61, now + 0.3, 0.32, "sawtooth", 0.08);
  playBassHit(ctx, 87.31, now + 0.16, 0.36, 0.06);
  playNoiseBurst(ctx, now + 0.22, 0.18, 0.025);
}

function playFinalVictorySound() {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  const now = ctx.currentTime;
  playBassHit(ctx, 130.81, now, 0.26, 0.11);
  playTone(ctx, 523.25, now, 0.18, "square", 0.14);
  playTone(ctx, 659.25, now + 0.12, 0.18, "square", 0.15);
  playTone(ctx, 783.99, now + 0.24, 0.2, "triangle", 0.17);
  playTone(ctx, 1046.5, now + 0.4, 0.24, "triangle", 0.18);
  playTone(ctx, 1318.51, now + 0.56, 0.26, "triangle", 0.16);
  playTone(ctx, 1567.98, now + 0.72, 0.32, "sawtooth", 0.15);
  playTone(ctx, 2093, now + 0.92, 0.36, "sine", 0.12);
  playNoiseBurst(ctx, now + 0.16, 0.18, 0.09);
  playNoiseBurst(ctx, now + 0.46, 0.2, 0.085);
  playNoiseBurst(ctx, now + 0.78, 0.22, 0.08);
  playNoiseBurst(ctx, now + 1.02, 0.24, 0.075);
}

function playFinalDefeatSound() {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  const now = ctx.currentTime;
  playTone(ctx, 220, now, 0.14, "square", 0.075);
  playTone(ctx, 196, now + 0.16, 0.18, "sawtooth", 0.08);
  playTone(ctx, 164.81, now + 0.34, 0.22, "sawtooth", 0.085);
  playTone(ctx, 130.81, now + 0.56, 0.38, "triangle", 0.08);
  playBassHit(ctx, 65.41, now + 0.32, 0.5, 0.075);
}

function getAudioContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  if (!audioContext) {
    audioContext = new Ctor();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function unlockAudio() {
  if (audioUnlocked) {
    return;
  }
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  audioUnlocked = true;
  playTone(ctx, 220, ctx.currentTime, 0.01, "sine", 0.0001);
}

function playTone(ctx, frequency, startAt, duration, type, gainValue) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.03);
}

function playNoiseBurst(ctx, startAt, duration, gainValue) {
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < bufferSize; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / bufferSize);
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  source.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.setValueAtTime(1500, startAt);
  gain.gain.setValueAtTime(gainValue, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(startAt);
  source.stop(startAt + duration);
}

function playBassHit(ctx, frequency, startAt, duration, gainValue) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.72), startAt + duration);
  gain.gain.setValueAtTime(gainValue, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.03);
}


function formatStat(value) {
  return Number.isInteger(value) ? String(value) : Number(value || 0).toFixed(2);
}

function buildComparisonLine(card, attributeKey, outcome) {
  const lastRound = session.state?.lastRound;
  if (!lastRound) {
    return getAttributeLabel(attributeKey);
  }

  const currentValue = formatStat(card?.[attributeKey]);
  const opponentCard = card?.name === lastRound.selfCard?.name ? lastRound.opponentCard : lastRound.selfCard;
  const opponentValue = formatStat(opponentCard?.[attributeKey]);
  const verdict =
    outcome === "winner"
      ? "beats"
      : outcome === "loser"
        ? "falls to"
        : "ties with";

  return `${getAttributeLabel(attributeKey)} ${currentValue} ${verdict} ${opponentValue}`;
}

function buildOverlayMessage(lastRound) {
  const winnerName = session.state?.winnerName;
  if (session.state?.status === "finished" && winnerName) {
    return `${lastRound.message} ${winnerName} wins the match.`;
  }
  return lastRound.message;
}

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

async function postJson(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return { ok: response.ok, ...data };
  } catch (error) {
    return { ok: false, error: "The app could not reach the game server." };
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
