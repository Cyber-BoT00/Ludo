import { supabase } from './supabase';
import { renderLudoBoard2D } from './board2d';
import { applyLocalMove, COLORS, getMovablePawnIndices } from './ludoRules';
import type { BoardState, GameMode, LudoColor, MatchRow, PlayerSlot, ProfileRow } from './types';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app')!;

const INITIAL_BOARD_STATE: BoardState = {
  red: [-1, -1, -1, -1],
  green: [-1, -1, -1, -1],
  yellow: [-1, -1, -1, -1],
  blue: [-1, -1, -1, -1],
};

const DICE_FACES: Record<number, string> = {
  1: '⚀',
  2: '⚁',
  3: '⚂',
  4: '⚃',
  5: '⚄',
  6: '⚅',
};

let currentUserId: string | null = null;
let currentProfile: ProfileRow | null = null;
let currentMatch: MatchRow | null = null;
let localMode: GameMode | null = null;
let selectedColor: LudoColor = 'red';
let playerCountChoice = 2;
let statusBanner = 'Welcome to Ludo King Arena! Pick a mode or create an online room.';
let showHowToPlay = false;
let matchChannel: ReturnType<typeof supabase.channel> | null = null;
let botTimer: number | null = null;

function clearBotTimer() {
  if (botTimer !== null) {
    window.clearTimeout(botTimer);
    botTimer = null;
  }
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getNextTurnIdx(curr: number, total: number): number {
  if (total <= 0) return 0;
  return (curr + 1) % total;
}

async function loadProfile(userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  currentProfile = (data as ProfileRow | null) ?? null;
}

async function subscribeToMatch(matchId: string) {
  if (matchChannel) {
    await supabase.removeChannel(matchChannel);
    matchChannel = null;
  }

  matchChannel = supabase
    .channel(`match:${matchId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
      async (payload) => {
        currentMatch = payload.new as MatchRow;
        if (currentUserId && currentMatch.status === 'finished') {
          await loadProfile(currentUserId);
        }
        render();
      }
    )
    .subscribe();
}

function startLocalMatch(mode: GameMode) {
  clearBotTimer();
  localMode = mode;

  const baseName = currentProfile?.username ?? 'Player 1';
  const orderedColors = [
    selectedColor,
    ...COLORS.filter((c) => c !== selectedColor),
  ].slice(0, playerCountChoice);

  const players: PlayerSlot[] = orderedColors.map((color, idx) => {
    if (idx === 0) {
      return {
        user_id: currentUserId ?? 'local-user',
        username: baseName,
        color,
        ready: true,
        is_bot: false,
      };
    }
    if (mode === 'bot') {
      return {
        user_id: `bot-${color}`,
        username: `Bot ${color.toUpperCase()}`,
        color,
        ready: true,
        is_bot: true,
      };
    }
    return {
      user_id: `local-p${idx + 1}`,
      username: `Player ${idx + 1} (${color.toUpperCase()})`,
      color,
      ready: true,
      is_bot: false,
    };
  });

  currentMatch = {
    id: `local-${Date.now()}`,
    room_code: mode === 'bot' ? 'BOT1V1' : 'PASS2P',
    status: 'active',
    max_players: players.length,
    players,
    board_state: {
      red: [-1, -1, -1, -1],
      green: [-1, -1, -1, -1],
      yellow: [-1, -1, -1, -1],
      blue: [-1, -1, -1, -1],
    },
    current_turn_index: 0,
    last_dice_roll: null,
    can_move: false,
    winner_id: null,
    updated_at: new Date().toISOString(),
  };

  statusBanner = `Match started! ${players[0].username}'s turn to roll the dice.`;
  render();
}

async function createOnlineRoom() {
  if (!currentUserId) return;
  clearBotTimer();
  localMode = 'online';

  if (!currentProfile) {
    await loadProfile(currentUserId);
  }

  const starter: PlayerSlot[] = [
    {
      user_id: currentUserId,
      username: currentProfile?.username ?? 'Player',
      color: selectedColor,
      ready: true,
    },
  ];

  const { data, error } = await supabase
    .from('matches')
    .insert({
      room_code: generateRoomCode(),
      status: 'waiting',
      max_players: playerCountChoice,
      players: starter,
      board_state: INITIAL_BOARD_STATE,
      current_turn_index: 0,
      last_dice_roll: null,
      can_move: false,
    })
    .select()
    .single();

  if (error || !data) {
    alert(error?.message || 'Could not create room');
    return;
  }

  currentMatch = data as MatchRow;
  statusBanner = `Room ${currentMatch.room_code} created! Share code with friends and click Start Match.`;
  await subscribeToMatch(currentMatch.id);
  render();
}

async function joinOnlineRoom(code: string) {
  if (!currentUserId) return;
  clearBotTimer();
  localMode = 'online';

  if (!currentProfile) {
    await loadProfile(currentUserId);
  }

  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode) {
    alert('Please enter a 6-character room code');
    return;
  }

  const { data: match, error } = await supabase
    .from('matches')
    .select('*')
    .eq('room_code', cleanCode)
    .single();

  if (error || !match) {
    alert('Room not found');
    return;
  }

  const m = match as MatchRow;
  const alreadyIn = m.players.some((p) => p.user_id === currentUserId);
  const nextPlayers = [...m.players];

  if (!alreadyIn) {
    if (nextPlayers.length >= m.max_players || m.status !== 'waiting') {
      alert('Room is full or already started');
      return;
    }
    const usedColors = new Set(nextPlayers.map((p) => p.color));
    const freeColor: LudoColor = COLORS.find((c) => !usedColors.has(c)) || 'blue';
    nextPlayers.push({
      user_id: currentUserId,
      username: currentProfile?.username ?? 'Player',
      color: freeColor,
      ready: true,
    });
  }

  const { data: updated, error: updErr } = await supabase
    .from('matches')
    .update({
      players: nextPlayers,
      updated_at: new Date().toISOString(),
    })
    .eq('id', m.id)
    .select()
    .single();

  if (updErr || !updated) {
    alert(updErr?.message || 'Failed to join room');
    return;
  }

  currentMatch = updated as MatchRow;
  statusBanner = `Joined Room ${currentMatch.room_code}!`;
  await subscribeToMatch(currentMatch.id);
  render();
}

async function startOnlineMatch() {
  if (!currentMatch) return;
  if (currentMatch.players.length < 2) {
    alert('Need at least 2 players in the room to start');
    return;
  }

  const { data, error } = await supabase
    .from('matches')
    .update({
      status: 'active',
      board_state: INITIAL_BOARD_STATE,
      current_turn_index: 0,
      last_dice_roll: null,
      can_move: false,
      winner_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', currentMatch.id)
    .select()
    .single();

  if (error) {
    alert(error.message);
    return;
  }

  if (data) {
    currentMatch = data as MatchRow;
    statusBanner = `Live match started! ${currentMatch.players[0].username}'s turn.`;
    render();
  }
}

function executeLocalDiceRoll() {
  if (!currentMatch || currentMatch.status !== 'active' || currentMatch.can_move) return;
  const activePlayer = currentMatch.players[currentMatch.current_turn_index];
  if (!activePlayer) return;

  const roll = Math.floor(Math.random() * 6) + 1;
  const movable = getMovablePawnIndices(
    currentMatch.board_state[activePlayer.color],
    roll,
    true
  );

  if (movable.length > 0) {
    currentMatch = {
      ...currentMatch,
      last_dice_roll: roll,
      can_move: true,
      updated_at: new Date().toISOString(),
    };
    statusBanner = `${activePlayer.username} rolled ${roll}! Pick a glowing pawn.`;
  } else {
    const nextIdx = getNextTurnIdx(
      currentMatch.current_turn_index,
      currentMatch.players.length
    );
    currentMatch = {
      ...currentMatch,
      last_dice_roll: roll,
      can_move: false,
      current_turn_index: nextIdx,
      updated_at: new Date().toISOString(),
    };
    statusBanner = `${activePlayer.username} rolled ${roll} (no valid move). Turn passed to ${currentMatch.players[nextIdx].username}.`;
  }

  render();
}

function executeLocalPawnMove(pawnIndex: number) {
  if (!currentMatch || currentMatch.status !== 'active' || !currentMatch.can_move) return;
  const activePlayer = currentMatch.players[currentMatch.current_turn_index];
  const roll = currentMatch.last_dice_roll;
  if (!activePlayer || roll === null) return;

  const movable = getMovablePawnIndices(
    currentMatch.board_state[activePlayer.color],
    roll,
    true
  );
  if (!movable.includes(pawnIndex)) return;

  const activeColors = currentMatch.players.map((p) => p.color);
  const res = applyLocalMove(
    currentMatch.board_state,
    activeColors,
    activePlayer.color,
    pawnIndex,
    roll
  );

  if (res.won) {
    currentMatch = {
      ...currentMatch,
      board_state: res.nextBoard,
      can_move: false,
      status: 'finished',
      winner_id: activePlayer.user_id,
      updated_at: new Date().toISOString(),
    };
    statusBanner = `🏆 ${activePlayer.username} brought all 4 pawns home and won!`;
    render();
    return;
  }

  const nextIdx = res.bonusTurn
    ? currentMatch.current_turn_index
    : getNextTurnIdx(currentMatch.current_turn_index, currentMatch.players.length);

  currentMatch = {
    ...currentMatch,
    board_state: res.nextBoard,
    can_move: false,
    current_turn_index: nextIdx,
    updated_at: new Date().toISOString(),
  };

  if (res.captured) {
    statusBanner = `💥 Capture! ${activePlayer.username} sent an opponent home & earned a bonus roll!`;
  } else if (roll === 6) {
    statusBanner = `🎲 Rolled a 6! ${activePlayer.username} gets a bonus roll!`;
  } else {
    statusBanner = `${currentMatch.players[nextIdx].username}'s turn to roll.`;
  }

  render();
}

function scheduleBotTurnIfNeeded() {
  clearBotTimer();
  if (!currentMatch || currentMatch.status !== 'active' || localMode !== 'bot') return;
  const activePlayer = currentMatch.players[currentMatch.current_turn_index];
  if (!activePlayer || !activePlayer.is_bot) return;

  botTimer = window.setTimeout(() => {
    if (!currentMatch || currentMatch.status !== 'active') return;
    if (!currentMatch.can_move) {
      executeLocalDiceRoll();
    } else {
      const movable = getMovablePawnIndices(
        currentMatch.board_state[activePlayer.color],
        currentMatch.last_dice_roll,
        true
      );
      if (movable.length > 0) {
        // Prefer capturing or advancing furthest pawn
        const chosen = movable[movable.length - 1];
        executeLocalPawnMove(chosen);
      }
    }
  }, 750);
}

async function handleRollDice() {
  if (!currentMatch) return;

  if (localMode !== 'online') {
    executeLocalDiceRoll();
    return;
  }

  const { data, error } = await supabase.rpc('roll_dice', { p_match_id: currentMatch.id });
  if (error) {
    alert(error.message);
    return;
  }
  if (data) {
    currentMatch = data as MatchRow;
    const active = currentMatch.players[currentMatch.current_turn_index];
    statusBanner = `${active?.username ?? 'Player'} rolled ${currentMatch.last_dice_roll ?? ''}!`;
    render();
  }
}

async function handlePawnClick(color: LudoColor, pawnIndex: number) {
  if (!currentMatch || currentMatch.status !== 'active') return;
  const activeSlot = currentMatch.players[currentMatch.current_turn_index];
  if (!activeSlot || activeSlot.color !== color) return;

  if (localMode !== 'online') {
    if (activeSlot.is_bot) return;
    executeLocalPawnMove(pawnIndex);
    return;
  }

  if (activeSlot.user_id !== currentUserId) return;

  const { data, error } = await supabase.rpc('move_pawn', {
    p_match_id: currentMatch.id,
    p_pawn_index: pawnIndex,
  });

  if (error) {
    alert(error.message);
    return;
  }

  if (data) {
    currentMatch = data as MatchRow;
    if (currentUserId) {
      await loadProfile(currentUserId);
    }
    render();
  }
}

async function leaveToHome() {
  clearBotTimer();
  if (matchChannel) {
    await supabase.removeChannel(matchChannel);
    matchChannel = null;
  }
  currentMatch = null;
  localMode = null;
  statusBanner = 'Back in Ludo King Lobby!';
  if (currentUserId) {
    await loadProfile(currentUserId);
  }
  render();
}

function render() {
  clearBotTimer();

  // 1. Auth Screen
  if (!currentUserId) {
    app.innerHTML = `
      <div class="king-shell">
        <div class="auth-panel colorful-card">
          <div class="crown-pill">👑 LUDO KING ARENA</div>
          <h1 class="game-title">Ludo King 2D</h1>
          <p class="subtitle">Sign in to save your profile, coins, wins, and online rooms.</p>
          <input id="email" type="email" placeholder="Email address" />
          <input id="password" type="password" placeholder="Password (6+ characters)" />
          <input id="username" type="text" placeholder="Username (for new account)" />
          <div class="btn-row">
            <button id="login-btn" class="btn-primary">Sign In</button>
            <button id="signup-btn" class="btn-emerald">Create Account</button>
          </div>
          <button id="guest-pass-btn" class="btn-gold">Play Offline Pass & Play (No Login)</button>
        </div>
      </div>
    `;

    document.getElementById('login-btn')!.onclick = async () => {
      const email = (document.getElementById('email') as HTMLInputElement).value.trim();
      const password = (document.getElementById('password') as HTMLInputElement).value;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    };

    document.getElementById('signup-btn')!.onclick = async () => {
      const email = (document.getElementById('email') as HTMLInputElement).value.trim();
      const password = (document.getElementById('password') as HTMLInputElement).value;
      const username = (document.getElementById('username') as HTMLInputElement).value.trim();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (error) alert(error.message);
      else alert('Account created! Check email confirmation if enabled, or sign in.');
    };

    document.getElementById('guest-pass-btn')!.onclick = () => {
      startLocalMatch('pass_and_play');
    };
    return;
  }

  // 2. Colorful Ludo King Home Lobby
  if (!currentMatch) {
    app.innerHTML = `
      <div class="king-shell">
        <header class="king-topbar colorful-card">
          <div class="user-strip">
            <div class="avatar-crown">👑</div>
            <div>
              <div class="user-name">${currentProfile?.username ?? 'Player'}</div>
              <div class="stats-row">
                <span class="pill pill-gold">🪙 ${currentProfile?.coins ?? 500} Coins</span>
                <span class="pill pill-green">🏆 ${currentProfile?.wins ?? 0} Wins</span>
                <span class="pill pill-purple">📊 ${currentProfile?.losses ?? 0} Losses</span>
              </div>
            </div>
          </div>
          <div class="btn-row">
            <button id="rules-toggle-btn" class="btn-cyan">${showHowToPlay ? 'Hide Rules' : 'How to Play'}</button>
            <button id="logout-btn" class="btn-ghost">Sign Out</button>
          </div>
        </header>

        ${
          showHowToPlay
            ? `
          <div class="rules-box colorful-card">
            <h3>🎲 Quick Ludo Rules</h3>
            <ul>
              <li>Roll a <strong>6</strong> to bring a pawn out of your colored yard onto the start star.</li>
              <li>Rolling a <strong>6</strong> or <strong>capturing</strong> an opponent pawn on a non-star tile grants a <strong>bonus roll</strong>!</li>
              <li>Tiles with <strong>★</strong> are safe zones—pawns on stars cannot be captured.</li>
              <li>First player to bring all <strong>4 pawns</strong> to <strong>HOME</strong> wins the match!</li>
            </ul>
          </div>
        `
            : ''
        }

        <section class="hero-banner colorful-card">
          <div class="hero-badge">✨ COLORFUL 2D EDITION</div>
          <h1 class="game-title">LUDO KING</h1>
          <p class="subtitle">Choose your color & player count, then jump into Online Rooms, Vs Bot, or Pass & Play.</p>

          <div class="setup-grid">
            <div class="setup-box">
              <label>Your Pawn Color</label>
              <div class="color-picker">
                ${COLORS.map(
                  (col) => `
                  <button
                    type="button"
                    class="color-swatch swatch-${col} ${selectedColor === col ? 'selected' : ''}"
                    data-col="${col}"
                    title="${col.toUpperCase()}"
                  >${col[0].toUpperCase()}</button>
                `
                ).join('')}
              </div>
            </div>

            <div class="setup-box">
              <label>Players in Match</label>
              <div class="count-picker">
                ${[2, 3, 4]
                  .map(
                    (cnt) => `
                  <button
                    type="button"
                    class="count-btn ${playerCountChoice === cnt ? 'selected' : ''}"
                    data-cnt="${cnt}"
                  >${cnt}P</button>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>
        </section>

        <section class="mode-cards-grid">
          <div class="mode-card mode-online colorful-card">
            <div class="mode-icon">🌐</div>
            <h3>Online Room</h3>
            <p>Create a 6-letter code or join a friend's room with live Supabase sync.</p>
            <button id="create-online-btn" class="btn-primary full-w">Create Online Room</button>
            <div class="join-row">
              <input id="room-code-input" type="text" placeholder="CODE (e.g. K7M2P9)" maxlength="6" />
              <button id="join-online-btn" class="btn-emerald">Join</button>
            </div>
          </div>

          <div class="mode-card mode-bot colorful-card">
            <div class="mode-icon">🤖</div>
            <h3>Play vs Bot</h3>
            <p>Instant solo match against smart computer opponents—great for quick games.</p>
            <button id="play-bot-btn" class="btn-gold full-w">Start Vs Bot</button>
          </div>

          <div class="mode-card mode-pass colorful-card">
            <div class="mode-icon">👥</div>
            <h3>Pass & Play</h3>
            <p>Play locally on one screen with friends taking turns around the board.</p>
            <button id="play-pass-btn" class="btn-pink full-w">Start Pass & Play</button>
          </div>
        </section>
      </div>
    `;

    document.getElementById('logout-btn')!.onclick = async () => {
      await supabase.auth.signOut();
    };

    document.getElementById('rules-toggle-btn')!.onclick = () => {
      showHowToPlay = !showHowToPlay;
      render();
    };

    document.querySelectorAll<HTMLButtonElement>('.color-swatch').forEach((btn) => {
      btn.onclick = () => {
        selectedColor = btn.dataset.col as LudoColor;
        render();
      };
    });

    document.querySelectorAll<HTMLButtonElement>('.count-btn').forEach((btn) => {
      btn.onclick = () => {
        playerCountChoice = Number(btn.dataset.cnt);
        render();
      };
    });

    document.getElementById('create-online-btn')!.onclick = createOnlineRoom;
    document.getElementById('join-online-btn')!.onclick = () => {
      const code = (document.getElementById('room-code-input') as HTMLInputElement).value;
      joinOnlineRoom(code);
    };
    document.getElementById('play-bot-btn')!.onclick = () => startLocalMatch('bot');
    document.getElementById('play-pass-btn')!.onclick = () => startLocalMatch('pass_and_play');
    return;
  }

  // 3. Active Match Screen (2D Board + Dice + Turn Controls)
  const activePlayer = currentMatch.players[currentMatch.current_turn_index];
  const isMyTurn =
    localMode !== 'online'
      ? Boolean(activePlayer && !activePlayer.is_bot)
      : Boolean(activePlayer && activePlayer.user_id === currentUserId);
  const isHost = currentMatch.players[0]?.user_id === currentUserId;
  const diceSymbol = currentMatch.last_dice_roll
    ? DICE_FACES[currentMatch.last_dice_roll] ?? currentMatch.last_dice_roll
    : '🎲';

  const winnerObj = currentMatch.winner_id
    ? currentMatch.players.find((p) => p.user_id === currentMatch!.winner_id)
    : null;

  app.innerHTML = `
    <div class="king-shell">
      <header class="match-topbar colorful-card">
        <div class="match-meta">
          <span class="room-tag">ROOM: ${currentMatch.room_code}</span>
          <span class="pill pill-cyan">${currentMatch.status.toUpperCase()}</span>
          <span class="pill pill-gold">Players: ${currentMatch.players.length}/${currentMatch.max_players}</span>
        </div>
        <div class="btn-row">
          ${
            currentMatch.status === 'waiting' && isHost
              ? `<button id="start-match-btn" class="btn-emerald">Start Match (${currentMatch.players.length}/${currentMatch.max_players})</button>`
              : ''
          }
          <button id="leave-room-btn" class="btn-ghost">Lobby</button>
        </div>
      </header>

      <div class="status-ribbon">${statusBanner}</div>

      <div class="players-strip">
        ${currentMatch.players
          .map((p, idx) => {
            const isTurn =
              idx === currentMatch!.current_turn_index && currentMatch!.status === 'active';
            const homeCount = currentMatch!.board_state[p.color].filter((x) => x === 56).length;
            return `
              <div class="player-chip chip-${p.color} ${isTurn ? 'is-turn' : ''}">
                <span class="chip-dot"></span>
                <div class="chip-info">
                  <strong>${p.username}</strong>
                  <small>${p.color.toUpperCase()} • Home ${homeCount}/4</small>
                </div>
                ${isTurn ? `<span class="turn-badge">TURN</span>` : ''}
              </div>
            `;
          })
          .join('')}
      </div>

      ${
        currentMatch.status === 'finished'
          ? `
          <div class="victory-banner">
            🏆 Match Complete! Winner: <strong>${winnerObj?.username ?? currentMatch.winner_id}</strong>
            <button id="play-again-btn" class="btn-gold">Play Again</button>
          </div>
        `
          : ''
      }

      <div class="arena-layout">
        <div id="board-2d-container" class="board-stage colorful-card"></div>

        <aside class="dice-console colorful-card">
          <h3>Dice Console</h3>
          <div class="dice-face-box ${isMyTurn && !currentMatch.can_move && currentMatch.status === 'active' ? 'ready-pulse' : ''}">
            <span class="dice-glyph">${diceSymbol}</span>
            <span class="dice-num">${currentMatch.last_dice_roll ? `Rolled: ${currentMatch.last_dice_roll}` : 'Ready'}</span>
          </div>

          ${
            currentMatch.status === 'active'
              ? `
              <button
                id="roll-dice-btn"
                class="btn-primary full-w roll-big-btn"
                ${!isMyTurn || currentMatch.can_move ? 'disabled' : ''}
              >
                ${
                  isMyTurn
                    ? currentMatch.can_move
                      ? 'Select Glowing Pawn'
                      : '🎲 Roll Dice'
                    : activePlayer?.is_bot
                      ? '🤖 Bot Thinking...'
                      : `Waiting for ${activePlayer?.username ?? 'Player'}`
                }
              </button>
            `
              : `<p class="muted-note">Waiting for host to start the match...</p>`
          }

          <div class="legend-box">
            <div class="legend-item"><span>★</span> Safe Star (No Capture)</div>
            <div class="legend-item"><span>✨</span> Glowing Pawn = Valid Move</div>
            <div class="legend-item"><span>6️⃣</span> Roll 6 or Capture = Extra Turn</div>
          </div>
        </aside>
      </div>
    </div>
  `;

  document.getElementById('leave-room-btn')!.onclick = leaveToHome;
  document.getElementById('start-match-btn')?.addEventListener('click', startOnlineMatch);
  document.getElementById('roll-dice-btn')?.addEventListener('click', handleRollDice);
  document.getElementById('play-again-btn')?.addEventListener('click', () => {
    if (localMode && localMode !== 'online') {
      startLocalMatch(localMode);
    } else {
      leaveToHome();
    }
  });

  const boardContainer = document.getElementById('board-2d-container')!;
  renderLudoBoard2D(
    boardContainer,
    currentMatch.board_state,
    activePlayer?.color ?? null,
    isMyTurn,
    currentMatch.last_dice_roll,
    currentMatch.can_move,
    handlePawnClick
  );

  scheduleBotTurnIfNeeded();
}

async function init() {
  const { data } = await supabase.auth.getSession();
  currentUserId = data.session?.user.id ?? null;
  if (currentUserId) {
    await loadProfile(currentUserId);
  }
  render();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentUserId = session?.user.id ?? null;
    if (currentUserId) {
      await loadProfile(currentUserId);
    } else {
      currentProfile = null;
      if (localMode === 'online') {
        currentMatch = null;
        localMode = null;
      }
    }
    render();
  });
}

init();
