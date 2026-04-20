import express from 'express'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { statSync, watch, type FSWatcher } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHttpError, type DiagramGeometryPayload, type HttpError, type KnotMovesPayload, parseJsonText, parseJsonValue } from './db/common'
import {
  appendFlipOrientationCurrentDiagram,
  appendMirrorCurrentDiagram,
  getCurrentDiagramGeometry,
  getStoredRolfDiagramGeometry,
  initializeCurrentDiagram,
} from './db/diagrams'
import { getCurrentKnotInvariants, getStoredKnotInvariants } from './db/invariants'
import { getAllKnotNames, getStoredKnotFullNotation, insertKnot } from './db/knots'

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
  'python3'

type CurrentDiagramMoveHandler = () => Promise<DiagramGeometryPayload>

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

function normalizeMoveKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
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

  for (const watchPath of [snappyDirPath, snappyPopulateDbDirPath]) {
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

  if (snappySourceVersion >= currentSourceVersion && (await isSnappyHealthy())) {
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

const currentDiagramMoveHandlers: Record<string, CurrentDiagramMoveHandler> = {
  [normalizeMoveKey('Flip Orientation')]: appendFlipOrientationCurrentDiagram,
  [normalizeMoveKey('Mirror')]: appendMirrorCurrentDiagram,
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
    res.status(getErrorStatus(err)).send(err instanceof Error ? err.message : 'SVG render failed')
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
    const knotNames = await getAllKnotNames(true, true)
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
  const { name, full_notation } = req.body
  console.log('POST /api/knots body:', req.body)

  if (typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'A knot name is required' })
    return
  }

  try {
    const knot = await insertKnot({ name: name.trim(), full_notation })
    res.json(knot)
  } catch (err) {
    console.error('POST /api/knots failed:', err)
    const message = err instanceof Error ? err.message : 'Insert failed'
    res.status(500).json({ error: message })
  }

  console.log('End of routes')
})

export default router
