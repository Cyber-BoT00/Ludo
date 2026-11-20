import * as THREE from 'three';
import type { BoardState, LudoColor } from './types';
import { COLORS, getPawnWorldXZ, isPawnMovable } from './ludoRules';

const COLOR_HEX: Record<LudoColor, number> = {
  red: 0xe11d48,
  green: 0x16a34a,
  yellow: 0xeab308,
  blue: 0x2563eb,
};

export class LudoBoard3D {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pawnMeshes: THREE.Mesh[] = [];
  private diceMesh: THREE.Mesh;
  private onPawnClick: (color: LudoColor, pawnIndex: number) => void;
  private animId = 0;

  constructor(
    container: HTMLElement,
    onPawnClick: (color: LudoColor, pawnIndex: number) => void
  ) {
    this.onPawnClick = onPawnClick;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a);

    const width = container.clientWidth || 720;
    const height = container.clientHeight || 520;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 16, 14);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    // Lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(8, 18, 10);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    // Base board
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(16, 0.6, 16),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 })
    );
    board.position.y = -0.3;
    board.receiveShadow = true;
    this.scene.add(board);

    // 4 Corner Yards
    const yardPositions: [LudoColor, number, number][] = [
      ['red', -4.5, -4.5],
      ['green', 4.5, -4.5],
      ['yellow', 4.5, 4.5],
      ['blue', -4.5, 4.5],
    ];
    for (const [color, x, z] of yardPositions) {
      const yard = new THREE.Mesh(
        new THREE.BoxGeometry(5.2, 0.12, 5.2),
        new THREE.MeshStandardMaterial({ color: COLOR_HEX[color], roughness: 0.4 })
      );
      yard.position.set(x, 0.04, z);
      this.scene.add(yard);
    }

    // Center finish hub
    const hub = new THREE.Mesh(
      new THREE.BoxGeometry(3, 0.16, 3),
      new THREE.MeshStandardMaterial({ color: 0x334155 })
    );
    hub.position.y = 0.06;
    this.scene.add(hub);

    // 3D Dice in center
    this.diceMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 1.1, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 })
    );
    this.diceMesh.position.set(0, 0.7, 0);
    this.diceMesh.castShadow = true;
    this.scene.add(this.diceMesh);

    // 16 Pawns (4 per color)
    for (const color of COLORS) {
      for (let i = 0; i < 4; i++) {
        const pawn = new THREE.Mesh(
          new THREE.CylinderGeometry(0.32, 0.45, 1.1, 20),
          new THREE.MeshStandardMaterial({ color: COLOR_HEX[color], roughness: 0.3 })
        );
        pawn.castShadow = true;
        pawn.userData = { color, pawnIndex: i };
        this.scene.add(pawn);
        this.pawnMeshes.push(pawn);
      }
    }

    this.renderer.domElement.addEventListener('click', this.handleClick);
    window.addEventListener('resize', this.handleResize);
    this.animate();
  }

  private handleClick = (e: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pawnMeshes, false);
    if (hits.length > 0) {
      const { color, pawnIndex } = hits[0].object.userData as {
        color: LudoColor;
        pawnIndex: number;
      };
      this.onPawnClick(color, pawnIndex);
    }
  };

  private handleResize = () => {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const w = parent.clientWidth || 720;
    const h = parent.clientHeight || 520;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  public syncState(
    board: BoardState,
    activeColor: LudoColor | null,
    isMyTurn: boolean,
    diceRoll: number | null,
    canMove: boolean
  ) {
    if (diceRoll) {
      this.diceMesh.rotation.set(diceRoll * 0.6, diceRoll * 0.9, 0);
    }

    for (const pawn of this.pawnMeshes) {
      const { color, pawnIndex } = pawn.userData as { color: LudoColor; pawnIndex: number };
      const pos = board[color][pawnIndex];
      const [x, z] = getPawnWorldXZ(color, pawnIndex, pos);
      pawn.position.set(x, 0.6, z);

      const movable = isMyTurn && color === activeColor && isPawnMovable(pos, diceRoll, canMove);
      const mat = pawn.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(movable ? 0xfacc15 : 0x000000);
      mat.emissiveIntensity = movable ? 0.55 : 0;
    }
  }

  private animate = () => {
    this.animId = requestAnimationFrame(this.animate);
    this.renderer.render(this.scene, this.camera);
  };

  public dispose() {
    cancelAnimationFrame(this.animId);
    this.renderer.domElement.removeEventListener('click', this.handleClick);
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }
}
