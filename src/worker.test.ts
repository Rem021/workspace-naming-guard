// Runs src/worker.ts's activate(orca) over Orca's mock host, with workspace.list and
// workspace.rename backed by an in-memory sidebar.
import { assert, hostError, mockHost, mountWorker, test } from 'orca/testing'
import type { JsonValue } from 'orca'
import * as main from './worker.ts'
import type { Workspace } from './core.ts'

const ws = (id: string, name: string, over: Partial<Workspace> = {}): Workspace => ({
  id,
  kind: 'folder',
  name,
  project: 'Mac',
  path: `/Users/me/Mac/${id}`,
  branch: null,
  hostId: 'local',
  ...over
})

function sidebar(
  initial: Workspace[],
  options: { settings?: Record<string, JsonValue>; storage?: Record<string, JsonValue>; failRename?: string; failFor?: string; truncated?: () => boolean; hidden?: () => string[] } = {}
) {
  const workspaces = initial.map((w) => ({ ...w }))
  const host = mockHost({
    settings: options.settings,
    storage: options.storage,
    results: {
      'workspace.list': () => {
        const hidden = new Set(options.hidden?.() ?? [])
        const truncated = options.truncated?.() ?? false
        const listed = workspaces.filter((w) => !hidden.has(w.id))
        return { workspaces: (truncated ? listed.slice(0, 1) : listed).map((w) => ({ ...w })), truncated }
      },
      'workspace.rename': ({ workspaceId, name }: { workspaceId: string; name: string }) => {
        if (options.failRename && (!options.failFor || options.failFor === workspaceId)) throw hostError(options.failRename)
        const w = workspaces.find((x) => x.id === workspaceId)
        if (!w) throw hostError('invalid_params', 'no such workspace')
        w.name = name
        return { name }
      }
    }
  })
  const named = (id: string) => workspaces.find((w) => w.id === id)?.name
  return { host, workspaces, named }
}

test('first run only records what exists, and offers suggestions instead of renaming', async () => {
  const s = sidebar([ws('old', 'Fix auth token refresh'), ws('root', 'main', { kind: 'worktree', branch: 'main' })])
  const worker = await mountWorker(main, { host: s.host })
  try {
    const view = await worker.request('naming.check')
    assert.equal(view.status, 'active')
    assert.deepEqual(s.host.callsOf('workspace.rename'), [])
    assert.deepEqual(view.suggestions, [{ id: 'old', current: 'Fix auth token refresh', proposed: 'Mac｜Fix auth token refresh', reason: 'agent-title' }])
    const state = s.host.data().storage['state-v2'] as { baseline: string[] }
    assert.deepEqual(state.baseline, ['old', 'root'])
    assert.deepEqual(worker.refusals, [])
  } finally {
    await worker.deactivate()
  }
})

test('a new workspace waits for Orca’s title, gets the prefix, then is left alone once renamed by hand', async () => {
  const s = sidebar([ws('old', 'Mac｜Existing')])
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')

    s.workspaces.push(ws('new', 'blobfish'))
    await worker.emit('workspace.created', { workspaceId: 'new', kind: 'folder', path: '/Users/me/Mac/new', branch: '' })
    let view = await worker.request('naming.check')
    assert.equal(view.counts.waiting, 1)
    assert.equal(s.named('new'), 'blobfish')

    s.workspaces[1].name = 'Fix login bug' // Orca's own title after the first agent message
    view = await worker.request('naming.check')
    assert.equal(s.named('new'), 'Mac｜Fix login bug')
    assert.equal(view.counts.renamedToday, 1)
    assert.equal(view.history[0].after, 'Mac｜Fix login bug')
    assert.ok(s.host.callsOf('statusBar.update').length > 0)

    s.workspaces[1].name = 'My notes' // the person renames it
    view = await worker.request('naming.check')
    assert.equal(s.named('new'), 'My notes')
    assert.equal(view.counts.locked, 1)
    assert.deepEqual(worker.refusals, [])
  } finally {
    await worker.deactivate()
  }
})

test('undo puts the old name back and locks the workspace', async () => {
  const s = sidebar([])
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    s.workspaces.push(ws('w', 'Agent｜Fix flaky tests'))
    let view = await worker.request('naming.check')
    assert.equal(s.named('w'), 'Mac｜Fix flaky tests')

    view = await worker.request('naming.undo', { key: view.history[0].key })
    assert.equal(s.named('w'), 'Agent｜Fix flaky tests')
    assert.equal(view.history[1].undone, true)
    assert.equal(view.counts.locked, 1)

    view = await worker.request('naming.check')
    assert.equal(s.named('w'), 'Agent｜Fix flaky tests')
  } finally {
    await worker.deactivate()
  }
})

