'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const sessions = require('../server/sessions');

// Track created session IDs so we can clean up after each test
const createdIds = [];

afterEach(() => {
  // Kill any remaining sessions created during tests
  for (const id of createdIds) {
    try {
      const session = sessions.get(id);
      if (session) {
        sessions.kill(id);
      }
    } catch {
      // Already killed or exited, ignore
    }
  }
  createdIds.length = 0;
});

describe('sessions', () => {
  it('list returns empty array initially', () => {
    const result = sessions.list();
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 0);
  });

  it('create spawns PTY and adds session to registry', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/echo',
      args: ['hello'],
      cols: 80,
      rows: 24,
    });

    createdIds.push(result.id);

    assert.ok(result.id, 'should have an id');
    assert.strictEqual(result.repoName, 'test-repo');
    assert.strictEqual(result.repoPath, '/tmp');
    assert.ok(typeof result.pid === 'number', 'should have a numeric pid');
    assert.ok(result.createdAt, 'should have a createdAt timestamp');
    assert.strictEqual(result.pty, undefined, 'should not expose pty object');

    const list = sessions.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, result.id);
  });

  it('get returns session by id', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/echo',
      args: ['hello'],
    });

    createdIds.push(result.id);

    const session = sessions.get(result.id);
    assert.ok(session, 'should return the session');
    assert.strictEqual(session.id, result.id);
    assert.strictEqual(session.repoName, 'test-repo');
    assert.ok(session.pty, 'get should include the pty object');
  });

  it('get returns undefined for nonexistent id', () => {
    const session = sessions.get('nonexistent-id-12345');
    assert.strictEqual(session, undefined);
  });

  it('kill removes session from registry', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/echo',
      args: ['hello'],
    });

    createdIds.push(result.id);

    sessions.kill(result.id);
    // Remove from tracking since it's already killed
    createdIds.splice(createdIds.indexOf(result.id), 1);

    const session = sessions.get(result.id);
    assert.strictEqual(session, undefined, 'session should be removed after kill');

    const list = sessions.list();
    assert.ok(!list.some((s) => s.id === result.id), 'killed session should not appear in list');
  });

  it('kill throws for nonexistent session', () => {
    assert.throws(
      () => sessions.kill('nonexistent-id'),
      /Session not found/,
    );
  });

  it('resize throws for nonexistent session', () => {
    assert.throws(
      () => sessions.resize('nonexistent-id', 100, 40),
      /Session not found/,
    );
  });
});
