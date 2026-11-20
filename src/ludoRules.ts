import type { LudoColor } from './types';

export const COLORS: LudoColor[] = ['red', 'green', 'yellow', 'blue'];

// 52 outer track tiles (x, z) on a 15x15 grid centered at (0, 0)
const OUTER_COORDS: [number, number][] = [
  [-6, -1], [-5, -1], [-4, -1], [-3, -1], [-2, -1],
  [-1, -2], [-1, -3], [-1, -4], [-1, -5], [-1, -6],
  [-1, -7], [0, -7], [1, -7],
  [1, -6], [1, -5], [1, -4], [1, -3], [1, -2],
  [2, -1], [3, -1], [4, -1], [5, -1], [6, -1],
  [7, -1], [7, 0], [7, 1],
  [6, 1], [5, 1], [4, 1], [3, 1], [2, 1],
  [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
  [1, 7], [0, 7], [-1, 7],
  [-1, 6], [-1, 5], [-1, 4], [-1, 3], [-1, 2],
  [-2, 1], [-3, 1], [-4, 1], [-5, 1], [-6, 1],
  [-7, 1], [-7, 0], [-7, -1],
];

const START_OFFSET: Record<LudoColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

const HOME_YARD_SLOTS: Record<LudoColor, [number, number][]> = {
  red: [[-5.5, -5.5], [-3.5, -5.5], [-5.5, -3.5], [-3.5, -3.5]],
  green: [[3.5, -5.5], [5.5, -5.5], [3.5, -3.5], [5.5, -3.5]],
  yellow: [[3.5, 3.5], [5.5, 3.5], [3.5, 5.5], [5.5, 5.5]],
  blue: [[-5.5, 3.5], [-3.5, 3.5], [-5.5, 5.5], [-3.5, 5.5]],
};

const HOME_STRETCH: Record<LudoColor, [number, number][]> = {
  red: [[-6, 0], [-5, 0], [-4, 0], [-3, 0], [-2, 0], [-1.2, 0]],
  green: [[0, -6], [0, -5], [0, -4], [0, -3], [0, -2], [0, -1.2]],
  yellow: [[6, 0], [5, 0], [4, 0], [3, 0], [2, 0], [1.2, 0]],
  blue: [[0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1.2]],
};

export function getPawnWorldXZ(color: LudoColor, pawnIndex: number, progress: number): [number, number] {
  if (progress < 0) {
    return HOME_YARD_SLOTS[color][pawnIndex];
  }
  if (progress <= 50) {
    const idx = (START_OFFSET[color] + progress) % 52;
    return OUTER_COORDS[idx];
  }
  const stretchIdx = Math.min(progress - 51, 5);
  return HOME_STRETCH[color][stretchIdx];
}

export function isPawnMovable(currentPos: number, diceRoll: number | null, canMove: boolean): boolean {
  if (!canMove || diceRoll === null) return false;
  if (currentPos < 0) return diceRoll === 6;
  return currentPos + diceRoll <= 56;
}
