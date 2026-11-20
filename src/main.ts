import { supabase } from './supabase';
import { LudoBoard3D } from './board3d';
import { COLORS } from './ludoRules';
import type { BoardState, LudoColor, MatchRow, PlayerSlot, ProfileRow } from './types';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app')!;

const INITIAL_BOARD_STATE: BoardState = {
  red: [-1, -1, -1, -1],
  green: [-1, -1, -1, -1],
  yellow: [-1, -1, -1, -1],
  blue: [-1, -1, -1, -1],
};

let currentUserId: string | null = null;
let currentProfile: ProfileRow | null = null;
let currentMatch: MatchRow | null = null;
let board3d: LudoBoard3D | null = null;
let matchChannel: ReturnType<typeof supabase.channel> | null = null;
let lastBoardContainer: HTMLElement | null = null;

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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

async function createRoom() {
  if (!currentUserId) return;

  if (!currentProfile) {
    await loadProfile(currentUserId);
  }

  const starter: PlayerSlot[] = [
    {
      user_id: currentUserId,
      username: currentProfile?.username ?? 'Player',
      color: 'red',
      ready: true,
    },
  ];

  const { data, error } = await supabase
    .from('matches')
    .insert({
      room_code: generateRoomCode(),
      status: 'waiting',
      max_players: 4,
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
  await subscribeToMatch(currentMatch.id);
  render();
}

async function joinRoom(code: string) {
  if (!currentUserId) return;

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
  await subscribeToMatch(currentMatch.id);
  render();
}

async function startMatch() {
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
    render();
  }
}

async function handleRollDice() {
  if (!currentMatch) return;
  const { data, error } = await supabase.rpc('roll_dice', { p_match_id: currentMatch.id });
  if (error) {
    alert(error.message);
    return;
  }
  if (data) {
    currentMatch = data as MatchRow;
    render();
  }
}

async function handlePawnClick(color: LudoColor, pawnIndex: number) {
  if (!currentMatch || currentMatch.status !== 'active') return;
  const activeSlot = currentMatch.players[currentMatch.current_turn_index];
  if (!activeSlot || activeSlot.user_id !== currentUserId || activeSlot.color !== color) return;

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

function destroyBoard() {
  if (board3d) {
    board3d.dispose();
    board3d = null;
  }
  lastBoardContainer = null;
}

function render() {
  if (!currentUserId) {
    destroyBoard();
    app.innerHTML = `
      <div class="card auth-card">
        <h1>Online 3D Ludo</h1>
        <p class="muted">Sign in to save your account session, coins, and match history.</p>
        <input id="email" type="email" placeholder="Email" />
        <input id="password" type="password" placeholder="Password (6+ chars)" />
        <input id="username" type="text" placeholder="Username (for new accounts)" />
        <div class="row">
          <button id="login-btn">Sign In</button>
          <button id="signup-btn" class="secondary">Create Account</button>
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
    return;
  }

  if (!currentMatch) {
    destroyBoard();
    app.innerHTML = `
      <div class="topbar">
        <div>
          <strong>${currentProfile?.username ?? 'Player'}</strong>
          <span class="badge">Coins: ${currentProfile?.coins ?? 500}</span>
          <span class="badge">W/L: ${currentProfile?.wins ?? 0}/${currentProfile?.losses ?? 0}</span>
        </div>
        <button id="logout-btn" class="secondary">Sign Out</button>
      </div>

      <div class="card lobby-card">
        <h2>Ludo Lobby</h2>
        <button id="create-room-btn">Create New Room</button>
        <div class="row">
          <input id="room-code-input" type="text" placeholder="Enter 6-letter code (e.g. AB12CD)" maxlength="6" />
          <button id="join-room-btn">Join Room</button>
        </div>
      </div>
    `;

    document.getElementById('logout-btn')!.onclick = async () => {
      await supabase.auth.signOut();
    };
    document.getElementById('create-room-btn')!.onclick = createRoom;
    document.getElementById('join-room-btn')!.onclick = () => {
      const val = (document.getElementById('room-code-input') as HTMLInputElement).value;
      joinRoom(val);
    };
    return;
  }

  const activePlayer = currentMatch.players[currentMatch.current_turn_index];
  const isMyTurn = Boolean(activePlayer && activePlayer.user_id === currentUserId);
  const isHost = currentMatch.players[0]?.user_id === currentUserId;

  app.innerHTML = `
    <div class="topbar">
      <div>
        <strong>Room: ${currentMatch.room_code}</strong>
        <span class="badge">Status: ${currentMatch.status.toUpperCase()}</span>
        <span class="badge">Dice: ${currentMatch.last_dice_roll ?? '-'}</span>
      </div>
      <div class="row">
        ${
          currentMatch.status === 'waiting' && isHost
            ? `<button id="start-btn">Start Match (${currentMatch.players.length}/4)</button>`
            : ''
        }
        ${
          currentMatch.status === 'active'
            ? `<button id="roll-btn" ${!isMyTurn || currentMatch.can_move ? 'disabled' : ''}>
                ${isMyTurn ? (currentMatch.can_move ? 'Click Highlighted Pawn' : 'Roll Dice') : `Waiting for ${activePlayer?.username}`}
              </button>`
            : ''
        }
        <button id="leave-btn" class="secondary">Leave Room</button>
      </div>
    </div>

    <div class="players-bar">
      ${currentMatch.players
        .map(
          (p, idx) => `
          <div class="player-pill ${idx === currentMatch!.current_turn_index && currentMatch!.status === 'active' ? 'active-turn' : ''}">
            <span class="dot ${p.color}"></span>
            <span>${p.username} (${p.color})</span>
          </div>
        `
        )
        .join('')}
    </div>

    ${
      currentMatch.status === 'finished'
        ? `<div class="banner">Match Finished! Winner ID: ${currentMatch.winner_id}</div>`
        : ''
    }

    <div id="board-container" class="board-box"></div>
  `;

  document.getElementById('leave-btn')!.onclick = async () => {
    if (matchChannel) {
      await supabase.removeChannel(matchChannel);
      matchChannel = null;
    }
    currentMatch = null;
    if (currentUserId) {
      await loadProfile(currentUserId);
    }
    render();
  };

  document.getElementById('start-btn')?.addEventListener('click', startMatch);
  document.getElementById('roll-btn')?.addEventListener('click', handleRollDice);

  const container = document.getElementById('board-container')!;
  if (!board3d || lastBoardContainer !== container) {
    destroyBoard();
    board3d = new LudoBoard3D(container, handlePawnClick);
    lastBoardContainer = container;
  }

  board3d.syncState(
    currentMatch.board_state,
    activePlayer?.color ?? null,
    isMyTurn,
    currentMatch.last_dice_roll,
    currentMatch.can_move
  );
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
      currentMatch = null;
    }
    render();
  });
}

init();