test('suggestions are applied or ignored only on request', async () => {
  const s = sidebar([ws('a', 'Fix auth token refresh'), ws('b', 'Chat｜Release notes draft')])
  const worker = await mountWorker(main, { host: s.host })
  try {
    let view = await worker.request('naming.check')
    assert.equal(view.suggestions.length, 2)

    view = await worker.request('naming.apply', { ids: ['a'] })
    assert.equal(s.named('a'), 'Mac｜Fix auth token refresh')
    view = await worker.request('naming.ignore', { ids: ['b'] })
    assert.equal(s.named('b'), 'Chat｜Release notes draft')
    assert.deepEqual(view.suggestions, [])
    assert.equal(view.counts.locked, 1)
  } finally {
    await worker.deactivate()
  }
})

test('paused: nothing is renamed, and the toggle command resumes with a suggestion', async () => {
  const s = sidebar([], { settings: { enabled: false } })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    s.workspaces.push(ws('w', 'Write the changelog'))
    const view = await worker.request('naming.check')
    assert.equal(view.status, 'paused')
    assert.equal(s.named('w'), 'Write the changelog')

    const line = await worker.command('naming.toggle')
    assert.match(String(line), /is on/)
    // It appeared while paused, so it is only suggested, never renamed on its own.
    assert.equal(s.named('w'), 'Write the changelog')
    assert.deepEqual((await worker.request('naming.view')).suggestions.map((x) => x.id), ['w'])
  } finally {
    await worker.deactivate()
  }
})

test('aliases and standby names come from settings', async () => {
  const s = sidebar([], { settings: { aliases: 'Mac = Desk\nbad line', standbyNames: true } })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    s.workspaces.push(ws('w', 'seagrass'))
    const view = await worker.request('naming.check')
    assert.match(s.named('w') ?? '', /^Desk｜待命工作区 [0-9a-f]{8}$/)
    assert.deepEqual(view.aliasErrors, [{ line: 2, text: 'bad line' }])
    assert.equal(view.counts.waiting, 0)
  } finally {
    await worker.deactivate()
  }
})

test('a rename interrupted by a crash is finished from the write-ahead record', async () => {
  const s = sidebar([ws('w', 'Mac｜Half done')], {
    storage: {
      'state-v2': {
        version: 2,
        baseline: [],
        seen: { w: 1 },
        records: {},
        history: [],
        pending: { id: 'w', before: 'Half done', after: 'Mac｜Half done', reason: 'agent-title', stage: 'final', at: 1 }
      }
    }
  })
  const worker = await mountWorker(main, { host: s.host })
  try {
    const view = await worker.request('naming.check')
    const state = s.host.data().storage['state-v2'] as { pending: unknown; records: Record<string, { name: string }> }
    assert.equal(state.pending, null)
    assert.equal(state.records.w.name, 'Mac｜Half done')
    assert.equal(view.counts.managed, 1)
  } finally {
    await worker.deactivate()
  }
})

test('a failed rename is reported and retried, without stopping the worker', async () => {
  const s = sidebar([], { failRename: 'rate_limited' })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    s.workspaces.push(ws('w', 'Ship the release'))
    const view = await worker.request('naming.check')
    assert.equal(view.status, 'error')
    assert.deepEqual(view.notice, { code: 'rename-failed', detail: 'rate_limited' })
    assert.equal(s.named('w'), 'Ship the release')
    assert.equal(view.suggestions.length, 0)
    const status = await worker.command('naming.status')
    assert.match(String(status), /could not check names \(rate_limited\)/)
  } finally {
    await worker.deactivate()
  }
})

test('a lock survives the workspace missing from one list', async () => {
  let hidden: string[] = []
  const s = sidebar([], { hidden: () => hidden })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    s.workspaces.push(ws('w', 'Fix login bug'))
    await worker.request('naming.check')
    s.workspaces[0].name = 'Scratch notes for Alice'
    let view = await worker.request('naming.check')
    assert.equal(view.counts.locked, 1)

    hidden = ['w'] // an SSH host offline, or Orca still starting
    await worker.request('naming.check')
    hidden = []
    view = await worker.request('naming.check')
    assert.equal(s.named('w'), 'Scratch notes for Alice')
    assert.equal(view.counts.locked, 1)
  } finally {
    await worker.deactivate()
  }
})

