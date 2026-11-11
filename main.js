/* =========================================================
   main.js — dibujo en <canvas>, controles e interfaz.
   Usa la lógica de game.js a través de window.SnakeGame.
   ========================================================= */
(function () {
  'use strict';

  const G = window.SnakeGame;
  if (!G) {
    console.error('No se encontró SnakeGame: revisa que game.js se cargue antes que main.js');
    return;
  }

  /* ---------- Referencias al DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const boardWrap = canvas.parentElement;
  const ui = {
    score: $('score'),
    best: $('best'),
    pause: $('pause-btn'),
    overlay: $('overlay'),
    kicker: $('overlay-kicker'),
    title: $('overlay-title'),
    text: $('overlay-text'),
    button: $('overlay-btn'),
    status: $('status'),
  };

  /* ---------- Preferencias del sistema ---------- */
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const coarseQuery = window.matchMedia('(pointer: coarse)');
  const reduced = () => reducedQuery.matches;

  const BEST_KEY = 'pastel-snake:best';
  const EYE = '#293247';
  const POPUP_MS = 800;

  /* ---------- Sprites pixel-art (# = relleno; el borde se calcula solo) ---------- */
  const HEART = makeSprite([
    '.##.##.',
    '#######',
    '#######',
    '.#####.',
    '..###..',
    '...#...',
  ]);
  const STAR = makeSprite([
    '...#...',
    '...#...',
    '..###..',
    '#######',
    '..###..',
    '...#...',
    '...#...',
  ]);

  function makeSprite(rows) {
    const w = rows[0].length + 2;
    const h = rows.length + 2;
    const isFill = (x, y) => !!rows[y - 1] && rows[y - 1][x - 1] === '#';
    const fill = [];
    const line = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isFill(x, y)) fill.push([x, y]);
        else if (isFill(x + 1, y) || isFill(x - 1, y) || isFill(x, y + 1) || isFill(x, y - 1)) {
          line.push([x, y]);
        }
      }
    }
    return { w, h, fill, line };
  }

  /* ---------- Estado de la interfaz ---------- */
  let state = G.createState();
  let best = loadBest();
  let newRecord = false;
  let colors = readColors();
  let boardSize = 0;      // lado del canvas en píxeles CSS
  let cell = 0;           // lado de una celda en píxeles CSS
  let acc = 0;            // tiempo acumulado para el siguiente paso
  let lastTime = performance.now();
  let popups = [];        // textos "+1" / "+3" flotantes
  let overTimer = 0;

  /* =========================================================
     Récord (localStorage puede fallar en modo privado)
     ========================================================= */
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem(BEST_KEY), 10);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest() {
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* sin almacenamiento */ }
  }

  /* =========================================================
     Colores: se leen de las variables CSS (una sola fuente de verdad)
     ========================================================= */
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name) => cs.getPropertyValue(name).trim();
    const c = {
      boardA: v('--board-a'),
      boardB: v('--board-b'),
      pink: v('--pink'),
      blue: v('--blue'),
      lilac: v('--lilac'),
      sky: v('--sky'),
      accent: v('--accent-text'),
      spriteLine: v('--sprite-line'),
    };
    c.gradient = [hexToRgb(c.blue), hexToRgb(c.lilac), hexToRgb(c.pink)];
    return c;
  }

  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // f = 0 (cabeza, celeste) … 0.5 (lila) … 1 (cola, rosa)
  function bodyColor(f) {
    const [a, b, c] = colors.gradient;
    const from = f < 0.5 ? a : b;
    const to = f < 0.5 ? b : c;
    const t = f < 0.5 ? f * 2 : (f - 0.5) * 2;
    const ch = (i) => Math.round(from[i] + (to[i] - from[i]) * t);
    return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
  }

  function onSchemeChange() { colors = readColors(); }
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSchemeChange);
  else darkQuery.addListener(onSchemeChange);

  /* =========================================================
     Tamaño del canvas: nítido en pantallas retina (devicePixelRatio)
     ========================================================= */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    // A partir de aquí dibujamos en píxeles CSS; el contexto escala solo.
    ctx.setTransform(canvas.width / rect.width, 0, 0, canvas.height / rect.height, 0, 0);
    boardSize = rect.width;
    cell = boardSize / state.cols;
  }

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);

  /* =========================================================
     Dibujo
     ========================================================= */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  // Rellena la celda de cuadrícula (gx, gy) redondeando bordes para que no haya rendijas.
  function fillCell(gx, gy, px, ox, oy) {
    const x0 = Math.round(ox + gx * px);
    const y0 = Math.round(oy + gy * px);
    ctx.fillRect(x0, y0, Math.round(ox + (gx + 1) * px) - x0, Math.round(oy + (gy + 1) * px) - y0);
  }

  function drawBoard() {
    ctx.fillStyle = colors.boardA;
    ctx.fillRect(0, 0, boardSize, boardSize);
    ctx.fillStyle = colors.boardB;
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        if ((x + y) % 2) fillCell(x, y, cell, 0, 0);
      }
    }
  }

  function drawSprite(sp, cx, cy, size, fillColor, lineColor) {
    const px = size / Math.max(sp.w, sp.h);
    const ox = cx - (sp.w * px) / 2;
    const oy = cy - (sp.h * px) / 2;
    ctx.fillStyle = lineColor;
    for (const [x, y] of sp.line) fillCell(x, y, px, ox, oy);
    ctx.fillStyle = fillColor;
    for (const [x, y] of sp.fill) fillCell(x, y, px, ox, oy);
  }

  function drawFood(now) {
    const f = state.food;
    if (!f) return;
    const pulse = reduced() ? 1 : 1 + 0.07 * Math.sin(now / 220);
    drawSprite(HEART, (f.x + 0.5) * cell, (f.y + 0.5) * cell, cell * pulse, colors.pink, colors.spriteLine);
  }

  function drawStar(now) {
    const s = state.star;
    if (!s) return;
    const cx = (s.x + 0.5) * cell;
    const cy = (s.y + 0.5) * cell;
    const left = s.ttl / state.cfg.starLife;

    // Anillo que muestra el tiempo que le queda a la estrella
    ctx.save();
    ctx.lineWidth = Math.max(1.5, cell * 0.09);
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = colors.lilac;
    circle(cx, cy, cell * 0.62);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    ctx.stroke();
    ctx.restore();

    // Parpadea cuando le queda poco (salvo con movimiento reducido)
    if (s.ttl <= 12 && !reduced() && Math.floor(now / 140) % 2) return;
    const twinkle = reduced() ? 1 : 1 + 0.08 * Math.sin(now / 160);
    drawSprite(STAR, cx, cy, cell * 1.05 * twinkle, colors.sky, colors.spriteLine);
  }

  // Interpolación: 0 = posición anterior, 1 = posición actual
  function progress() {
    if (reduced()) return 1;
    if (state.status === 'running' || state.status === 'paused') return Math.min(acc / state.tickMs, 1);
    return 1;
  }

  function blockRect(gx, gy, size) {
    return {
      x: (gx + 0.5) * cell - size / 2,
      y: (gy + 0.5) * cell - size / 2,
    };
  }

  function drawSnake(t, now) {
    const snake = state.snake;
    const n = snake.length;
    const pts = snake.map((c, i) => {
      const p = state.prev[i] || c;
      return { x: p.x + (c.x - p.x) * t, y: p.y + (c.y - p.y) * t };
    });
    const shade = (k) => bodyColor(n > 1 ? k / (n - 1) : 0);
    const bodySize = cell * 0.82;
    const headSize = cell * 0.92;
    const sizeOf = (i) => (i === 0 ? headSize : bodySize);

    // De la cola a la cabeza, para que la cabeza quede encima.
    for (let i = n - 1; i >= 0; i--) {
      if (i < n - 1) {
        // "Puente" en el punto medio entre dos segmentos: el cuerpo se ve continuo
        const a = pts[i];
        const b = pts[i + 1];
        const m = blockRect((a.x + b.x) / 2, (a.y + b.y) / 2, bodySize);
        ctx.fillStyle = shade(i + 0.5);
        roundRect(m.x, m.y, bodySize, bodySize, bodySize * 0.34);
        ctx.fill();
      }
      const s = sizeOf(i);
      const r = blockRect(pts[i].x, pts[i].y, s);
      ctx.fillStyle = shade(i);
      roundRect(r.x, r.y, s, s, s * 0.34);
      ctx.fill();
    }

    // Brillito pixel en cada segmento (segunda pasada, siempre encima)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    for (let i = 0; i < n; i++) {
      const s = sizeOf(i);
      const r = blockRect(pts[i].x, pts[i].y, s);
      const p = Math.max(1, Math.round(s * 0.16));
      ctx.fillRect(Math.round(r.x + s * 0.2), Math.round(r.y + s * 0.2), p, p);
    }

    drawFace(pts[0], now);
  }

  function drawFace(h, now) {
    const d = G.DIRS[state.dir];
    const px = -d.y;           // eje perpendicular a la dirección
    const py = d.x;
    const cx = (h.x + 0.5) * cell;
    const cy = (h.y + 0.5) * cell;
    const dead = state.status === 'over' && !!state.deathReason;
    const blink = !dead && !reduced() && now % 3200 < 140;
    const r = cell * 0.1;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, cell * 0.065);
    for (const side of [-1, 1]) {
      // Mejillas
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = colors.pink;
      circle(cx - d.x * cell * 0.1 + px * cell * 0.3 * side, cy - d.y * cell * 0.1 + py * cell * 0.3 * side, cell * 0.075);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Ojos
      const ex = cx + d.x * cell * 0.12 + px * cell * 0.19 * side;
      const ey = cy + d.y * cell * 0.12 + py * cell * 0.19 * side;
      ctx.strokeStyle = EYE;
      ctx.fillStyle = EYE;
      if (dead) {                                   // x  x
        ctx.beginPath();
        ctx.moveTo(ex - r, ey - r); ctx.lineTo(ex + r, ey + r);
        ctx.moveTo(ex + r, ey - r); ctx.lineTo(ex - r, ey + r);
        ctx.stroke();
      } else if (blink) {                           // parpadeo
        ctx.beginPath();
        ctx.moveTo(ex - px * r, ey - py * r);
        ctx.lineTo(ex + px * r, ey + py * r);
        ctx.stroke();
      } else {                                      // ojo con brillo
        circle(ex, ey, r);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        circle(ex - r * 0.35, ey - r * 0.35, r * 0.38);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawPopups() {
    if (!popups.length) return;
    ctx.save();
    ctx.font = `700 ${Math.round(cell * 0.8)}px 'Segoe UI', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, cell * 0.16);
    ctx.strokeStyle = colors.boardA;
    ctx.fillStyle = colors.accent;
    for (const p of popups) {
      const k = p.age / POPUP_MS;
      const rise = reduced() ? 0 : k * cell * 1.2;
      const x = (p.x + 0.5) * cell;
      const y = Math.max(cell * 0.5, (p.y + 0.5) * cell - cell * 0.6 - rise);
      ctx.globalAlpha = 1 - k;
      ctx.strokeText(p.text, x, y);
      ctx.fillText(p.text, x, y);
    }
    ctx.restore();
  }

  function draw(now) {
    if (!boardSize) return;
    drawBoard();
    drawFood(now);
    drawStar(now);
    drawSnake(progress(), now);
    drawPopups();
  }

  /* =========================================================
     Bucle principal: lógica a paso fijo, dibujo a cada frame
     ========================================================= */
  function frame(now) {
    const dt = Math.min(now - lastTime, 250);   // evita "saltos" al volver a la pestaña
    lastTime = now;

    if (state.status === 'running') {
      acc += dt;
      while (state.status === 'running' && acc >= state.tickMs) {
        acc -= state.tickMs;
        handleEvents(G.step(state));
      }
    }

    popups = popups.filter((p) => (p.age += dt) < POPUP_MS);
    draw(now);
    requestAnimationFrame(frame);
  }

  function handleEvents(events) {
    for (const e of events) {
      if (e.type === 'eat' || e.type === 'star') addPoints(e);
      else if (e.type === 'die') gameOver(false);
      else if (e.type === 'win') gameOver(true);
    }
  }

  /* =========================================================
     Interfaz: marcador, pantallas, anuncios
     ========================================================= */
  function renderScore() {
    ui.score.textContent = state.score;
    ui.best.textContent = best;
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;          // fuerza reflow para reiniciar la animación
    el.classList.add('bump');
  }

  function addPoints(e) {
    if (state.score > best) {
      best = state.score;
      newRecord = true;
      saveBest();
      bump(ui.best);
    }
    renderScore();
    bump(ui.score);
    popups.push({ x: e.x, y: e.y, text: '+' + e.points, age: 0 });
  }

  function announce(msg) {
    ui.status.textContent = msg;
  }

  function showOverlay(o, focusButton) {
    ui.kicker.textContent = o.kicker;
    ui.title.textContent = o.title;
    ui.text.textContent = o.text;
    ui.button.textContent = o.button;
    ui.overlay.hidden = false;
    if (focusButton) ui.button.focus({ preventScroll: true });
  }

  function hideOverlay() {
    if (ui.overlay.contains(document.activeElement)) document.activeElement.blur();
    ui.overlay.hidden = true;
  }

  function setPauseButton(paused) {
    ui.pause.textContent = paused ? '▶' : '❚❚';
    ui.pause.setAttribute('aria-label', paused ? 'Continuar' : 'Pausar');
  }

  function shake() {
    if (reduced()) return;
    boardWrap.classList.remove('is-shaking');
    void boardWrap.offsetWidth;
    boardWrap.classList.add('is-shaking');
  }
  boardWrap.addEventListener('animationend', (e) => {
    if (e.target === boardWrap) boardWrap.classList.remove('is-shaking');
  });

  /* =========================================================
     Acciones del juego
     ========================================================= */
  function startGame() {
    if (!G.start(state)) return;
    acc = 0;
    hideOverlay();
    setPauseButton(false);
    ui.pause.disabled = false;
    announce('¡A jugar!');
  }

  function pauseGame() {
    if (!G.pause(state)) return;
    setPauseButton(true);
    showOverlay({
      kicker: 'pausa',
      title: 'Un respiro',
      text: coarseQuery.matches
        ? 'Toca «Continuar» o una flecha para seguir.'
        : 'Pulsa Espacio o P para seguir.',
      button: 'Continuar',
    });
    announce('Juego en pausa');
  }

  function resumeGame() {
    if (state.status !== 'paused') return;
    G.start(state);
    hideOverlay();
    setPauseButton(false);
    announce('Continuamos');
  }

  function togglePause() {
    if (state.status === 'running') pauseGame();
    else if (state.status === 'paused') resumeGame();
    else if (state.status === 'ready') startGame();
  }

  function restartGame() {
    clearTimeout(overTimer);
    state = G.createState();
    newRecord = false;
    popups = [];
    acc = 0;
    renderScore();
    startGame();
  }

  function primaryAction() {
    if (state.status === 'ready') startGame();
    else if (state.status === 'paused') resumeGame();
    else restartGame();
  }

  function gameOver(win) {
    ui.pause.disabled = true;
    setPauseButton(false);
    if (!win) shake();

    const title = win
      ? '¡Llenaste el tablero!'
      : state.deathReason === 'wall' ? '¡Pum, la pared!' : '¡Te mordiste!';
    const kicker = newRecord ? '✦ nuevo récord ✦' : 'game over';
    const text = `Hiciste ${state.score} ${state.score === 1 ? 'punto' : 'puntos'}. Récord: ${best}.`;
    announce(`${title} ${text}`);

    // Una pausita para ver el choque antes de mostrar la pantalla
    overTimer = setTimeout(() => {
      showOverlay({ kicker, title, text, button: 'Jugar de nuevo' }, true);
    }, reduced() ? 0 : 450);
  }

  // Girar desde cualquier control
  function steer(dir) {
    if (state.status === 'over') return;
    if (state.status === 'paused') resumeGame();
    G.queueDirection(state, dir);
    if (state.status === 'ready') startGame();
  }

  /* =========================================================
     Controles
     ========================================================= */

  // Teclado. Las letras usan e.code (tecla física), así WASD
  // funciona igual con distribuciones de teclado distintas.
  const KEY_DIR = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  };

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;   // no romper Ctrl+R, etc.
    const onControl = e.target instanceof Element && e.target.closest('button, a');

    const dir = KEY_DIR[e.key] || KEY_DIR[e.code];
    if (dir) {
      e.preventDefault();                              // las flechas no hacen scroll
      steer(dir);
      return;
    }

    if (e.code === 'Space' || e.code === 'KeyP') {
      if (onControl && e.code === 'Space') return;     // deja que el botón haga su clic
      e.preventDefault();
      if (!e.repeat) togglePause();
      return;
    }

    if (e.key === 'Enter' || e.code === 'KeyR') {
      if (onControl && e.key === 'Enter') return;
      e.preventDefault();
      if (!e.repeat) restartGame();
    }
  });

  // Deslizar el dedo sobre el tablero. Al pasar el umbral se gira y se
  // reinicia el punto de partida, así puedes encadenar giros sin levantar el dedo.
  let swipe = null;

  canvas.addEventListener('pointerdown', (e) => {
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    const threshold = Math.max(18, cell * 0.6);
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    swipe.x = e.clientX;
    swipe.y = e.clientY;
  });

  const endSwipe = (e) => { if (swipe && e.pointerId === swipe.id) swipe = null; };
  canvas.addEventListener('pointerup', endSwipe);
  canvas.addEventListener('pointercancel', endSwipe);

  // Botones ▲ ◀ ▼ ▶. pointerdown responde al instante (sin esperar al "click");
  // el click solo se usa cuando viene del teclado (e.detail === 0).
  document.querySelectorAll('.dpad-btn').forEach((btn) => {
    const dir = btn.dataset.dir;
    const release = () => btn.classList.remove('is-pressed');
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('is-pressed');
      steer(dir);
    });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('click', (e) => { if (e.detail === 0) steer(dir); });
  });

  ui.button.addEventListener('click', primaryAction);
  ui.pause.addEventListener('click', togglePause);

  // Si cambias de pestaña, el juego se pausa solo.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.status === 'running') pauseGame();
  });

  /* ---------- ¡Arrancar! ---------- */
  renderScore();
  resize();
  requestAnimationFrame(frame);
})();
