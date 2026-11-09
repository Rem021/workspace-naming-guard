// Orca's plugin host API: workspace.list, agents.list, workspace.readContext and workspace.rename.
// Each call is checked against the capabilities in orca-plugin.json, so the plugin never needs
// Orca's private runtime token, the runtime socket, or files under Orca's application data.

let host = null;

function call(method, params = {}) {
  if (!host) throw new Error('not_activated');
  return host.host.call(method, params);
}

/** workspace.rename arrived in host API 1.5; older Orca builds do not offer it. */
export function renameSupported(orca = host) {
  return typeof orca?.host?.has === 'function' && orca.host.has('workspace.rename');
}

/** Workspaces as core.mjs reads them: `repoId` and the repo's `displayName` are the project name. */
export function toWorktrees(workspaces) {
  return workspaces
    .filter(w => typeof w.project === 'string' && w.project.trim())
    .map(w => ({
      id: w.id,
      repoId: w.project,
      path: w.path,
      // null means this machine on hosts that do not record one.
      hostId: w.hostId ?? 'local',
      branch: w.branch ?? undefined,
      displayName: w.name
    }));
}

async function listWorktrees() {
  const { workspaces } = await call('workspace.list');
  return toWorktrees(workspaces);
}

/** The focused workspace's agent titles. Orca reports agents of the focused workspace only, so a
 * workspace is named once it has been focused with an agent in it. */
async function focusedSnapshots(worktrees) {
  const context = await call('workspace.readContext');
  if (!context) return [];
  // readContext has no id: the focused workspace is the one listed with its name and branch.
  const matches = worktrees.filter(w => w.displayName === context.displayName && (w.branch ?? '') === (context.branch ?? ''));
  if (matches.length !== 1) return [];
  const { agents } = await call('agents.list');
  const titles = agents.map(a => a.title).filter(t => typeof t === 'string' && t.trim());
  return [{ worktree: matches[0].id, tabs: titles.map(title => ({ type: 'agent-session', title })) }];
}

export const adapter = {
  bind(orca) {
    host = orca;
  },
  async tabsOnly() {
    return focusedSnapshots(await listWorktrees());
  },
  async snapshot(preloadedSnapshots = null) {
    const worktrees = await listWorktrees();
    const projects = [...new Set(worktrees.map(w => w.repoId))];
    return {
      worktrees,
      repos: projects.map(name => ({ id: name, displayName: name })),
      snapshots: preloadedSnapshots ?? (await focusedSnapshots(worktrees))
    };
  },
  async current(id) {
    return (await listWorktrees()).find(w => w.id === id) ?? null;
  },
  async rename(id, name) {
    await call('workspace.rename', { workspaceId: id, name });
    // applyPlan reads the name back with current().
    return null;
  }
};