test('a workspace that appears or is renamed while paused only gets a suggestion', async () => {
  const s = sidebar([], { settings: { enabled: false } })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    s.workspaces.push(ws('w', 'My own design notes'))
    await worker.request('naming.check')
    const view = await worker.request('naming.setEnabled', { enabled: true })
    assert.equal(s.named('w'), 'My own design notes')
    assert.deepEqual(view.suggestions.map((x) => x.id), ['w'])
  } finally {
    await worker.deactivate()
  }
})

test('a truncated first list does not make old workspaces look new', async () => {
  let truncated = true
  const s = sidebar([ws('a', 'Old task one'), ws('b', 'Old task two')], { truncated: () => truncated })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    truncated = false
    const view = await worker.request('naming.check')
    assert.deepEqual(s.host.callsOf('workspace.rename'), [])
    assert.deepEqual(view.suggestions.map((x) => x.id).sort(), ['a', 'b'])
  } finally {
    await worker.deactivate()
  }
})

test('Apply carries on past a failed rename and says how many failed', async () => {
  const s = sidebar([ws('a', 'First old task'), ws('b', 'Second old task'), ws('c', 'Third old task')], { failRename: 'rate_limited', failFor: 'b' })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    const view = await worker.request('naming.apply', { ids: ['a', 'b', 'c'] })
    assert.equal(s.named('a'), 'Mac｜First old task')
    assert.equal(s.named('b'), 'Second old task')
    assert.equal(s.named('c'), 'Mac｜Third old task')
    assert.deepEqual(view.notice, { code: 'apply-failed', detail: '1/3 · rate_limited' })
  } finally {
    await worker.deactivate()
  }
})

test('an undo cannot itself be undone', async () => {
  const s = sidebar([])
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    s.workspaces.push(ws('w', 'Agent｜Fix flaky tests'))
    let view = await worker.request('naming.check')
    view = await worker.request('naming.undo', { key: view.history[0].key })
    const undoEntry = view.history.find((h) => h.reason === 'undo')
    view = await worker.request('naming.undo', { key: undoEntry?.key ?? '' })
    assert.deepEqual(view.notice, { code: 'already-undone' })
    assert.equal(s.named('w'), 'Agent｜Fix flaky tests')
  } finally {
    await worker.deactivate()
  }
})

function knownState(seen: Record<string, number>, baseline: string[] = []): Record<string, JsonValue> {
  return { 'state-v2': { version: 2, baseline, baselineComplete: true, seen, gone: {}, records: {}, history: [], pending: null } }
}

const title = (id: string, text: string, sourceKey = 'chat:one') => ({ id, title: text, sourceKey })

test('a manual rename between planning and writing is preserved on this and later passes', async () => {
  let reads = 0
  const current = ws('a', 'blobfish')
  const host = mockHost({ storage: knownState({ a: Date.now() }), results: {
    'workspace.list': () => {
      if (++reads === 2) current.name = '手动保留的名字'
      return { workspaces: [{ ...current }], truncated: false }
    },
    'workspace.rename': () => { throw new Error('must not write') }
  } })
  const worker = await mountWorker(main, { host })
  try {
    await worker.request('naming.observeTitles', { titles: [title('a', '自动标题')] })
    await worker.request('naming.check')
    assert.equal(current.name, '手动保留的名字')
    assert.deepEqual(host.callsOf('workspace.rename'), [])
    assert.equal((await worker.request('naming.view')).counts.locked, 1)
  } finally { await worker.deactivate() }
})

test('native chat observations name the exact workspace even when directories are shared and naming is delayed', async () => {
  const s = sidebar([ws('a', 'seacucumber'), ws('b', 'fiddler')], {
    storage: knownState({ a: Date.now() - 2 * 24 * 60 * 60_000, b: Date.now() })
  })
  s.workspaces[1].path = s.workspaces[0].path
  const worker = await mountWorker(main, { host: s.host })
  try {
    const view = await worker.request('naming.observeTitles', { titles: [title('a', 'Mac｜修复自动命名')] })
    assert.equal(s.named('a'), 'Mac｜修复自动命名')
    assert.equal(s.named('b'), 'fiddler')
    assert.equal(view.titleSource, 'connected')
    assert.equal(view.history[0].reason, 'chat-title')
  } finally { await worker.deactivate() }
})

