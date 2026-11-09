import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapter, toWorktrees } from './adapter.mjs';

function fakeOrca(workspaces, context, agents) {
  const calls = [];
  return {
    calls,
    host: {
      has: () => true,
      call: async (method, params) => {
        calls.push([method, params]);
        if (method === 'workspace.list') return { workspaces, truncated: false };
        if (method === 'workspace.readContext') return context;
        if (method === 'agents.list') return { agents };
        if (method === 'workspace.rename') return { name: params.name };
        throw new Error(`unexpected ${method}`);
      }
    }
  };
}

const ws = (over = {}) => ({ id: 'identity:a', kind: 'worktree', name: 'codex/mojarra', project: 'Mac', path: '/Users/me/wt/mojarra', branch: 'codex/mojarra', hostId: null, ...over });

test('maps host workspaces to the shape core.mjs reads, skipping folders outside a project', () => {
  assert.deepEqual(toWorktrees([ws(), ws({ id: 'folder:x', kind: 'folder', project: null })]), [
    { id: 'identity:a', repoId: 'Mac', path: '/Users/me/wt/mojarra', hostId: 'local', branch: 'codex/mojarra', displayName: 'codex/mojarra' }
  ]);
});

test('reads agent titles of the focused workspace and renames through workspace.rename', async () => {
  const orca = fakeOrca([ws(), ws({ id: 'identity:b', name: 'other', branch: 'other' })], { displayName: 'codex/mojarra', branch: 'codex/mojarra', terminals: [] }, [{ title: 'Mac｜相机任务规划' }, { title: null }]);
  adapter.bind(orca);
  const s = await adapter.snapshot();
  assert.deepEqual(s.repos, [{ id: 'Mac', displayName: 'Mac' }]);
  assert.deepEqual(s.snapshots, [{ worktree: 'identity:a', tabs: [{ type: 'agent-session', title: 'Mac｜相机任务规划' }] }]);
  await adapter.rename('identity:a', 'Mac｜相机任务规划');
  assert.deepEqual(orca.calls.at(-1), ['workspace.rename', { workspaceId: 'identity:a', name: 'Mac｜相机任务规划' }]);
  assert.ok(orca.calls.every(([method]) => ['workspace.list', 'workspace.readContext', 'agents.list', 'workspace.rename'].includes(method)));
});

test('reads no titles when the focused workspace cannot be told apart', async () => {
  adapter.bind(fakeOrca([ws(), ws({ id: 'identity:b' })], { displayName: 'codex/mojarra', branch: 'codex/mojarra', terminals: [] }, [{ title: 'Mac｜x y' }]));
  assert.deepEqual((await adapter.snapshot()).snapshots, []);
});
