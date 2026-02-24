import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import * as sessions from '../server/sessions.js';

// Track created session IDs so we can clean up after each test
const createdIds: string[] = [];

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
    assert.strictEqual('pty' in result, false, 'should not expose pty object');

    const list = sessions.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0]?.id, result.id);
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

  it('write sends data to PTY stdin', (_, done) => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/cat',
      args: [],
      cols: 80,
      rows: 24,
    });

    createdIds.push(result.id);

    const session = sessions.get(result.id);
    assert.ok(session);

    let output = '';
    session.pty.onData((data) => {
      output += data;
      if (output.includes('hello')) {
        done();
      }
    });

    sessions.write(result.id, 'hello');
  });

  it('write throws for nonexistent session', () => {
    assert.throws(
      () => sessions.write('nonexistent-id', 'data'),
      /Session not found/,
    );
  });

  it('session starts as not idle', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/cat',
      args: [],
    });
    createdIds.push(result.id);
    const session = sessions.get(result.id);
    assert.ok(session);
    assert.strictEqual(session.idle, false);
  });

  it('list includes idle field', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/cat',
      args: [],
    });
    createdIds.push(result.id);
    const list = sessions.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0]?.idle, false);
  });

  it('type defaults to worktree when not specified', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/echo',
      args: ['hello'],
    });
    createdIds.push(result.id);
    assert.strictEqual(result.type, 'worktree');

    const session = sessions.get(result.id);
    assert.ok(session);
    assert.strictEqual(session.type, 'worktree');
  });

  it('type is set to repo when specified', () => {
    const result = sessions.create({
      type: 'repo',
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/echo',
      args: ['hello'],
    });
    createdIds.push(result.id);
    assert.strictEqual(result.type, 'repo');

    const session = sessions.get(result.id);
    assert.ok(session);
    assert.strictEqual(session.type, 'repo');
  });

  it('list includes type field', () => {
    const r1 = sessions.create({
      type: 'repo',
      repoName: 'repo-a',
      repoPath: '/tmp/a',
      command: '/bin/echo',
      args: ['hello'],
    });
    createdIds.push(r1.id);

    const r2 = sessions.create({
      type: 'worktree',
      repoName: 'repo-b',
      repoPath: '/tmp/b',
      command: '/bin/echo',
      args: ['hello'],
    });
    createdIds.push(r2.id);

    const list = sessions.list();
    const repoSession = list.find(function (s) { return s.id === r1.id; });
    const wtSession = list.find(function (s) { return s.id === r2.id; });

    assert.ok(repoSession);
    assert.strictEqual(repoSession.type, 'repo');
    assert.ok(wtSession);
    assert.strictEqual(wtSession.type, 'worktree');
  });

  it('findRepoSession returns undefined when no repo sessions exist', () => {
    const result = sessions.findRepoSession('/tmp');
    assert.strictEqual(result, undefined);
  });

  it('findRepoSession returns repo session matching repoPath', () => {
    const created = sessions.create({
      type: 'repo',
      repoName: 'test-repo',
      repoPath: '/tmp/my-repo',
      command: '/bin/echo',
      args: ['hello'],
    });
    createdIds.push(created.id);

    const found = sessions.findRepoSession('/tmp/my-repo');
    assert.ok(found, 'should find the repo session');
    assert.strictEqual(found.id, created.id);
    assert.strictEqual(found.type, 'repo');
  });

  it('findRepoSession ignores worktree sessions at same path', () => {
    const created = sessions.create({
      type: 'worktree',
      repoName: 'test-repo',
      repoPath: '/tmp/my-repo',
      command: '/bin/echo',
      args: ['hello'],
    });
    createdIds.push(created.id);

    const found = sessions.findRepoSession('/tmp/my-repo');
    assert.strictEqual(found, undefined, 'should not match worktree sessions');
  });

  it('branchName defaults to worktreeName when not specified', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      worktreeName: 'dy-feat-my-feature',
      command: '/bin/echo',
      args: ['hello'],
    });
    createdIds.push(result.id);
    assert.strictEqual(result.branchName, 'dy-feat-my-feature');
  });

  it('branchName is set independently from worktreeName', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      worktreeName: 'dy-feat-my-feature',
      branchName: 'dy/feat/my-feature',
      command: '/bin/echo',
      args: ['hello'],
    });
    createdIds.push(result.id);
    assert.strictEqual(result.worktreeName, 'dy-feat-my-feature');
    assert.strictEqual(result.branchName, 'dy/feat/my-feature');
  });

  it('list includes branchName field', () => {
    const result = sessions.create({
      repoName: 'test-repo',
      repoPath: '/tmp',
      worktreeName: 'my-wt',
      branchName: 'feat/my-branch',
      command: '/bin/echo',
      args: ['hello'],
    });
    createdIds.push(result.id);
    const list = sessions.list();
    const session = list.find(s => s.id === result.id);
    assert.ok(session);
    assert.strictEqual(session.branchName, 'feat/my-branch');
  });

  it('branchName defaults to empty string when neither branchName nor worktreeName provided', () => {
    const result = sessions.create({
      type: 'repo',
      repoName: 'test-repo',
      repoPath: '/tmp',
      command: '/bin/echo',
      args: ['hello'],
    });
    createdIds.push(result.id);
    assert.strictEqual(result.branchName, '');
  });
});