test('same chat may refine its title but a different chat or a manual rename cannot take over', async () => {
  const s = sidebar([ws('a', 'blobfish')], { storage: knownState({ a: Date.now() }) })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.observeTitles', { titles: [title('a', '修复界面')] })
    await worker.request('naming.observeTitles', { titles: [title('a', '修复相机界面')] })
    assert.equal(s.named('a'), 'Mac｜修复相机界面')
    await worker.request('naming.observeTitles', { titles: [title('a', '另一个任务', 'chat:two')] })
    assert.equal(s.named('a'), 'Mac｜修复相机界面')
    s.workspaces[0].name = '我的手动名字'
    const view = await worker.request('naming.observeTitles', { titles: [title('a', '再次修复相机')] })
    assert.equal(s.named('a'), '我的手动名字')
    assert.equal(view.counts.locked, 1)
  } finally { await worker.deactivate() }
})

test('old workspaces need apply, and Undo prevents later chat observations from renaming', async () => {
  const s = sidebar([ws('a', 'cisco')])
  const worker = await mountWorker(main, { host: s.host })
  try {
    let view = await worker.request('naming.observeTitles', { titles: [title('a', 'GitHub｜项目流量分析')] })
    assert.equal(s.named('a'), 'cisco')
    assert.equal(view.suggestions[0].proposed, 'Mac｜项目流量分析')
    view = await worker.request('naming.apply', { ids: ['a'] })
    assert.equal(s.named('a'), 'Mac｜项目流量分析')
    await worker.request('naming.undo', { key: view.history[0].key })
    await worker.request('naming.observeTitles', { titles: [title('a', '新的分析标题')] })
    assert.equal(s.named('a'), 'cisco')
  } finally { await worker.deactivate() }
})

test('plugin branch and standby names can graduate to chat titles; intentional names stay intact', async () => {
  const s = sidebar([], { settings: { standbyNames: true } })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    s.workspaces.push(ws('branch', 'codex/fix-login', { kind: 'worktree', branch: 'codex/fix-login' }), ws('standby', 'blobfish'), ws('manual', '个人｜重要笔记'))
    await worker.request('naming.check')
    assert.equal(s.named('branch'), 'Mac｜Fix login')
    await worker.request('naming.observeTitles', { titles: ['branch', 'standby', 'manual'].map((id) => title(id, '修复登录问题')) })
    assert.equal(s.named('branch'), 'Mac｜修复登录问题')
    assert.equal(s.named('standby'), 'Mac｜修复登录问题')
    assert.equal(s.named('manual'), '个人｜重要笔记')
  } finally { await worker.deactivate() }
})

test('expired observations and default chat labels never rename a workspace', async () => {
  const s = sidebar([ws('a', 'blobfish')])
  const worker = await mountWorker(main, { host: s.host })
  const clock = Date.now
  try {
    await worker.request('naming.observeTitles', { titles: [title('a', 'New Chat')] })
    assert.deepEqual((await worker.request('naming.view')).suggestions, [])
    await worker.request('naming.observeTitles', { titles: [title('a', '修复命名')] })
    Date.now = () => clock() + 121_000
    const view = await worker.request('naming.apply', { ids: ['a'] })
    assert.equal(s.named('a'), 'blobfish')
    assert.equal(view.titleSource, 'disconnected')
  } finally { Date.now = clock; await worker.deactivate() }
})

test('malformed or duplicate title observations are rejected atomically', async () => {
  const s = sidebar([])
  const worker = await mountWorker(main, { host: s.host })
  try {
    await assert.rejects(() => worker.request('naming.observeTitles', { titles: [title('a', '好标题'), title('a', '冲突标题')] }))
    await assert.rejects(() => worker.request('naming.observeTitles', { titles: [title('a', 'x'.repeat(513))] }))
    assert.deepEqual(s.host.callsOf('workspace.rename'), [])
  } finally { await worker.deactivate() }
})

test('a title arriving while paused stays a suggestion after resuming', async () => {
  const s = sidebar([], { settings: { enabled: false } })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    s.workspaces.push(ws('a', 'blobfish'))
    await worker.request('naming.observeTitles', { titles: [title('a', '任务主题')] })
    const view = await worker.request('naming.setEnabled', { enabled: true })
    assert.equal(s.named('a'), 'blobfish')
    assert.equal(view.suggestions[0].proposed, 'Mac｜任务主题')
  } finally { await worker.deactivate() }
})

