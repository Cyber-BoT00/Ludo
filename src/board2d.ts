import type { BoardState, LudoColor } from './types';
import {
  COLORS,
  getPawnGridRC,
  HOME_STRETCH_CELLS,
  isPawnMovable,
  OUTER_TRACK_15X15,
  SAFE_TILE_INDICES,
  START_OFFSET,
} from './ludoRules';

const COLOR_STYLES: Record<
  LudoColor,
  { main: string; light: string; dark: string; label: string }
> = {
  red: { main: '#ef4444', light: '#fee2e2', dark: '#991b1b', label: 'R' },
  green: { main: '#22c55e', light: '#dcfce7', dark: '#166534', label: 'G' },
  yellow: { main: '#eab308', light: '#fef9c3', dark: '#854d0e', label: 'Y' },
  blue: { main: '#3b82f6', light: '#dbeafe', dark: '#1e40af', label: 'B' },
};

export function renderLudoBoard2D(
  container: HTMLElement,
  board: BoardState,
  activeColor: LudoColor | null,
  isMyTurn: boolean,
  diceRoll: number | null,
  canMove: boolean,
  onPawnClick: (color: LudoColor, pawnIndex: number) => void
) {
  const outerSet = new Map<string, number>();
  OUTER_TRACK_15X15.forEach(([r, c], idx) => {
    outerSet.set(`${r},${c}`, idx);
  });

  const stretchSet = new Map<string, LudoColor>();
  for (const col of COLORS) {
    HOME_STRETCH_CELLS[col].forEach(([r, c]) => {
      stretchSet.set(`${r},${c}`, col);
    });
  }

  const startTileColor = new Map<number, LudoColor>();
  for (const col of COLORS) {
    startTileColor.set(START_OFFSET[col], col);
  }

  let cellsHtml = '';
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      // Skip 6x6 corner yards & 3x3 center home
      const inTopLeft = r < 6 && c < 6;
      const inTopRight = r < 6 && c > 8;
      const inBottomRight = r > 8 && c > 8;
      const inBottomLeft = r > 8 && c < 6;
      const inCenter = r >= 6 && r <= 8 && c >= 6 && c <= 8;

      if (inTopLeft || inTopRight || inBottomRight || inBottomLeft || inCenter) {
        continue;
      }

      const key = `${r},${c}`;
      const trackIdx = outerSet.get(key);
      const stretchCol = stretchSet.get(key);

      let bg = '#ffffff';
      let starBadge = '';

      if (stretchCol) {
        bg = COLOR_STYLES[stretchCol].main;
      } else if (trackIdx !== undefined) {
        const startCol = startTileColor.get(trackIdx);
        if (startCol) {
          bg = COLOR_STYLES[startCol].main;
          starBadge = `<span class="tile-icon" title="Safe Start Tile">★</span>`;
        } else if (SAFE_TILE_INDICES.has(trackIdx)) {
          bg = '#fef3c7';
          starBadge = `<span class="tile-icon safe-star" title="Safe Star Tile">★</span>`;
        }
      }

      cellsHtml += `
        <div
          class="ludo-cell"
          style="grid-row:${r + 1};grid-column:${c + 1};background:${bg};"
        >
          ${starBadge}
        </div>
      `;
    }
  }

  const yardsHtml = `
    <div class="yard yard-red">
      <div class="yard-inner"><div class="yard-pad"></div></div>
    </div>
    <div class="yard yard-green">
      <div class="yard-inner"><div class="yard-pad"></div></div>
    </div>
    <div class="yard yard-blue">
      <div class="yard-inner"><div class="yard-pad"></div></div>
    </div>
    <div class="yard yard-yellow">
      <div class="yard-inner"><div class="yard-pad"></div></div>
    </div>
    <div class="center-home">
      <div class="center-badge">HOME</div>
    </div>
  `;

  // Group pawns by grid position so stacked pawns offset cleanly
  const slotCounts = new Map<string, number>();
  const pawnEntries: {
    color: LudoColor;
    pawnIndex: number;
    row: number;
    col: number;
    movable: boolean;
    stackIdx: number;
  }[] = [];

  for (const color of COLORS) {
    for (let i = 0; i < 4; i++) {
      const pos = board[color][i];
      const [row, col] = getPawnGridRC(color, i, pos);
      const bucketKey = `${row.toFixed(2)},${col.toFixed(2)}`;
      const stackIdx = slotCounts.get(bucketKey) ?? 0;
      slotCounts.set(bucketKey, stackIdx + 1);

      const movable =
        isMyTurn && color === activeColor && isPawnMovable(pos, diceRoll, canMove);

      pawnEntries.push({
        color,
        pawnIndex: i,
        row,
        col,
        movable,
        stackIdx,
      });
    }
  }

  const pawnsHtml = pawnEntries
    .map((p) => {
      const offsetX = (p.stackIdx - 0.5) * 10;
      const offsetY = (p.stackIdx % 2 === 0 ? -1 : 1) * 5;
      const leftPct = ((p.col + 0.5) / 15) * 100;
      const topPct = ((p.row + 0.5) / 15) * 100;
      const st = COLOR_STYLES[p.color];

      return `
        <button
          type="button"
          class="ludo-pawn pawn-${p.color} ${p.movable ? 'movable' : ''}"
          style="
            left: calc(${leftPct}% + ${offsetX}px);
            top: calc(${topPct}% + ${offsetY}px);
            background: radial-gradient(circle at 32% 28%, #ffffff 0%, ${st.main} 35%, ${st.dark} 100%);
          "
          data-color="${p.color}"
          data-pawn-index="${p.pawnIndex}"
          title="${p.color.toUpperCase()} Pawn #${p.pawnIndex + 1}${p.movable ? ' (Click to Move!)' : ''}"
        >
          <span class="pawn-cap">${st.label}</span>
        </button>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="ludo-board-wrapper">
      <div class="ludo-board-2d">
        ${yardsHtml}
        ${cellsHtml}
        <div class="pawns-layer">
          ${pawnsHtml}
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll<HTMLButtonElement>('.ludo-pawn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color as LudoColor;
      const pawnIndex = Number(btn.dataset.pawnIndex);
      onPawnClick(color, pawnIndex);
    });
  });
}
