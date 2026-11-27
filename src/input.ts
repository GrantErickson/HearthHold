/** Keyboard (WASD / arrows) and a floating drag joystick for touch and mouse. */
const keys: Record<string, boolean> = {};
const joy = { active: false, id: -1, sx: 0, sy: 0, dx: 0, dy: 0 };
const RADIUS = 56;
let joyEl: HTMLElement | null = null;
let knobEl: HTMLElement | null = null;
const keyHandlers: ((e: KeyboardEvent) => void)[] = [];
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

function showJoy(): void {
  if (!joyEl) return;
  joyEl.style.left = `${joy.sx}px`;
  joyEl.style.top = `${joy.sy}px`;
  joyEl.classList.add('on');
  moveKnob();
}
function hideJoy(): void {
  joyEl?.classList.remove('on');
}
function moveKnob(): void {
  if (knobEl) knobEl.style.transform = `translate(calc(-50% + ${joy.dx}px), calc(-50% + ${joy.dy}px))`;
}

export const Input = {
  init(canvas: HTMLCanvasElement): void {
    joyEl = document.getElementById('joy');
    knobEl = document.getElementById('joyKnob');
    window.addEventListener('keydown', (e) => {
      // Typing in a form field (the test panel) is not a game key.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      keys[e.code] = true;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      for (const h of keyHandlers) h(e);
    });
    window.addEventListener('keyup', (e) => {
      keys[e.code] = false;
    });
    window.addEventListener('blur', () => Input.reset());

    canvas.addEventListener('pointerdown', (e) => {
      if (joy.active) return;
      joy.active = true;
      joy.id = e.pointerId;
      joy.sx = e.clientX;
      joy.sy = e.clientY;
      joy.dx = joy.dy = 0;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* not supported */
      }
      showJoy();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!joy.active || e.pointerId !== joy.id) return;
      let dx = e.clientX - joy.sx;
      let dy = e.clientY - joy.sy;
      const d = Math.hypot(dx, dy);
      if (d > RADIUS) {
        // Let the joystick base follow the finger so direction changes stay responsive.
        const over = d - RADIUS;
        joy.sx += (dx / d) * over;
        joy.sy += (dy / d) * over;
        dx = e.clientX - joy.sx;
        dy = e.clientY - joy.sy;
        if (joyEl) {
          joyEl.style.left = `${joy.sx}px`;
          joyEl.style.top = `${joy.sy}px`;
        }
      }
      joy.dx = dx;
      joy.dy = dy;
      moveKnob();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== joy.id) return;
      joy.active = false;
      joy.dx = joy.dy = 0;
      hideJoy();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  /** Movement direction in world space (x right, z toward the camera), length 0..1. */
  move(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (keys.KeyW || keys.ArrowUp) z -= 1;
    if (keys.KeyS || keys.ArrowDown) z += 1;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;
    if (x || z) {
      const l = Math.hypot(x, z);
      return { x: x / l, z: z / l };
    }
    if (joy.active) {
      const m = Math.hypot(joy.dx, joy.dy);
      if (m < 7) return { x: 0, z: 0 };
      const s = Math.min(1, m / (RADIUS * 0.8));
      return { x: (joy.dx / m) * s, z: (joy.dy / m) * s };
    }
    return { x: 0, z: 0 };
  },

  onKey(h: (e: KeyboardEvent) => void): void {
    keyHandlers.push(h);
  },

  reset(): void {
    for (const k of Object.keys(keys)) keys[k] = false;
    joy.active = false;
    joy.dx = joy.dy = 0;
    hideJoy();
  },
};
