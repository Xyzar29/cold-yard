// Keyboard and mouse input for COLD YARD: a keys-down set, pointer-lock mouse look deltas,
// and edge-triggered action flags the simulation consumes once per step. The DOM wiring
// lives here so the simulation modules never touch events directly.

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set(); // keys that went down since the last consume()
  let lookDX = 0;
  let lookDY = 0;
  let firing = false;
  let firingPressed = false;
  let locked = false;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
    if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); firing = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (!locked || e.button !== 0) return;
    if (!firing) firingPressed = true;
    firing = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    lookDX += e.movementX || 0;
    lookDY += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) firing = false;
  });

  return {
    get locked() { return locked; },
    get firing() { return firing; },
    down: (code) => keys.has(code),
    // Movement axes in the player's local frame: forward/strafe in -1..1.
    moveAxes() {
      let f = 0;
      let s = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
      return { f, s };
    },
    // Read and clear the accumulated look delta (called once per frame by the controller).
    takeLook() {
      const d = { x: lookDX, y: lookDY };
      lookDX = 0;
      lookDY = 0;
      return d;
    },
    // Read and clear an edge-triggered key press.
    wasPressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    takeFiringPressed() {
      const p = firingPressed;
      firingPressed = false;
      return p;
    },
    lock() { canvas.requestPointerLock(); },
    unlock() { document.exitPointerLock(); },
  };
}
