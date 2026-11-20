import type { BoardState, LudoColor } from './types';

export const COLORS: LudoColor[] = ['red', 'green', 'yellow', 'blue'];

// 52 outer track coordinates on a 15x15 grid (row 0..14, col 0..14)
export const OUTER_TRACK_15X15: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6],
  [0, 6], [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13],
  [6, 14], [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8],
  [14, 8], [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1],
  [8, 0], [7, 0], [6, 0],
];

// Safe star indices on the 52-tile outer track (including start tiles)
export const SAFE_TILE_INDICES = new Set<number>([0, 8, 13, 21, 26, 34, 39, 47]);

export const START_OFFSET: Record<LudoColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

// 4 home-yard token slots (row, col) inside each 6x6 corner yard
export const HOME_YARD_CELLS: Record<LudoColor, [number, number][]> = {
  red: [[1.8, 1.8], [1.8, 3.2], [3.2, 1.8], [3.2, 3.2]],
  green: [[1.8, 10.8], [1.8, 12.2], [3.2, 10.8], [3.2, 12.2]],
  yellow: [[10.8, 10.8], [10.8, 12.2], [12.2, 10.8], [12.2, 12.2]],
  blue: [[10.8, 1.8], [10.8, 3.2], [12.2, 1.8], [12.2, 3.2]],
};

// 6 colored home-stretch cells leading to center finish (7, 7)
export const HOME_STRETCH_CELLS: Record<LudoColor, [number, number][]> = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
};

export function getPawnGridRC(
  color: LudoColor,
  pawnIndex: number,
  progress: number
): [number, number] {
  if (progress < 0) {
    return HOME_YARD_CELLS[color][pawnIndex];
  }
  if (progress <= 50) {
    const absIdx = (START_OFFSET[color] + progress) % 52;
    return OUTER_TRACK_15X15[absIdx];
  }
  if (progress <= 55) {
    return HOME_STRETCH_CELLS[color][progress - 51];
  }
  // Finished (56): tucked neatly near center home triangle
  const finishOffsets: Record<LudoColor, [number, number]> = {
    red: [7, 6.35],
    green: [6.35, 7],
    yellow: [7, 7.65],
    blue: [7.65, 7],
  };
  return finishOffsets[color];
}

export function isPawnMovable(
  currentPos: number,
  diceRoll: number | null,
  canMove: boolean
): boolean {
  if (!canMove || diceRoll === null) return false;
  if (currentPos < 0) return diceRoll === 6;
  return currentPos + diceRoll <= 56;
}

export function getMovablePawnIndices(
  pawns: [number, number, number, number],
  diceRoll: number | null,
  canMove: boolean
): number[] {
  const indices: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (isPawnMovable(pawns[i], diceRoll, canMove)) {
      indices.push(i);
    }
  }
  return indices;
}

export function applyLocalMove(
  board: BoardState,
  activeColors: LudoColor[],
  color: LudoColor,
  pawnIndex: number,
  diceRoll: number
): {
  nextBoard: BoardState;
  captured: boolean;
  bonusTurn: boolean;
  won: boolean;
} {
  const nextBoard: BoardState = {
    red: [...board.red] as [number, number, number, number],
    green: [...board.green] as [number, number, number, number],
    yellow: [...board.yellow] as [number, number, number, number],
    blue: [...board.blue] as [number, number, number, number],
  };

  const curr = nextBoard[color][pawnIndex];
  let nextPos = curr;

  if (curr < 0) {
    if (diceRoll !== 6) {
      return { nextBoard, captured: false, bonusTurn: false, won: false };
    }
    nextPos = 0;
  } else {
    if (curr + diceRoll > 56) {
      return { nextBoard, captured: false, bonusTurn: false, won: false };
    }
    nextPos = curr + diceRoll;
  }

  nextBoard[color][pawnIndex] = nextPos;
  let captured = false;

  if (nextPos >= 0 && nextPos <= 50) {
    const absTile = (START_OFFSET[color] + nextPos) % 52;
    if (!SAFE_TILE_INDICES.has(absTile)) {
      for (const otherColor of activeColors) {
        if (otherColor === color) continue;
        for (let i = 0; i < 4; i++) {
          const op = nextBoard[otherColor][i];
          if (op >= 0 && op <= 50) {
            const otherAbs = (START_OFFSET[otherColor] + op) % 52;
            if (otherAbs === absTile) {
              nextBoard[otherColor][i] = -1;
              captured = true;
            }
          }
        }
      }
    }
  }

  const won = nextBoard[color].every((p) => p === 56);
  const bonusTurn = !won && (diceRoll === 6 || captured);

  return { nextBoard, captured, bonusTurn, won };
}
