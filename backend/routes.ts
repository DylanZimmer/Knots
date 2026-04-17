import express from 'express'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { statSync, watch, type FSWatcher } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { insertKnot } from './db/fxns'
import { getSupabase } from './supabase'

const router = express.Router()
const snappyDirPath = fileURLToPath(new URL('./snappy/', import.meta.url))
const snappyPopulateDbDirPath = fileURLToPath(
  new URL('./snappy/populate_db/', import.meta.url),
)
const snappyAppPath = fileURLToPath(new URL('./snappy/app.py', import.meta.url))
const snappyServePath = fileURLToPath(new URL('./snappy/serve.py', import.meta.url))
const snappyPopulateDbCinPath = fileURLToPath(
  new URL('./snappy/populate_db/cin_from_oriented_pd.py', import.meta.url),
)
const snappyPopulateDbOrientedPath = fileURLToPath(
  new URL('./snappy/populate_db/oriented_pd.py', import.meta.url),
)
const snappyBaseUrl = 'http://127.0.0.1:5000'
const snappyPythonBin =
  process.env.SNAPPY_PYTHON_BIN ||
  process.env.PYTHON ||
  '/home/dylan/miniforge3/bin/python3'
type DiagramGeometryPayload = {
  name: string
  moves?: string
  vertex_positions: unknown
  arrows: unknown
  crossing_specs: unknown
}

type KnotMovesPayload = {
  name: string
  full_notation: unknown
}

type KnotOptionRecord = {
  name: string
}

type KnotIdRecord = {
  id: unknown
}

type KnotInvariantsRecord = {
  id?: unknown
  knot_id?: unknown
  name?: unknown
  knot_name?: unknown
  base_name?: unknown
  alexander_polynomial?: unknown
  Alexander_polynomial?: unknown
}

type KnotFullNotationRecord = {
  name: unknown
  full_notation: unknown
}

type CurrentKnotDiagramRecord = {
  id: unknown
  base_name: unknown
  moves: unknown
  vertex_positions: unknown
  arrows: unknown
  crossing_specs: unknown
}

type CurrentKnotInvariantsRecord = {
  id: unknown
  base_name: unknown
  alexander_polynomial: unknown
}

type HttpError = Error & { status?: number }
type CurrentDiagramMoveHandler = () => Promise<DiagramGeometryPayload>

const KNOT_LIST_PAGE_SIZE = 1000

let snappyProcess: ChildProcessWithoutNullStreams | null = null
let snappyBootPromise: Promise<void> | null = null
let snappyLastError = ''
let snappySourceVersion = 0
let snappyWatchers: FSWatcher[] = []
let snappyRestartTimer: ReturnType<typeof setTimeout> | null = null

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function getSnappySourceVersion() {
  return Math.max(
    statSync(snappyAppPath).mtimeMs,
    statSync(snappyServePath).mtimeMs,
    statSync(snappyPopulateDbCinPath).mtimeMs,
    statSync(snappyPopulateDbOrientedPath).mtimeMs,
  )
}

async function isSnappyHealthy() {
  try {
    const res = await fetch(`${snappyBaseUrl}/health`)
    return res.ok
  } catch {
    return false
  }
}

function createHttpError(status: number, message: string) {
  const error = new Error(message) as HttpError
  error.status = status
  return error
}

function normalizeMoveKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parseJsonText(text: string) {
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseJsonValue(value: unknown) {
  if (typeof value !== 'string') {
    return value
  }

  return parseJsonText(value)
}

function reverseArrowPairs(arrows: unknown) {
  if (!Array.isArray(arrows)) {
    return arrows
  }

  return arrows.map((arrow) => {
    if (!Array.isArray(arrow) || arrow.length < 2) {
      return arrow
    }

    return [arrow[1], arrow[0], ...arrow.slice(2)]
  })
}

function reverseCrossingSpecPairs(crossingSpecs: unknown) {
  if (!Array.isArray(crossingSpecs)) {
    return crossingSpecs
  }

  return crossingSpecs.map((crossingSpec) => {
    if (!Array.isArray(crossingSpec) || crossingSpec.length < 2) {
      return crossingSpec
    }

    return [crossingSpec[1], crossingSpec[0], ...crossingSpec.slice(2)]
  })
}

function getRequestBody(req: express.Request) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : {}
}

