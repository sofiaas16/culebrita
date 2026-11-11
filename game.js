/* =========================================================
   game.js — la lógica de Pastel Snake.
   No toca el DOM: recibe órdenes (girar, avanzar, pausar)
   y devuelve eventos. Se publica en window.SnakeGame
   (y en module.exports para poder probarlo con Node).
   ========================================================= */
(function (root) {
  'use strict';

  // Vectores de cada dirección (y crece hacia abajo, como en el canvas)
  const DIRS = Object.freeze({
    up:    Object.freeze({ x: 0, y: -1 }),
    down:  Object.freeze({ x: 0, y: 1 }),
    left:  Object.freeze({ x: -1, y: 0 }),
    right: Object.freeze({ x: 1, y: 0 }),
  });

  const OPPOSITE = Object.freeze({ up: 'down', down: 'up', left: 'right', right: 'left' });

  const DEFAULTS = Object.freeze({
    cols: 20,
    rows: 20,
    startLength: 3,
    startTick: 150,   // ms por paso al empezar
    minTick: 70,      // límite de velocidad (ms por paso)
    speedStep: 3,     // ms que se restan con cada bocado
    starChance: 0.3,  // probabilidad de que aparezca ✦ al comer ♥
    starLife: 45,     // pasos que dura la estrella antes de desaparecer
    queueMax: 3,      // giros que se pueden guardar por adelantado
  });

  const sameCell = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
  const cloneCells = (cells) => cells.map((c) => ({ x: c.x, y: c.y }));

  /* ---------- Crear una partida ---------- */
  function createState(options) {
    const cfg = Object.assign({}, DEFAULTS, options);
    const cx = Math.floor(cfg.cols / 2);
    const cy = Math.floor(cfg.rows / 2);

    // La cabeza es snake[0]; el cuerpo se extiende hacia la izquierda.
    const snake = [];
    for (let i = 0; i < cfg.startLength; i++) snake.push({ x: cx - i, y: cy });

    const state = {
      cfg,
      rng: typeof cfg.rng === 'function' ? cfg.rng : Math.random,
      cols: cfg.cols,
      rows: cfg.rows,
      snake,
      prev: cloneCells(snake),   // posiciones del paso anterior (para animar)
      dir: 'right',
      queue: [],
      food: null,
      star: null,
      score: 0,
      bites: 0,
      ticks: 0,
      tickMs: cfg.startTick,
      status: 'ready',           // 'ready' | 'running' | 'paused' | 'over'
      deathReason: null,         // 'wall' | 'self' | null
    };
    state.food = randomFreeCell(state);
    return state;
  }

  /* ---------- Celda libre al azar (o null si el tablero está lleno) ---------- */
  function randomFreeCell(state) {
    const key = (c) => c.y * state.cols + c.x;
    const taken = new Set(state.snake.map(key));
    if (state.food) taken.add(key(state.food));
    if (state.star) taken.add(key(state.star));

    const free = [];
    for (let i = 0; i < state.cols * state.rows; i++) {
      if (!taken.has(i)) free.push(i);
    }
    if (!free.length) return null;

    const i = free[Math.floor(state.rng() * free.length)];
    return { x: i % state.cols, y: Math.floor(i / state.cols) };
  }

  /* ---------- Giros ----------
     Se compara con el ÚLTIMO giro en cola (no con la dirección actual).
     Así, "derecha → arriba → izquierda" pulsado muy rápido funciona,
     pero "derecha → izquierda" (180°) se rechaza. */
  function queueDirection(state, dir) {
    if (!DIRS[dir] || state.status === 'over') return false;
    const q = state.queue;
    const last = q.length ? q[q.length - 1] : state.dir;
    if (dir === last || dir === OPPOSITE[last]) return false;
    if (q.length >= state.cfg.queueMax) return false;
    q.push(dir);
    return true;
  }

  /* ---------- Estados ---------- */
  function start(state) {
    if (state.status !== 'ready' && state.status !== 'paused') return false;
    state.status = 'running';
    return true;
  }

  function pause(state) {
    if (state.status !== 'running') return false;
    state.status = 'paused';
    return true;
  }

  function togglePause(state) {
    return state.status === 'running' ? pause(state) : start(state);
  }

  function speedUp(state) {
    const cfg = state.cfg;
    state.bites++;
    state.tickMs = Math.max(cfg.minTick, cfg.startTick - state.bites * cfg.speedStep);
  }

  function die(state, reason) {
    state.status = 'over';
    state.deathReason = reason;
    state.queue.length = 0;
    state.prev = cloneCells(state.snake);   // congela la animación
    return [{ type: 'die', reason }];
  }

  /* ---------- Un paso del juego ----------
     Devuelve una lista de eventos para que la interfaz reaccione:
     { type: 'eat' | 'star', points, x, y }, { type: 'starGone' },
     { type: 'die', reason }, { type: 'win' } */
  function step(state) {
    if (state.status !== 'running') return [];
    const events = [];

    if (state.queue.length) state.dir = state.queue.shift();
    const v = DIRS[state.dir];
    const head = state.snake[0];
    const next = { x: head.x + v.x, y: head.y + v.y };

    // 1. ¿Pared?
    if (next.x < 0 || next.y < 0 || next.x >= state.cols || next.y >= state.rows) {
      return die(state, 'wall');
    }

    // 2. ¿Se muerde? Si no crece, la cola se va a mover,
    //    así que puede entrar en la celda donde está la cola ahora.
    const ateFood = sameCell(next, state.food);
    const ateStar = sameCell(next, state.star);
    const grows = ateFood || ateStar;
    const body = grows ? state.snake : state.snake.slice(0, -1);
    if (body.some((c) => sameCell(c, next))) return die(state, 'self');

    // 3. Mover: nueva cabeza al frente, quitar la cola (salvo que crezca)
    state.prev = cloneCells(state.snake);
    state.snake.unshift(next);
    if (!grows) state.snake.pop();
    state.ticks++;

    // 4. Estrella: se come o se le acaba el tiempo
    if (ateStar) {
      state.score += 3;
      speedUp(state);
      state.star = null;
      events.push({ type: 'star', points: 3, x: next.x, y: next.y });
    } else if (state.star) {
      state.star.ttl--;
      if (state.star.ttl <= 0) {
        events.push({ type: 'starGone', x: state.star.x, y: state.star.y });
        state.star = null;
      }
    }

    // 5. Corazón: sumar, mover la comida y quizá sacar una estrella
    if (ateFood) {
      state.score += 1;
      speedUp(state);
      events.push({ type: 'eat', points: 1, x: next.x, y: next.y });

      state.food = null;
      state.food = randomFreeCell(state);
      if (!state.food) {                    // ¡llenaste el tablero!
        state.status = 'over';
        events.push({ type: 'win' });
        return events;
      }
      if (!state.star && state.rng() < state.cfg.starChance) {
        const c = randomFreeCell(state);
        if (c) state.star = { x: c.x, y: c.y, ttl: state.cfg.starLife };
      }
    }

    return events;
  }

  const api = Object.freeze({
    DIRS, OPPOSITE, DEFAULTS,
    createState, queueDirection, step, start, pause, togglePause,
  });

  root.SnakeGame = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