test('elapsed time and a saved v1.1.1 fallback setting never write standby names', async () => {
  for (const settings of [{}, { fallbackNames: true }] as Record<string, JsonValue>[]) {
    const s = sidebar([ws('late', 'blobfish'), ws('old', 'chiton')], {
      settings, storage: knownState({ late: Date.now() - 61_000, old: Date.now() - 7 * 60 * 60_000 })
    })
    const worker = await mountWorker(main, { host: s.host })
    try {
      const view = await worker.request('naming.check')
      assert.equal(s.named('late'), 'blobfish')
      assert.equal(s.named('old'), 'chiton')
      assert.equal(view.counts.waiting, 2)
      assert.deepEqual(s.host.callsOf('workspace.rename'), [])
    } finally { await worker.deactivate() }
  }
})

test('a delayed real title is still used when timeout fallback is removed', async () => {
  const s = sidebar([ws('late', 'blobfish')], { storage: knownState({ late: Date.now() - 120_000 }) })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    s.workspaces[0].name = 'Fix login bug'
    await worker.request('naming.check')
    assert.equal(s.named('late'), 'Mac｜Fix login bug')
  } finally { await worker.deactivate() }
})

test('a creation event before the first list is not swallowed by the baseline', async () => {
  const s = sidebar([])
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.emit('workspace.created', { workspaceId: 'new', kind: 'folder', path: '/Users/me/Mac/new', branch: '' })
    s.workspaces.push(ws('new', 'Fix new workspace'), ws('old', 'Old project notes'))
    const view = await worker.request('naming.check')
    assert.equal(s.named('new'), 'Mac｜Fix new workspace')
    assert.equal(s.named('old'), 'Old project notes')
    assert.deepEqual(view.suggestions.map((x) => x.id), ['old'])
  } finally { await worker.deactivate() }
})

test('creation evidence survives a truncated list and a delayed row', async () => {
  let truncated = true
  const s = sidebar([ws('old', 'Old project notes')], { truncated: () => truncated })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    await worker.emit('workspace.created', { workspaceId: 'new', kind: 'folder', path: '/Users/me/Mac/new', branch: '' })
    await worker.request('naming.check')
    s.workspaces.push(ws('new', 'Fix new workspace'))
    truncated = false
    await worker.request('naming.check')
    assert.equal(s.named('new'), 'Mac｜Fix new workspace')
    assert.equal(s.named('old'), 'Old project notes')
  } finally { await worker.deactivate() }
})

test('a creation event while paused cannot become automatic when its row appears after resume', async () => {
  const s = sidebar([], { settings: { enabled: false } })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    await worker.emit('workspace.created', { workspaceId: 'new', kind: 'folder', path: '/Users/me/Mac/new', branch: '' })
    await worker.request('naming.setEnabled', { enabled: true })
    s.workspaces.push(ws('new', 'Fix new workspace'))
    const view = await worker.request('naming.check')
    assert.equal(s.named('new'), 'Fix new workspace')
    assert.deepEqual(view.suggestions.map((x) => x.id), ['new'])
  } finally { await worker.deactivate() }
})

test('standby inventory contains only unchanged names owned by this plugin', async () => {
  const records = {
    owned: { name: 'Mac｜Waiting 1234abcd', stage: 'standby', at: 1 },
    edited: { name: 'Mac｜Waiting 5678abcd', stage: 'standby', at: 1 },
    locked: { name: 'Mac｜Waiting 9012abcd', stage: 'standby', at: 1, locked: true }
  }
  const state = { version: 2, baseline: [], seen: {}, records, history: [], pending: null }
  const s = sidebar([ws('owned', records.owned.name), ws('edited', 'Personal notes'), ws('locked', records.locked.name), ws('unowned', 'Mac｜Waiting aabbccdd')], {
    settings: { enabled: false }, storage: { 'state-v2': state }
  })
  const worker = await mountWorker(main, { host: s.host })
  try {
    assert.deepEqual(await worker.request('naming.standbyInventory'), [{ id: 'owned', name: records.owned.name, at: 1 }])
    assert.deepEqual(s.host.callsOf('workspace.rename'), [])
  } finally { await worker.deactivate() }
})

test('creation events use the list identity when raw and listed workspace ids differ', async () => {
  let truncated = true
  const s = sidebar([ws('old', 'Old project notes')], { truncated: () => truncated })
  const worker = await mountWorker(main, { host: s.host })
  try {
    await worker.request('naming.check')
    await worker.emit('workspace.created', { workspaceId: 'raw-id', workspaceListId: 'identity:wt2:local:new', kind: 'worktree', path: '/Users/me/new', branch: '' })
    s.workspaces.push(ws('identity:wt2:local:new', 'Fix new workspace'))
    truncated = false
    await worker.request('naming.check')
    assert.equal(s.named('identity:wt2:local:new'), 'Mac｜Fix new workspace')
  } finally { await worker.deactivate() }
})
