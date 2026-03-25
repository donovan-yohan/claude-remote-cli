import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractOwnerRepo } from '../server/git.js';

describe('extractOwnerRepo', () => {
  it('parses an SSH URL with .git suffix', () => {
    assert.equal(
      extractOwnerRepo('git@github.com:donovan-yohan/claude-remote-cli.git'),
      'donovan-yohan/claude-remote-cli',
    );
  });

  it('parses an SSH URL without .git suffix', () => {
    assert.equal(
      extractOwnerRepo('git@github.com:owner/repo'),
      'owner/repo',
    );
  });

  it('parses an HTTPS URL with .git suffix', () => {
    assert.equal(
      extractOwnerRepo('https://github.com/owner/repo.git'),
      'owner/repo',
    );
  });

  it('parses an HTTPS URL without .git suffix', () => {
    assert.equal(
      extractOwnerRepo('https://github.com/owner/repo'),
      'owner/repo',
    );
  });

  it('is host-agnostic and parses a non-GitHub HTTPS URL', () => {
    assert.equal(
      extractOwnerRepo('https://gitlab.com/owner/repo.git'),
      'owner/repo',
    );
  });

  it('returns null for an empty string', () => {
    assert.equal(extractOwnerRepo(''), null);
  });

  it('returns null for a malformed URL', () => {
    assert.equal(extractOwnerRepo('not-a-url'), null);
  });
});
