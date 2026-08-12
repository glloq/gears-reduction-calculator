const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function bootWorker() {
  const messages = [], workerDirectory = path.resolve('js/core');
  const context = vm.createContext({ console, Math, Date, JSON, Number, Object, Array, Set, Map, isFinite,
    postMessage: message => messages.push(message) });
  context.self = context;
  context.importScripts = (...files) => files.forEach(file => {
    const filename = path.resolve(workerDirectory, file);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  });
  const workerFile = path.join(workerDirectory, 'worker.js');
  vm.runInContext(fs.readFileSync(workerFile, 'utf8'), context, { filename: workerFile });
  return { context, messages };
}

function rotaryParams() {
  return { rapportCible: 3, dentMenanteMin: 10, dentMenanteMax: 10, dentMeneeMin: 30, dentMeneeMax: 30,
    precisionToleree: .01, maxEtages: 1, maxSolutions: 5, maxIterations: 100, allowReductionOnly: true,
    typesActifs: ['spur'], typeParameters: { spur: { module: 1 } }, module: 1, moduleMode: 'fixed',
    vitesseEntree: 1500, coupleEntree: 2, manufacturing: { mode: 'standard' }, constraints: {} };
}

test('actual worker script returns structured rotary solutions', () => {
  const worker = bootWorker(); worker.context.self.onmessage({ data: rotaryParams() });
  const done = worker.messages.find(message => message.type === 'done');
  assert.ok(done); assert.equal(done.solutions.length, 1); assert.equal(done.solutionModels, done.solutions);
  assert.equal(done.solutions[0].ratio, 3); assert.ok(done.solutions[0].mechanical.length); assert.ok(done.stats.tested > 0);
});

test('actual worker script routes the linear objective', () => {
  const worker = bootWorker(), params = rotaryParams();
  Object.assign(params, { objectiveMode: 'rotationTranslation', linearTravelPerRevolutionMm: 20 * Math.PI,
    dentMenanteMin: 20, dentMenanteMax: 20, vitesseEntree: 100, typeParameters: { rack: { faceWidth: 10 } } });
  worker.context.self.onmessage({ data: params });
  const done = worker.messages.find(message => message.type === 'done');
  assert.equal(done.solutions[0].mode, 'rotationTranslation');
  assert.equal(done.solutions[0].stages[0].type, 'rack');
});