function getRequestValue(req: express.Request, key: string) {
  const body = getRequestBody(req)

  if (key in body) {
    return body[key]
  }

  const queryValue = req.query[key]
  return Array.isArray(queryValue) ? queryValue[0] : queryValue
}

function getRequestedKnotName(req: express.Request) {
  const body = getRequestBody(req)

  if (typeof body.name === 'string') {
    return body.name
  }

  const queryName = req.query.name
  if (typeof queryName === 'string') {
    return queryName
  }

  return null
}

function getErrorStatus(err: unknown) {
  return typeof (err as HttpError).status === 'number'
    ? (err as HttpError).status!
    : 500
}

function getErrorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) {
    return err.message
  }

  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message
  }

  return fallback
}

function parseNumericId(value: unknown, fieldName: string) {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(numericValue)) {
    throw createHttpError(500, `${fieldName} must be numeric`)
  }

  return numericValue
}

function normalizeInvariantValue(value: unknown) {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  return JSON.stringify(value)
}

async function getStoredRolfDiagramGeometry(name: string): Promise<DiagramGeometryPayload> {
  const supabase = getSupabase()

  const { data: knotRow, error: knotError } = await supabase
    .from('knots')
    .select('id')
    .eq('name', name)
    .single()

  const knotId = !knotError && knotRow ? (knotRow as KnotIdRecord).id : null

  for (const knotKey of ['id', 'knot_id', 'knot_name', 'name'] as const) {
    const queryValue = knotKey === 'id' || knotKey === 'knot_id' ? knotId : name

    if (queryValue == null) {
      continue
    }

    const { data: diagramRow, error: diagramError } = await supabase
      .from('knot_diagrams_rolf')
      .select('vertex_positions, arrows, crossing_specs')
      .eq(knotKey, queryValue)
      .single()

    if (!diagramError && diagramRow) {
      return {
        name,
        vertex_positions: parseJsonValue(diagramRow.vertex_positions),
        arrows: parseJsonValue(diagramRow.arrows),
        crossing_specs: parseJsonValue(diagramRow.crossing_specs),
      }
    }
  }

  console.error('Rolf diagram data not found for:', name)
  throw createHttpError(404, `No rolf diagram data for '${name}'`)
}

async function getCurrentDiagramGeometry(): Promise<DiagramGeometryPayload> {
  const row = await getLatestCurrentDiagramRow()

  return {
    name:
      typeof row.base_name === 'string' && row.base_name.trim().length > 0
        ? row.base_name
        : 'current',
    moves: typeof row.moves === 'string' ? row.moves : '',
    vertex_positions: parseJsonValue(row.vertex_positions),
    arrows: parseJsonValue(row.arrows),
    crossing_specs: parseJsonValue(row.crossing_specs),
  }
}

