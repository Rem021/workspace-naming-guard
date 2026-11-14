// The plugin's worker. It reads workspace names with `workspace.list` and writes them with
// `workspace.rename` (Orca's plugin API, host API 1.5); it imports nothing from Node, and never
// reads Orca's files, starts programs or uses the network. Orca transpiles this file when it
// loads: no build step.
import type { JsonValue, NamingView } from 'orca'
import type { Disposable, OrcaWorkerApi } from 'orca/worker'
import { parseAliases, planAll, shortHash, type Change, type NameRecord, type Options, type Plan, type Workspace } from './core.ts'

const STATE_KEY = 'state-v2'
const ACTIVE_POLL_MS = 5_000
const IDLE_POLL_MS = 15_000
const CREATED_DEBOUNCE_MS = 400
/** How long a new workspace is watched closely for Orca's agent title. */
const WATCH_NEW_MS = 6 * 60 * 60_000
const MAX_RENAMES_PER_PASS = 10
const HISTORY_LIMIT = 200
const DAY_MS = 24 * 60 * 60_000
const DEFAULT_STANDBY_LABEL = '待命工作区'

type Reason = NamingView['history'][number]['reason']
type HistoryItem = {
  key: string
  id: string
  before: string
  after: string
  reason: Reason
  at: number
  undone?: boolean
}
type State = {
  version: 2
  /** Workspaces that existed when the plugin first ran: suggestions only, never automatic. */
  baseline: string[]
  /** When each newer workspace was first seen. */
  seen: Record<string, number>
  records: Record<string, NameRecord>
  history: HistoryItem[]
  /** Written before each rename so a crash mid-rename is reconciled on the next pass. */
  pending: (Change & { at: number }) | null
}
type Settings = Options & { enabled: boolean; aliasErrors: string[] }

/** Stops the running activation: its timer, its subscriptions and any rename still queued. */
let stopCurrent: (() => void) | null = null

