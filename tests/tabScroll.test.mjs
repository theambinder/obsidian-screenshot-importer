import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabScroll } from '../public/tabScroll.js';

function fixture() {
  let active = 'screenshots';
  let y = 0;
  let renders = 0;
  const heights = { screenshots: 4000, history: 2000, settings: 300 };
  const writes = [];
  const writeScroll = (top) => { y = Math.min(top, heights[active]); writes.push(y); };
  const scroll = createTabScroll({ initialTab: active, readScroll: () => y, writeScroll });
  return {
    scroll, heights, writes,
    position: () => y,
    renderCount: () => renders,
    move: (top) => { y = top; },
    activate(tab, options) {
      return scroll.activate(tab, () => {
        active = tab;
        y = Math.min(y, heights[tab]);
        renders += 1;
      }, options);
    },
  };
}

test('each tab first opens at the top and restores its own last scroll position', () => {
  const f = fixture();
  f.move(3200);
  f.activate('history');
  assert.equal(f.position(), 0);
  f.move(1400);
  f.activate('settings');
  assert.equal(f.position(), 0);
  f.move(210);
  f.activate('screenshots');
  assert.equal(f.position(), 3200, 'Save before a shorter tab clamps the viewport');
  f.activate('history');
  assert.equal(f.position(), 1400);
  f.activate('settings');
  assert.equal(f.position(), 210);
});

test('a single click on the active tab does not scroll or reload it', () => {
  const f = fixture();
  f.move(500);
  assert.equal(f.activate('screenshots'), false);
  assert.equal(f.position(), 500);
  assert.equal(f.renderCount(), 0);
  assert.deepEqual(f.writes, []);
});

test('double-clicks reset only the clicked tab after both normal click events', () => {
  const f = fixture();
  f.move(1200);
  f.activate('history');
  f.move(900);
  f.activate('screenshots');
  f.activate('history');
  assert.equal(f.position(), 900);
  assert.equal(f.activate('history'), false);
  const renders = f.renderCount();
  assert.equal(f.activate('history', { toTop: true }), false);
  assert.equal(f.renderCount(), renders);
  assert.equal(f.position(), 0);
  f.activate('screenshots');
  assert.equal(f.position(), 1200);
  f.activate('history');
  assert.equal(f.position(), 0);
});

test('an active-panel refresh restores the position from response time, not request time', () => {
  const f = fixture();
  f.activate('history');
  f.move(400);
  f.activate('screenshots');
  f.activate('history');
  f.move(900);
  f.scroll.refresh('history', () => f.move(0));
  assert.equal(f.position(), 900);
  f.activate('history', { toTop: true });
  f.scroll.refresh('history', () => f.move(200));
  assert.equal(f.position(), 0, 'A late refresh must not undo double-click to top');
});

test('a delayed refresh of a hidden panel never scrolls the active panel', () => {
  const f = fixture();
  f.activate('history');
  f.move(1000);
  f.activate('screenshots');
  f.move(2500);
  const writes = f.writes.length;
  let rendered = false;
  f.scroll.refresh('history', () => { rendered = true; });
  assert.equal(rendered, true);
  assert.equal(f.writes.length, writes);
  assert.equal(f.position(), 2500);
  f.activate('history');
  assert.equal(f.position(), 1000);
});

test('positions clamp to shorter content and ignore negative elastic overscroll', () => {
  const f = fixture();
  f.move(-30);
  f.activate('history');
  f.activate('screenshots');
  assert.equal(f.position(), 0);
  f.move(3500);
  f.activate('history');
  f.heights.screenshots = 600;
  f.activate('screenshots');
  assert.equal(f.position(), 600);
  f.activate('history');
  f.heights.screenshots = 4000;
  f.activate('screenshots');
  assert.equal(f.position(), 600, 'Use the last visible position, not an obsolete offset');
});

test('a new app session starts with no saved positions', () => {
  const old = fixture();
  old.activate('history');
  old.move(1900);
  old.activate('screenshots');
  const fresh = fixture();
  fresh.activate('history');
  assert.equal(fresh.position(), 0);
});