async function getLatestCurrentDiagramRow(): Promise<CurrentKnotDiagramRecord> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('current_knot_diagram')
    .select('id, base_name, moves, vertex_positions, arrows, crossing_specs')
    .order('id', { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  const row = ((data ?? []) as CurrentKnotDiagramRecord[])[0]

  if (!row) {
    throw createHttpError(404, 'No current knot diagram is available')
  }

  return row
}

async function initializeCurrentDiagram(name: string): Promise<DiagramGeometryPayload> {
  const supabase = getSupabase()
  const sourceGeometry = await getStoredRolfDiagramGeometry(name)

  const { data: knotRow, error: knotError } = await supabase
    .from('knots')
    .select('id')
    .eq('name', name)
    .single()

  if (knotError || !knotRow) {
    console.error('Knot id not found for current diagram seed:', name)
    throw createHttpError(404, `No knot id for '${name}'`)
  }

  const { error: clearError } = await supabase
    .from('current_knot_diagram')
    .delete()
    .not('id', 'is', null)

  if (clearError) {
    throw clearError
  }

  const { error: insertError } = await supabase.from('current_knot_diagram').insert([
    {
      id: (knotRow as KnotIdRecord).id,
      base_name: name,
      moves: '',
      vertex_positions: sourceGeometry.vertex_positions,
      arrows: sourceGeometry.arrows,
      crossing_specs: sourceGeometry.crossing_specs,
    },
  ])

  if (insertError) {
    throw insertError
  }

  await initializeCurrentInvariants(name)

  return getCurrentDiagramGeometry()
}

async function appendFlipOrientationCurrentDiagram(): Promise<DiagramGeometryPayload> {
  const supabase = getSupabase()
  const currentRow = await getLatestCurrentDiagramRow()
  const currentMoves = typeof currentRow.moves === 'string' ? currentRow.moves.trim() : ''
  const nextMoves = currentMoves ? `${currentMoves}, flip` : 'flip'
  const nextId = parseNumericId(currentRow.id, 'current_knot_diagram.id') + 0.1

  const { error: insertError } = await supabase.from('current_knot_diagram').insert([
    {
      id: nextId,
      base_name: currentRow.base_name,
      moves: nextMoves,
      vertex_positions: parseJsonValue(currentRow.vertex_positions),
      arrows: reverseArrowPairs(parseJsonValue(currentRow.arrows)),
      crossing_specs: parseJsonValue(currentRow.crossing_specs),
    },
  ])

  if (insertError) {
    throw insertError
  }

  return getCurrentDiagramGeometry()
}

async function appendMirrorCurrentDiagram(): Promise<DiagramGeometryPayload> {
  const supabase = getSupabase()
  const currentRow = await getLatestCurrentDiagramRow()
  const currentMoves = typeof currentRow.moves === 'string' ? currentRow.moves.trim() : ''
  const nextMoves = currentMoves ? `${currentMoves}, mirror` : 'mirror'
  const nextId = parseNumericId(currentRow.id, 'current_knot_diagram.id') + 0.1

  const { error: insertError } = await supabase.from('current_knot_diagram').insert([
    {
      id: nextId,
      base_name: currentRow.base_name,
      moves: nextMoves,
      vertex_positions: parseJsonValue(currentRow.vertex_positions),
      arrows: parseJsonValue(currentRow.arrows),
      crossing_specs: reverseCrossingSpecPairs(parseJsonValue(currentRow.crossing_specs)),
    },
  ])

  if (insertError) {
    throw insertError
  }

  return getCurrentDiagramGeometry()
}

const currentDiagramMoveHandlers: Record<string, CurrentDiagramMoveHandler> = {
  [normalizeMoveKey('Flip Orientation')]: appendFlipOrientationCurrentDiagram,
  [normalizeMoveKey('Mirror')]: appendMirrorCurrentDiagram,
}

async function getStoredKnotInvariants(name: string) {
  const supabase = getSupabase()

  const { data: knotRow, error: knotError } = await supabase
    .from('knots')
    .select('id')
    .eq('name', name)
    .single()

  const knotId = !knotError && knotRow ? (knotRow as KnotIdRecord).id : null

  for (const knotKey of ['name', 'knot_name', 'base_name', 'knot_id', 'id'] as const) {
    const queryValue = knotKey === 'knot_id' || knotKey === 'id' ? knotId : name

    if (queryValue == null) {
      continue
    }

    const { data: invariantsRow, error: invariantsError } = await supabase
      .from('invariants_rolf')
      .select('*')
      .eq(knotKey, queryValue)
      .single()

    if (!invariantsError && invariantsRow) {
      const {
        name: storedName,
        knot_name: knotName,
        base_name: baseName,
        alexander_polynomial,
        Alexander_polynomial,
      } = invariantsRow as KnotInvariantsRecord

      return {
        name:
          typeof baseName === 'string' && baseName.trim().length > 0
            ? baseName
            : typeof knotName === 'string' && knotName.trim().length > 0
              ? knotName
              : typeof storedName === 'string' && storedName.trim().length > 0
                ? storedName
                : name,
        alexander_polynomial: normalizeInvariantValue(
          alexander_polynomial ?? Alexander_polynomial,
        ),
      }
    }
  }

  console.error('Knot invariants not found for:', name)
  throw createHttpError(404, `No invariants data for '${name}'`)
}

async function getLatestCurrentInvariantsRow(): Promise<CurrentKnotInvariantsRecord> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('current_invariants')
    .select('id, base_name, alexander_polynomial')
    .order('id', { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  const row = ((data ?? []) as CurrentKnotInvariantsRecord[])[0]

  if (!row) {
    throw createHttpError(404, 'No current invariants are available')
  }

  return row
}

async function getCurrentKnotInvariants() {
  const row = await getLatestCurrentInvariantsRow()

  return {
    id: normalizeInvariantValue(row.id),
    base_name:
      typeof row.base_name === 'string' && row.base_name.trim().length > 0
        ? row.base_name
        : 'current',
    alexander_polynomial: normalizeInvariantValue(row.alexander_polynomial),
  }
}

async function initializeCurrentInvariants(name: string) {
  const supabase = getSupabase()
  const sourceInvariants = await getStoredKnotInvariants(name)

  const { data: knotRow, error: knotError } = await supabase
    .from('knots')
    .select('id')
    .eq('name', name)
    .single()

  if (knotError || !knotRow) {
    console.error('Knot id not found for current invariants seed:', name)
    throw createHttpError(404, `No knot id for '${name}'`)
  }

  const { error: clearError } = await supabase
    .from('current_invariants')
    .delete()
    .not('id', 'is', null)

  if (clearError) {
    throw clearError
  }

  const { error: insertError } = await supabase.from('current_invariants').insert([
    {
      id: (knotRow as KnotIdRecord).id,
      base_name: sourceInvariants.name,
      alexander_polynomial: sourceInvariants.alexander_polynomial,
    },
  ])

  if (insertError) {
    throw insertError
  }
}

async function getStoredKnotFullNotation(name: string): Promise<KnotMovesPayload> {
  const supabase = getSupabase()

  const { data: knotRow, error: knotError } = await supabase
    .from('knots')
    .select('name, full_notation')
    .eq('name', name)
    .single()

  if (knotError || !knotRow) {
    console.error('Knot full notation not found for:', name)
    throw createHttpError(404, `No full notation data for '${name}'`)
  }

  const { name: storedName, full_notation } = knotRow as KnotFullNotationRecord

  return {
    name:
      typeof storedName === 'string' && storedName.trim().length > 0
        ? storedName
        : name,
    full_notation: parseJsonValue(full_notation),
  }
}

function getDiagramGeometryPayloadFromRequest(
  req: express.Request,
): DiagramGeometryPayload | null {
  const vertexPositions = parseJsonValue(getRequestValue(req, 'vertex_positions'))
  const arrows = parseJsonValue(getRequestValue(req, 'arrows'))
  const crossingSpecs = parseJsonValue(getRequestValue(req, 'crossing_specs'))

  const providedFieldCount = [vertexPositions, arrows, crossingSpecs].filter(
    (value) => value != null,
  ).length

  if (providedFieldCount === 0) {
    return null
  }

  if (providedFieldCount !== 3) {
    throw createHttpError(
      400,
      'Diagram payload must include vertex_positions, arrows, and crossing_specs',
    )
  }

  return {
    name: getRequestedKnotName(req) ?? 'unknown',
    vertex_positions: vertexPositions,
    arrows,
    crossing_specs: crossingSpecs,
  }
}

function getFullNotationPayloadFromRequest(req: express.Request): KnotMovesPayload | null {
  const fullNotation = parseJsonValue(getRequestValue(req, 'full_notation'))

  if (fullNotation == null) {
    return null
  }

  return {
    name: getRequestedKnotName(req) ?? 'unknown',
    full_notation: fullNotation,
  }
}

async function resolveDiagramRenderPayload(
  req: express.Request,
): Promise<DiagramGeometryPayload | KnotMovesPayload> {
  const geometryPayload = getDiagramGeometryPayloadFromRequest(req)
  if (geometryPayload) {
    return geometryPayload
  }

  const fullNotationPayload = getFullNotationPayloadFromRequest(req)
  if (fullNotationPayload) {
    return fullNotationPayload
  }

  const name = getRequestedKnotName(req)
  if (!name) {
    throw createHttpError(
      400,
      'Diagram routes require a knot name, full_notation, or explicit diagram geometry payload',
    )
  }

  return getStoredRolfDiagramGeometry(name)
}

async function getAllKnotNames(
  ascending: boolean,
  paginate: boolean,
): Promise<string[]> {
  const supabase = getSupabase()

  if (!paginate) {
    const { data, error } = await supabase
      .from('knots')
      .select('name')
      .order('name', { ascending })

    if (error) {
      throw error
    }

    return (data ?? [])
      .map((row: KnotOptionRecord) => row.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
  }

  const knotNames: string[] = []
  let start = 0

  while (true) {
    const { data, error } = await supabase
      .from('knots')
      .select('name')
      .order('name', { ascending })
      .range(start, start + KNOT_LIST_PAGE_SIZE - 1)

    if (error) {
      throw error
    }

    const rows = (data ?? []) as KnotOptionRecord[]

    knotNames.push(
      ...rows
        .map((row) => row.name)
        .filter((name): name is string => typeof name === 'string' && name!== '0_1' && name.length > 0),
    )

    if (rows.length < KNOT_LIST_PAGE_SIZE) {
      break
    }

    start += rows.length
  }

  return knotNames
}

function startSnappyProcess() {
  if (snappyProcess && snappyProcess.exitCode === null && !snappyProcess.killed) {
    return
  }

  snappyLastError = ''
  snappySourceVersion = getSnappySourceVersion()
  console.log(`Starting snappy with ${snappyPythonBin}`)
  snappyProcess = spawn(snappyPythonBin, ['-u', snappyServePath], {
    cwd: snappyDirPath,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
    stdio: 'pipe',
  })

  snappyProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[snappy] ${chunk}`)
  })

  snappyProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    snappyLastError += text
    process.stderr.write(`[snappy] ${text}`)
  })

  snappyProcess.on('exit', () => {
    snappyProcess = null
    snappyBootPromise = null
  })
}

function scheduleSnappyRestart() {
  if (process.env.NODE_ENV === 'production') {
    return
  }

  if (snappyRestartTimer) {
    clearTimeout(snappyRestartTimer)
  }

  snappyRestartTimer = setTimeout(() => {
    snappyRestartTimer = null
    console.log('Restarting snappy to pick up Python changes')
    shutdownSnappyServer()
    void ensureSnappyServer().catch((err) => {
      console.error('Failed to restart snappy after file change:', err)
    })
  }, 150)

  snappyRestartTimer.unref?.()
}

function startSnappyWatchers() {
  if (snappyWatchers.length > 0 || process.env.NODE_ENV === 'production') {
    return
  }

  for (const watchPath of [
    snappyDirPath,
    snappyPopulateDbDirPath,
  ]) {
    const watcher = watch(watchPath, (_eventType, filename) => {
      if (typeof filename !== 'string' || !filename.endsWith('.py')) {
        return
      }

      scheduleSnappyRestart()
    })

    watcher.on('error', (err) => {
      console.error(`Snappy watch failed for ${watchPath}:`, err)
    })

    snappyWatchers.push(watcher)
  }
}

async function ensureSnappyServer() {
  const currentSourceVersion = getSnappySourceVersion()

  if (
    snappyProcess &&
    snappyProcess.exitCode === null &&
    !snappyProcess.killed &&
    snappySourceVersion < currentSourceVersion
  ) {
    console.log('Restarting snappy to pick up Python changes')
    shutdownSnappyServer()
    await sleep(150)
  }

  if (snappySourceVersion >= currentSourceVersion && await isSnappyHealthy()) {
    return
  }

  if (!snappyBootPromise) {
    snappyBootPromise = (async () => {
      startSnappyProcess()

      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (await isSnappyHealthy()) {
          return
        }

        if (snappyProcess?.exitCode !== null || !snappyProcess) {
          throw new Error(snappyLastError.trim() || 'Snappy server exited before becoming ready')
        }

        await sleep(100)
      }

      throw new Error('Timed out waiting for the snappy server to start')
    })()
  }

  try {
    await snappyBootPromise
  } finally {
    snappyBootPromise = null
  }
}

function shutdownSnappyServer() {
  if (snappyProcess && snappyProcess.exitCode === null && !snappyProcess.killed) {
    snappyProcess.kill()
  }
}

function shutdownSnappyWatchers() {
  if (snappyRestartTimer) {
    clearTimeout(snappyRestartTimer)
    snappyRestartTimer = null
  }

  for (const watcher of snappyWatchers) {
    watcher.close()
  }

  snappyWatchers = []
}

async function renderDiagramSvg(payload: DiagramGeometryPayload | KnotMovesPayload) {
  await ensureSnappyServer()

  const diagramRes = await fetch(`${snappyBaseUrl}/diagram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const body = await diagramRes.text()
  const parsedBody = parseJsonText(body)

  if (!diagramRes.ok) {
    throw createHttpError(
      500,
      (parsedBody &&
        typeof parsedBody === 'object' &&
        'error' in parsedBody &&
        typeof parsedBody.error === 'string' &&
        parsedBody.error) ||
        body ||
        'Snappy diagram generation failed',
    )
  }

  return {
    body,
    contentType: diagramRes.headers.get('content-type') || 'image/svg+xml',
  }
}

startSnappyWatchers()

process.on('exit', shutdownSnappyServer)
process.on('SIGINT', () => {
  shutdownSnappyWatchers()
  shutdownSnappyServer()
  process.exit(0)
})
process.on('SIGTERM', () => {
  shutdownSnappyWatchers()
  shutdownSnappyServer()
  process.exit(0)
})

async function handleSvg(req: express.Request, res: express.Response) {
  try {
    const payload = await resolveDiagramRenderPayload(req)
    const { body, contentType } = await renderDiagramSvg(payload)
    res.type(contentType).send(body)
  } catch (err) {
    console.error('GET /api/knots/svg failed:', err)
    res
      .status(getErrorStatus(err))
      .send(err instanceof Error ? err.message : 'SVG render failed')
  }
}

async function handleDebug(req: express.Request, res: express.Response) {
  try {
    const payload = await resolveDiagramRenderPayload(req)
    res.json(payload)
  } catch (err) {
    console.error('GET /api/knots/debug failed:', err)
    res.status(getErrorStatus(err)).json({
      error: err instanceof Error ? err.message : 'Debug render failed',
    })
  }
}

router.get('/svg', handleSvg)
router.post('/svg', handleSvg)

router.get('/debug', handleDebug)
router.post('/debug', handleDebug)

router.get('/', async (_req, res) => {
  try {
    const knotListAscending = true
    const knotNames = await getAllKnotNames(knotListAscending, true)

    res.json(knotNames)
  } catch (err) {
    console.error('GET /api/knots failed:', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Could not load knot list',
    })
  }
})

router.get('/current', async (_req, res) => {
  try {
    const payload = await getCurrentDiagramGeometry()
    res.json(payload)
  } catch (err) {
    console.error('GET /api/knots/current failed:', err)
    res.status(getErrorStatus(err)).json({
      error: getErrorMessage(err, 'Could not load current knot diagram'),
    })
  }
})

router.post('/current', async (req, res) => {
  const name = getRequestedKnotName(req)

  if (!name) {
    res.status(400).json({ error: 'A knot name is required to initialize the current diagram' })
    return
  }

  try {
    const payload = await initializeCurrentDiagram(name)
    res.json(payload)
  } catch (err) {
    console.error('POST /api/knots/current failed:', err)
    res.status(getErrorStatus(err)).json({
      error: getErrorMessage(err, 'Could not initialize current knot diagram'),
    })
  }
})

router.get('/current/invariants', async (_req, res) => {
  try {
    const payload = await getCurrentKnotInvariants()
    res.json(payload)
  } catch (err) {
    console.error('GET /api/knots/current/invariants failed:', err)
    res.status(getErrorStatus(err)).json({
      error: getErrorMessage(err, 'Could not load current invariants'),
    })
  }
})

router.post('/current/:moveKey', async (req, res) => {
  const rawMoveKey = typeof req.params.moveKey === 'string' ? req.params.moveKey : ''
  const moveHandler = currentDiagramMoveHandlers[normalizeMoveKey(rawMoveKey)]

  if (!moveHandler) {
    res.status(404).json({
      error: `Unknown current diagram move '${rawMoveKey}'`,
    })
    return
  }

  try {
    const payload = await moveHandler()
    res.json(payload)
  } catch (err) {
    console.error(`POST /api/knots/current/${rawMoveKey} failed:`, err)
    res.status(getErrorStatus(err)).json({
      error: getErrorMessage(err, `Could not apply current diagram move '${rawMoveKey}'`),
    })
  }
})

router.get('/:name', async (req, res) => {
  const { name } = req.params

  try {
    const payload = await getStoredRolfDiagramGeometry(name)
    res.json(payload)
  } catch (err) {
    console.error(`GET /api/knots/${name} failed:`, err)
    res.status(getErrorStatus(err)).json({
      error: err instanceof Error ? err.message : 'Could not load knot',
    })
  }
})

router.get('/:name/full-notation', async (req, res) => {
  const { name } = req.params

  try {
    const payload = await getStoredKnotFullNotation(name)
    res.json(payload)
  } catch (err) {
    console.error(`GET /api/knots/${name}/full-notation failed:`, err)
    res.status(getErrorStatus(err)).json({
      error: err instanceof Error ? err.message : 'Could not load full notation',
    })
  }
})

router.get('/:name/invariants', async (req, res) => {
  const { name } = req.params

  try {
    const payload = await getStoredKnotInvariants(name)
    res.json(payload)
  } catch (err) {
    console.error(`GET /api/knots/${name}/invariants failed:`, err)
    res.status(getErrorStatus(err)).json({
      error: err instanceof Error ? err.message : 'Could not load invariants',
    })
  }
})

router.get('/:name/diagram', async (req, res) => {
  const { name } = req.params

  try {
    const payload = await getStoredRolfDiagramGeometry(name)
    const { body, contentType } = await renderDiagramSvg(payload)
    res.type(contentType).send(body)
  } catch (err) {
    console.error(`GET /api/knots/${name}/diagram failed:`, err)
    res.status(getErrorStatus(err)).json({
      error: err instanceof Error ? err.message : 'Could not render diagram',
    })
  }
})

router.post('/', async (req, res) => {
  const { id, rolf_num, extension } = req.body
  console.log('POST /api/knots body:', req.body)
  try {
    const knot = await insertKnot({ id, rolf_num, extension })
    res.json(knot)
  } catch (err) {
    console.error('POST /api/knots failed:', err)
    const message = err instanceof Error ? err.message : 'Insert failed'
    res.status(500).json({ error: message })
  }
  console.log("End of routes")
})

export default router
