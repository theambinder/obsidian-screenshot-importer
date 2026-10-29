import test from 'node:test';
import assert from 'node:assert/strict';
import { bindQualityInput } from '../public/qualityInput.js';
import { firstReturnedFolder } from '../public/reportNavigation.js';

class QualityInput extends EventTarget {
  constructor(value) { super(); this.nativeValue = value; this.writes = 0; }
  get value() { return this.nativeValue; }
  set value(value) { this.writes++; this.nativeValue = value; }
  edit(value, type) { this.nativeValue = value; this.dispatchEvent(new Event(type)); }
}

test('repeated native Quality steps keep the input and valid values untouched', () => {
  const input = new QualityInput('90'), applied = [];
  bindQualityInput(input, { apply: (value) => applied.push(value), fallback: () => 50 });
  for (const value of ['89', '88', '87', '88', '89']) {
    input.edit(value, 'input'); input.edit(value, 'change');
    assert.equal(applied.at(-1), Number(value));
    assert.equal(input.value, value);
  }
  assert.equal(input.writes, 0, 'Do not assign the active value or recreate its native control');
});

test('Quality typing permits empty and intermediate drafts without forcing a replacement value', () => {
  const input = new QualityInput('90'), applied = [];
  bindQualityInput(input, { apply: (value) => applied.push(value), fallback: () => 50 });
  for (const value of ['', '-', '0', '101', '25.5']) {
    input.edit(value, 'input');
    assert.equal(input.value, value);
  }
  assert.deepEqual(applied, []);
  input.edit('1', 'input'); input.edit('10', 'input'); input.edit('100', 'input');
  assert.deepEqual(applied, [1, 10, 100]);
  assert.equal(input.writes, 0);
});

test('Quality commit clamps invalid values and restores the category fallback for blank input', () => {
  const input = new QualityInput('90'), applied = [];
  bindQualityInput(input, { apply: (value) => applied.push(value), fallback: () => 50 });
  for (const [draft, expected] of [['101', 100], ['-3', 1], ['25.6', 26], ['', 50], ['invalid', 50]]) {
    input.edit(draft, 'change');
    assert.equal(input.value, String(expected));
    assert.equal(applied.at(-1), expected);
  }
});

test('rollback navigation chooses a returned folder in the current table order without selecting it', () => {
  const folders = [{ name: 'Unrelated', enabled: false }, { name: '[Release] Show S1E2', enabled: false }, { name: 'Show S1E1', enabled: false }];
  const before = structuredClone(folders);
  const returned = ['Show S1E1', '[Release] Show S1E2'];
  assert.equal(firstReturnedFolder(folders, returned), folders[1]);
  assert.deepEqual(folders, before);
  assert.deepEqual(returned, ['Show S1E1', '[Release] Show S1E2']);
});

test('rollback navigation handles partial restores, absent folders, and individual targets', () => {
  const folders = [{ name: 'Show 1' }, { name: 'Show 2' }];
  assert.equal(firstReturnedFolder(folders, ['Missing', 'Show 2']), folders[1]);
  assert.equal(firstReturnedFolder(folders, ['Missing']), null);
  assert.equal(firstReturnedFolder(folders), null);
  assert.equal(firstReturnedFolder([], ['Show 1']), null);
});
