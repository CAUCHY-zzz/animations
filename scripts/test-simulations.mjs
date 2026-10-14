import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function html(name) { return readFileSync(new URL('../' + name, import.meta.url), 'utf8'); }

// Run the actual page script with a minimal DOM. Advance time explicitly;
// drawing calls and animation scheduling never depend on wall-clock timing.
{
  const source = html('random-walk.html');
  const ids = new Set([...source.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const elements = new Map(), documentEvents = {}, windowEvents = {}, timers = new Map();
  let now = 0, nextTimer = 0;
  const canvasContext = new Proxy({}, { get: (target, key) => target[key] ?? ((...args) => {
    for (const value of args) if (typeof value === 'number') assert(Number.isFinite(value), '画布参数必须有限');
  }) });
  function element(id) {
    assert(ids.has(id), `未知页面元素：${id}`);
    if (!elements.has(id)) elements.set(id, {
      value: id === 'speed' ? '12' : id === 'precision' ? 'auto' : '',
      events: {}, getContext: () => canvasContext,
      getBoundingClientRect: () => ({ width: 1280, height: 800 }),
      addEventListener(type, handler) { this.events[type] = handler; },
      setAttribute() {}, setPointerCapture() {}, focus() {}
    });
    return elements.get(id);
  }
  const sandbox = {
    document: { body: { dataset: { mode: '2' } }, getElementById: element, addEventListener(type, handler) { documentEvents[type] = handler; } },
    performance: { now: () => now }, devicePixelRatio: 1, innerHeight: 800,
    ResizeObserver: class { observe() {} },
    setTimeout(handler) { const id = ++nextTimer; timers.set(id, handler); return id; },
    clearTimeout(id) { timers.delete(id); }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    addEventListener(type, handler) { windowEvents[type] = handler; }
  };
  vm.createContext(sandbox);
  const run = code => vm.runInContext(code, sandbox);
  run(source.match(/<script>([\s\S]*?)<\/script>/)[1]);
  run('Math.random = () => 0');
  now = 1000; documentEvents.visibilitychange();
  assert.equal(run('walkers[0].steps'), 12);
  assert.equal(run('walkers[1].steps'), 0);
  assert.equal(element('position').textContent, '(12, 0)');
  element('precision').value = '0.5'; element('precision').onchange();
  now = 1500; element('switch').onclick();
  assert.equal(run('mode'), 3);
  assert.equal(run('walkers[1].steps'), 0);
  assert.equal(element('position').textContent, '(0, 0, 0)');
  assert.equal(run('gridPrecision'), 0.5);
  assert.equal(timers.size, 1, '切换后只能保留一个步进计时器');
  run('Math.random = () => 0.8');
  now = 2000; documentEvents.visibilitychange();
  assert.equal(run('walkers[1].z'), 6, '三维游走允许沿 z 轴前进');
  assert.equal(run('walkers[0].steps'), 12, '未选择的维度不能推进');
  element('switch').onclick();
  assert.equal(run('walkers[0].steps'), 0);
  assert.equal(run('walkers[0].length'), 1);
  run('Math.random = () => 0');
  for (let i = 0; i < 600; i++) { now += 1000; documentEvents.visibilitychange(); }
  assert.equal(run('walkers[0].steps'), 7200);
  for (let i = 0; i < 400; i++) { now += 1000; documentEvents.visibilitychange(); }
  assert.equal(run('walkers[0].steps'), 12000);
  assert.equal(run('walkers[0].length'), 10001, '10,000 段轨迹只需 10,001 个点');
  assert.equal(run('walkers[0].point(0)[0]'), 2000, '丢弃最早的轨迹点');
  assert.equal(run('walkers[0].point(10000)[0]'), 12000);
  windowEvents.pagehide(); assert.equal(timers.size, 0);
  console.log('PASS 随机游走：仅当前维度运行、切换归零、三维方向、设置保留、轨迹容量与关闭计时器');
}

// Load the model exposed by the flock page itself, without starting its UI.
const flockSource = html('鸟群涌现.html').match(/<script>([\s\S]*?)<\/script>/)[1];
const modelEnd = flockSource.indexOf('})(typeof globalThis');
assert(modelEnd >= 0, '没有找到鸟群模型导出边界');
const end = flockSource.indexOf(';', modelEnd) + 1;
const modelContext = { module: { exports: {} } };
vm.createContext(modelContext);
vm.runInContext(flockSource.slice(0, end), modelContext);
const { Flock, K } = modelContext.module.exports;
assert.equal(K, 7);

const options = { walls: false, noise: 0, minSpeed: 0, maxSpeed: 1000, maxForce: 1000 };
function pair(parameters = {}) {
  const flock = new Flock(2, 1, { ...options, ...parameters });
  flock.x.set([-30, 30]); flock.y.fill(0); flock.z.fill(0);
  flock.vx.fill(0); flock.vy.fill(70); flock.vz.fill(0);
  return flock;
}
{
  const flock = new Flock(192, 52);
  for (let i = 0; i < 60; i++) flock.step();
  flock.buildGrid();
  for (let i = 0; i < flock.n; i += 11) {
    const ids = new Int32Array(K), distances = new Float64Array(K);
    const count = flock.nearest(i, ids, distances), expected = [];
    for (let j = 0; j < flock.n; j++) if (i !== j) {
      const distance = (flock.x[j] - flock.x[i]) ** 2 + (flock.y[j] - flock.y[i]) ** 2 + (flock.z[j] - flock.z[i]) ** 2;
      if (distance < flock.params.vision ** 2) expected.push([j, distance]);
    }
    expected.sort((a, b) => a[1] - b[1]);
    assert.deepEqual([...ids.slice(0, count)].sort((a, b) => a - b), expected.slice(0, K).map(x => x[0]).sort((a, b) => a - b));
  }
  console.log('PASS 鸟群邻居：空间索引与独立的全量距离搜索一致，最多 7 只');
}
{
  const separation = pair({ alignment: 0, cohesion: 0 }); separation.x.set([-3, 3]); separation.step();
  assert(separation.vx[0] < 0 && separation.vx[1] > 0);
  const alignment = pair({ cohesion: 0, repulsion: 0 }); alignment.vx.set([70, 0]); alignment.vy.set([0, 70]); alignment.step();
  assert(alignment.vy[0] > 0 && alignment.vx[1] > 0);
  const cohesion = pair({ alignment: 0, repulsion: 0 }); cohesion.step();
  assert(cohesion.vx[0] > 0 && cohesion.vx[1] < 0);
  const isolated = pair(); isolated.x.set([-400, 400]);
  const before = [...isolated.vx, ...isolated.vy, ...isolated.vz]; isolated.step();
  assert.deepEqual([...isolated.vx, ...isolated.vy, ...isolated.vz], before);
  console.log('PASS 鸟群局部规则：避碰、对齐、聚拢，以及远处个体互不影响');
}
{
  const flock = new Flock(256, 64);
  const capacities = [flock.head.length, flock.next.length, flock.neighbors.length];
  flock.setPredator(true);
  for (let i = 0; i < 20; i++) flock.disturb(i, 0, 0);
  assert.equal(flock.pulses.length, 8, '扰动历史限制容量');
  for (let i = 0; i < 1200; i++) flock.step();
  assert(flock.time > 39.99, '应持续演化超过早期十秒动画的时长');
  assert.equal(flock.pulses.length, 0, '局部扰动应该过期');
  assert.deepEqual([flock.head.length, flock.next.length, flock.neighbors.length], capacities);
  for (let i = 0; i < flock.n; i++) {
    for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz']) assert(Number.isFinite(flock[key][i]));
    const speed = Math.hypot(flock.vx[i], flock.vy[i], flock.vz[i]);
    assert(speed >= flock.params.minSpeed - 1e-6 && speed <= flock.params.maxSpeed + 1e-6);
    assert(flock.neighborCount[i] <= K);
  }
  console.log('PASS 鸟群持续仿真：有限坐标、速度上下限、固定缓冲区、扰动过期与隼');
}
