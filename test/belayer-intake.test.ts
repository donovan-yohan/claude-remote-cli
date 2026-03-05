import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextSource, resolveTaskSource } from '../server/belayer/intake.js';

test('TextSource.canHandle returns true for any non-empty string', () => {
  const source = new TextSource();
  assert.equal(source.canHandle('hello world'), true);
  assert.equal(source.canHandle(''), false);
});

test('TextSource.name is "text"', () => {
  const source = new TextSource();
  assert.equal(source.name, 'text');
});

test('TextSource.fetch extracts title from first line', async () => {
  const source = new TextSource();
  const spec = await source.fetch('Add expense export feature\nShould export to CSV and PDF');
  assert.equal(spec.source, 'text');
  assert.equal(spec.title, 'Add expense export feature');
  assert.equal(spec.description, 'Should export to CSV and PDF');
});

test('TextSource.fetch handles single-line input', async () => {
  const source = new TextSource();
  const spec = await source.fetch('Fix the login bug');
  assert.equal(spec.title, 'Fix the login bug');
  assert.equal(spec.description, 'Fix the login bug');
});

test('TextSource.fetch trims whitespace', async () => {
  const source = new TextSource();
  const spec = await source.fetch('  Trim me  \n  Some description  ');
  assert.equal(spec.title, 'Trim me');
  assert.equal(spec.description, 'Some description');
});

test('TextSource.fetch handles multi-line descriptions', async () => {
  const source = new TextSource();
  const spec = await source.fetch('Title\nLine 1\nLine 2\nLine 3');
  assert.equal(spec.title, 'Title');
  assert.equal(spec.description, 'Line 1\nLine 2\nLine 3');
});

test('resolveTaskSource returns TextSource for plain text', () => {
  const source = resolveTaskSource('Just some text');
  assert.equal(source.name, 'text');
});

test('resolveTaskSource throws for empty input', () => {
  assert.throws(() => resolveTaskSource(''), /No task source can handle empty input/);
});
