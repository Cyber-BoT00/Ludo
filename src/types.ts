export type LudoColor = 'red' | 'green' | 'yellow' | 'blue';

export interface PlayerSlot {
  user_id: string;
  username: string;
  color: LudoColor;
  ready: boolean;
}

export type BoardState = Record<LudoColor, [number, number, number, number]>;

export interface MatchRow {
  id: string;
  room_code: string;
  status: 'waiting' | 'active' | 'finished';
  max_players: number;
  players: PlayerSlot[];
  board_state: BoardState;
  current_turn_index: number;
  last_dice_roll: number | null;
  can_move: boolean;
  winner_id: string | null;
  updated_at: string;
}

export interface ProfileRow {
  id: string;
  username: string;
  coins: number;
  wins: number;
  losses: number;
  active_skin: string;
}