export default function activate(orca: OrcaWorkerApi): void {
  stopCurrent?.()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let lastPlan: Plan = { auto: [], suggestions: [], locks: [], waiting: [] }
  let lastBar = ''
  let view: NamingView = {
    status: 'starting',
    error: null,
    checkedAt: null,
    enabled: true,
    standbyNames: false,
    aliasErrors: [],
    counts: { managed: 0, locked: 0, waiting: 0, renamedToday: 0 },
    suggestions: [],
    history: [],
    notice: null
  }

  /** Passes, applies and undos run one at a time, in order. */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function readSettings(): Promise<Settings> {
    const raw = await orca.settings.get()
    const { aliases, errors } = parseAliases(raw.aliases)
    const label = typeof raw.standbyLabel === 'string' ? raw.standbyLabel.replace(/[｜|]/g, ' ').trim().slice(0, 24) : ''
    return {
      enabled: raw.enabled !== false,
      standbyNames: raw.standbyNames === true,
      standbyLabel: label || DEFAULT_STANDBY_LABEL,
      aliases,
      aliasErrors: errors
    }
  }

  async function loadState(): Promise<State | null> {
    const raw = (await orca.storage.get(STATE_KEY)) as unknown as State | null
    if (!raw || raw.version !== 2 || !Array.isArray(raw.baseline) || !Array.isArray(raw.history)) return null
    return { ...raw, seen: raw.seen ?? {}, records: raw.records ?? {}, pending: raw.pending ?? null }
  }

  const saveState = (state: State) => orca.storage.set(STATE_KEY, state as unknown as JsonValue)

  async function listWorkspaces(): Promise<{ workspaces: Workspace[]; truncated: boolean }> {
    const result = await orca.host.call('workspace.list')
    return { workspaces: result.workspaces as Workspace[], truncated: result.truncated }
  }

  async function rename(state: State, change: Change, record: Partial<NameRecord> = {}): Promise<string> {
    state.pending = { ...change, at: Date.now() }
    await saveState(state)
    try {
      const result = await orca.host.call('workspace.rename', { workspaceId: change.id, name: change.after })
      const actual = typeof result?.name === 'string' ? result.name : change.after
      const at = Date.now()
      state.records[change.id] = { name: actual, stage: change.stage, at, ...record }
      state.history.push({
        key: `${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        id: change.id,
        before: change.before,
        after: actual,
        reason: change.reason,
        at
      })
      state.history = state.history.slice(-HISTORY_LIMIT)
      orca.log(`renamed "${change.before}" -> "${actual}" (${change.reason})`)
      return actual
    } finally {
      state.pending = null
      await saveState(state)
    }
  }

  function buildView(state: State, settings: Settings, status: NamingView['status'], error: string | null, notice: string | null): NamingView {
    const now = Date.now()
    const records = Object.values(state.records)
    const waiting = lastPlan.waiting.filter((id) => now - (state.seen[id] ?? 0) < WATCH_NEW_MS).length
    return {
      status,
      error,
      checkedAt: now,
      enabled: settings.enabled,
      standbyNames: settings.standbyNames,
      aliasErrors: settings.aliasErrors,
      counts: {
        managed: records.filter((r) => !r.locked).length,
        locked: records.filter((r) => r.locked).length,
        waiting,
        renamedToday: state.history.filter((h) => h.reason !== 'undo' && !h.undone && now - h.at < DAY_MS).length
      },
      suggestions: lastPlan.suggestions.slice(0, 200).map((c) => ({ id: c.id, current: c.before, proposed: c.after, reason: c.reason })),
      history: state.history
        .slice(-50)
        .reverse()
        .map((h) => ({ key: h.key, before: h.before, after: h.after, reason: h.reason, at: h.at, undone: Boolean(h.undone) })),
      notice
    }
  }

  async function publish(next: NamingView): Promise<NamingView> {
    view = next
    orca.panels.post('naming.changed', view)
    const s = view.counts.renamedToday
    const bar =
      view.status === 'active'
        ? { text: view.suggestions.length ? `Naming Guard · ${view.suggestions.length}` : 'Naming Guard', icon: 'edit' as const, tone: view.suggestions.length ? ('accent' as const) : ('success' as const), tooltip: `Workspace Naming Guard is on · ${s} renamed in 24 h · ${view.suggestions.length} suggestions · ${view.counts.waiting} waiting for a title` }
        : view.status === 'paused'
          ? { text: 'Naming Guard', icon: 'pause' as const, tone: 'neutral' as const, tooltip: 'Workspace Naming Guard is paused' }
          : view.status === 'unsupported'
            ? { text: 'Naming Guard', icon: 'warning' as const, tone: 'warning' as const, tooltip: 'Workspace Naming Guard needs Orca 1.4.256 or later' }
            : { text: 'Naming Guard', icon: 'warning' as const, tone: 'warning' as const, tooltip: `Workspace Naming Guard could not check names: ${view.error ?? 'unknown error'}` }
    const signature = JSON.stringify(bar)
    if (signature !== lastBar) {
      lastBar = signature
      // Cosmetic: a status bar Orca cannot draw (a headless host) must never stop renaming.
      await orca.host.call('statusBar.update', { id: 'naming', ...bar }).catch(() => undefined)
    }
    return view
  }

  /** One pass: list, plan, rename new workspaces, publish. */
  async function pass(notice: string | null = null): Promise<NamingView> {
    const settings = await readSettings()
    if (!orca.host.has('workspace.list') || !orca.host.has('workspace.rename')) {
      return publish({ ...view, status: 'unsupported', error: null, checkedAt: Date.now(), notice })
    }
    const { workspaces, truncated } = await listWorkspaces()
    const now = Date.now()
    const byId = new Map(workspaces.map((w) => [w.id, w]))
    const stored = await loadState()
    const state: State = stored ?? {
      version: 2,
      baseline: workspaces.map((w) => w.id),
      seen: {},
      records: {},
      history: [],
      pending: null
    }
    let dirty = !stored

    if (state.pending) {
      const ws = byId.get(state.pending.id)
      if (ws && ws.name === state.pending.after) {
        state.records[ws.id] = { name: ws.name, stage: state.pending.stage, at: now }
      }
      state.pending = null
      dirty = true
    }

    for (const ws of workspaces) {
      if (state.baseline.includes(ws.id) || ws.id in state.seen) continue
      // A truncated list (over 500 workspaces) cannot tell new from unlisted: treat it as old.
      if (truncated) state.baseline.push(ws.id)
      else state.seen[ws.id] = now
      dirty = true
    }
    const baseline = new Set(state.baseline)
    if (!truncated) {
      // Forget workspaces that are gone, so state does not grow forever.
      for (const bucket of [state.seen, state.records]) {
        for (const id of Object.keys(bucket)) {
          if (byId.has(id)) continue
          delete bucket[id]
          dirty = true
        }
      }
    }

    lastPlan = planAll(workspaces, baseline, state.records, settings, shortHash)
    for (const id of lastPlan.locks) {
      state.records[id] = { ...state.records[id], name: byId.get(id)?.name ?? '', locked: true, at: now }
      dirty = true
    }
    if (dirty) await saveState(state)

    let failed: string | null = null
    if (settings.enabled) {
      for (const change of lastPlan.auto.slice(0, MAX_RENAMES_PER_PASS)) {
        if (stopped) break
        try {
          await rename(state, change)
        } catch (e) {
          failed = errorCode(e)
          orca.log(`rename failed for "${change.before}": ${failed}`)
        }
      }
      // Renamed ones no longer wait.
      lastPlan = { ...lastPlan, auto: [], waiting: lastPlan.waiting.filter((id) => !state.records[id]) }
    }
    const status = settings.enabled ? 'active' : 'paused'
    return publish(buildView(state, settings, status, null, notice ?? (failed ? `A rename failed (${failed}); it is retried on the next check.` : null)))
  }

  async function guardedPass(notice: string | null = null): Promise<NamingView> {
    try {
      return await pass(notice)
    } catch (e) {
      const code = errorCode(e)
      orca.log(`check failed: ${code}`)
      return publish({ ...view, status: 'error', error: code, checkedAt: Date.now(), notice })
    }
  }

  function schedule(delay: number): void {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      void serial(() => guardedPass()).then((v) => schedule(v.counts.waiting > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS))
    }, delay)
  }

  /** Re-lists, then renames the given suggestions or locks the given ids. */
  async function act(ids: string[], mode: 'apply' | 'ignore'): Promise<NamingView> {
    const settings = await readSettings()
    const state = await loadState()
    if (!state) return guardedPass()
    const { workspaces } = await listWorkspaces()
    const byId = new Map(workspaces.map((w) => [w.id, w]))
    const wanted = new Set(ids)
    let notice: string | null = null
    if (mode === 'apply') {
      const fresh = planAll(workspaces, new Set(state.baseline), state.records, settings, shortHash)
      const changes = fresh.suggestions.filter((c) => wanted.has(c.id))
      if (changes.length < wanted.size) notice = 'Some suggestions changed since they were shown; check them again.'
      for (const change of changes) await rename(state, change)
    } else {
      const now = Date.now()
      for (const id of wanted) {
        const ws = byId.get(id)
        if (ws) state.records[id] = { name: ws.name, stage: 'final', at: now, locked: true }
      }
      await saveState(state)
    }
    return pass(notice)
  }

  async function undo(key: string): Promise<NamingView> {
    const state = await loadState()
    const item = state?.history.find((h) => h.key === key)
    if (!state || !item || item.undone) return pass('That rename was already undone.')
    const { workspaces } = await listWorkspaces()
    const ws = workspaces.find((w) => w.id === item.id)
    if (!ws) return pass('That workspace no longer exists.')
    if (ws.name !== item.after) return pass(`Not undone: the workspace was renamed to "${ws.name}" since.`)
    await rename(state, { id: item.id, before: item.after, after: item.before, reason: 'undo', stage: 'final' }, { locked: true })
    item.undone = true
    await saveState(state)
    return pass()
  }

  orca.panels.handle('naming.view', () => (view.status === 'starting' ? serial(() => guardedPass()) : view))
  orca.panels.handle('naming.check', () => serial(() => guardedPass()))
  orca.panels.handle('naming.apply', ({ ids }) => serial(() => act(ids, 'apply')))
  orca.panels.handle('naming.ignore', ({ ids }) => serial(() => act(ids, 'ignore')))
  orca.panels.handle('naming.undo', ({ key }) => serial(() => undo(key)))
  orca.panels.handle('naming.setEnabled', async ({ enabled }) => {
    await orca.settings.set('enabled', enabled)
    return serial(() => guardedPass())
  })

  orca.commands.register('naming.status', async () => describe(await serial(() => guardedPass())))
  orca.commands.register('naming.check', async () => describe(await serial(() => guardedPass())))
  orca.commands.register('naming.toggle', async () => {
    await orca.settings.set('enabled', !view.enabled)
    return describe(await serial(() => guardedPass()))
  })

  const subscriptions: Disposable[] = [
    orca.events.on('workspace.created', () => schedule(CREATED_DEBOUNCE_MS)),
    orca.settings.onDidChange(() => schedule(CREATED_DEBOUNCE_MS))
  ]
  stopCurrent = () => {
    stopped = true
    clearTimeout(timer)
    for (const s of subscriptions) s.dispose()
  }
  schedule(0)
}

export function deactivate(): void {
  stopCurrent?.()
  stopCurrent = null
}

function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[a-z_]+$/.test(code) ? code : 'action_failed'
}

/** What the palette shows for a command: one plain line. */
function describe(view: NamingView): string {
  switch (view.status) {
    case 'unsupported':
      return 'Workspace Naming Guard needs Orca 1.4.256 or later.'
    case 'error':
      return `Workspace Naming Guard could not check names (${view.error}).`
    default: {
      const state = view.status === 'paused' ? 'paused' : 'on'
      const c = view.counts
      return `Workspace Naming Guard is ${state}: ${c.renamedToday} renamed in 24 h, ${view.suggestions.length} suggestions, ${c.waiting} waiting for a title, ${c.locked} left as you named them. Open the Naming Guard panel in the right sidebar for details.`
    }
  }
}

