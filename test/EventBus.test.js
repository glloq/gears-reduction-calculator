/**
 * Tests unitaires pour EventBus (pub/sub)
 * @see js/core/EventBus.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, loadModules, CONFIG } = require('./helpers/context');

describe('EventBus', () => {
  let ctx, EventBus, bus;

  beforeEach(() => {
    ctx = createContext();
    loadModules(ctx, [...CONFIG, 'js/core/EventBus.js']);
    EventBus = ctx.GearApp.core.EventBus;
    bus = new EventBus();
  });

  describe('on() + emit()', () => {
    it('appelle le callback quand l\'événement est émis', () => {
      let called = false;
      bus.on('test', () => { called = true; });
      bus.emit('test');
      assert.equal(called, true);
    });

    it('transmet les données au callback', () => {
      let received = null;
      bus.on('data', (d) => { received = d; });
      bus.emit('data', { value: 42 });
      assert.deepEqual(received, { value: 42 });
    });

    it('supporte plusieurs listeners sur le même événement', () => {
      let count = 0;
      bus.on('multi', () => { count++; });
      bus.on('multi', () => { count++; });
      bus.emit('multi');
      assert.equal(count, 2);
    });

    it('ne déclenche pas les listeners d\'autres événements', () => {
      let called = false;
      bus.on('a', () => { called = true; });
      bus.emit('b');
      assert.equal(called, false);
    });
  });

  describe('off()', () => {
    it('supprime un listener spécifique', () => {
      let count = 0;
      const cb = () => { count++; };
      bus.on('evt', cb);
      bus.emit('evt');
      assert.equal(count, 1);
      bus.off('evt', cb);
      bus.emit('evt');
      assert.equal(count, 1); // pas incrémenté
    });

    it('supprime tous les listeners si pas de callback fourni', () => {
      let count = 0;
      bus.on('evt', () => { count++; });
      bus.on('evt', () => { count++; });
      bus.off('evt');
      bus.emit('evt');
      assert.equal(count, 0);
    });

    it('ne plante pas si l\'événement n\'existe pas', () => {
      assert.doesNotThrow(() => {
        bus.off('inexistant', () => {});
      });
    });
  });

  describe('chaînage', () => {
    it('on() retourne l\'instance pour le chaînage', () => {
      const result = bus.on('x', () => {});
      assert.equal(result, bus);
    });

    it('off() retourne l\'instance pour le chaînage', () => {
      const result = bus.off('x', () => {});
      assert.equal(result, bus);
    });

    it('emit() retourne l\'instance pour le chaînage', () => {
      const result = bus.emit('x');
      assert.equal(result, bus);
    });
  });

  describe('cas limites', () => {
    it('emit sans listeners ne plante pas', () => {
      assert.doesNotThrow(() => {
        bus.emit('vide');
        bus.emit('vide', { data: true });
      });
    });

    it('le singleton GearApp.eventBus est une instance d\'EventBus', () => {
      const singleton = ctx.GearApp.eventBus;
      assert.ok(singleton);
      assert.equal(typeof singleton.on, 'function');
      assert.equal(typeof singleton.emit, 'function');
      assert.equal(typeof singleton.off, 'function');
    });
  });
});
