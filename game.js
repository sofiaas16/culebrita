// Lógica del juego. Aquí no se toca el DOM, solo el estado.
(function (root) {
  'use strict';

  const DIRS = Object.freeze({
    up:    Object.freeze({ x: 0, y: -1 }),
    down:  Object.freeze({ x: 0, y: 1 }),
    left:  Object.freeze({ x: -1, y: 0 }),
    right: Object.freeze({ x: 1, y: 0 }),
  });

  const OPPOSITE = Object.freeze({ up: 'down', down: 'up', left: 'right', right: 'left' });

  // valores para ajustar la dificultad
  const DEFAULTS = Object.freeze({
    cols: 20,
    rows: 20,
    startLength: 3,
    startTick: 150,   // ms por paso
    minTick: 70,
    speedStep: 3,
    starChance: 0.3,
    starLife: 45,     // en pasos, no en ms
    queueMax: 3,
  });

  const sameCell = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
  const cloneCells = (cells) => cells.map((c) => ({ x: c.x, y: c.y }));

  function createState(options) {
    const cfg = Object.assign({}, DEFAULTS, options);
    const cx = Math.floor(cfg.cols / 2);
    const cy = Math.floor(cfg.rows / 2);

    // snake[0] es la cabeza
    const snake = [];
    for (let i = 0; i < cfg.startLength; i++) snake.push({ x: cx - i, y: cy });

    const state = {
      cfg,
      rng: typeof cfg.rng === 'function' ? cfg.rng : Math.random,
      cols: cfg.cols,
      rows: cfg.rows,
      snake,
      prev: cloneCells(snake),
      dir: 'right',
      queue: [],
      food: null,
      star: null,
      score: 0,
      bites: 0,
      ticks: 0,
      tickMs: cfg.startTick,
      status: 'ready',           // ready | running | paused | over
      deathReason: null,
    };
    state.food = randomFreeCell(state);
    return state;
  }

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

  // Comparo con el último giro de la cola y no con la dirección actual,
  // así no se pierden teclas rápidas y tampoco se puede dar media vuelta.
  function queueDirection(state, dir) {
    if (!DIRS[dir] || state.status === 'over') return false;
    const q = state.queue;
    const last = q.length ? q[q.length - 1] : state.dir;
    if (dir === last || dir === OPPOSITE[last]) return false;
    if (q.length >= state.cfg.queueMax) return false;
    q.push(dir);
    return true;
  }

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
    state.prev = cloneCells(state.snake);
    return [{ type: 'die', reason }];
  }

  // Avanza un paso y devuelve lo que pasó (eat, star, starGone, die, win)
  function step(state) {
    if (state.status !== 'running') return [];
    const events = [];

    if (state.queue.length) state.dir = state.queue.shift();
    const v = DIRS[state.dir];
    const head = state.snake[0];
    const next = { x: head.x + v.x, y: head.y + v.y };

    if (next.x < 0 || next.y < 0 || next.x >= state.cols || next.y >= state.rows) {
      return die(state, 'wall');
    }

    const ateFood = sameCell(next, state.food);
    const ateStar = sameCell(next, state.star);
    const grows = ateFood || ateStar;
    // si no crece la cola se mueve, así que se vale entrar donde está la cola
    const body = grows ? state.snake : state.snake.slice(0, -1);
    if (body.some((c) => sameCell(c, next))) return die(state, 'self');

    state.prev = cloneCells(state.snake);
    state.snake.unshift(next);
    if (!grows) state.snake.pop();
    state.ticks++;

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

    if (ateFood) {
      state.score += 1;
      speedUp(state);
      events.push({ type: 'eat', points: 1, x: next.x, y: next.y });

      state.food = null;
      state.food = randomFreeCell(state);
      if (!state.food) {
        // no queda espacio: ganaste
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
  // para poder probarlo con node
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
