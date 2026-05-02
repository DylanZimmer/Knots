import express from 'express'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs'
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
const snappyAppPath = fileURLToPath(new URL('./snappy/draw_from_db.py', import.meta.url))
const snappyServePath = fileURLToPath(new URL('./snappy/serve.py', import.meta.url))
const snappyBaseUrl = 'http://127.0.0.1:5000'
const localSnappyPythonBin = fileURLToPath(
  new URL('../.venv-snappy/bin/python', import.meta.url),
)
const localSnappyPythonBinWindows = fileURLToPath(
  new URL('../.venv-snappy/Scripts/python.exe', import.meta.url),
)
const snappyPythonBin =
  process.env.SNAPPY_PYTHON_BIN ||
  process.env.PYTHON ||
  (existsSync(localSnappyPythonBin)
    ? localSnappyPythonBin
    : existsSync(localSnappyPythonBinWindows)
      ? localSnappyPythonBinWindows
      : null) ||
  'python3'
const snappyStartupPollMs = 100
const defaultSnappyStartupTimeoutMs = process.env.NODE_ENV === 'production' ? 60_000 : 5_000
const parsedSnappyStartupTimeoutMs = Number.parseInt(
  process.env.SNAPPY_STARTUP_TIMEOUT_MS || '',
  10,
)
const snappyStartupTimeoutMs =
  Number.isFinite(parsedSnappyStartupTimeoutMs) && parsedSnappyStartupTimeoutMs > 0
    ? parsedSnappyStartupTimeoutMs
    : defaultSnappyStartupTimeoutMs

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

function getSnappyStartupErrorDetails() {
  const details = snappyLastError.trim()
  if (!details) {
    return ''
  }

  return details.length > 2_000 ? details.slice(-2_000) : details
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

  snappyProcess.on('error', (err) => {
    const message = `${err.name}: ${err.message}`
    snappyLastError += `${message}\n`
    console.error(`[snappy] ${message}`)
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

  for (const watchPath of [snappyAppPath, snappyServePath]) {
    const watcher = watch(watchPath, () => {
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
  const snappyHealthy = await isSnappyHealthy()

  if (!snappyProcess && snappyHealthy) {
    snappySourceVersion = currentSourceVersion
    return
  }

  if (snappyProcess && snappyProcess.exitCode === null && !snappyProcess.killed && snappySourceVersion < currentSourceVersion) {
    console.log('Restarting snappy to pick up Python changes')
    shutdownSnappyServer()
    await sleep(150)
  }

  if (snappySourceVersion >= currentSourceVersion && (snappyHealthy || (await isSnappyHealthy()))) {
    return
  }

  if (!snappyBootPromise) {
    snappyBootPromise = (async () => {
      startSnappyProcess()

      const maxAttempts = Math.max(1, Math.ceil(snappyStartupTimeoutMs / snappyStartupPollMs))

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (await isSnappyHealthy()) {
          return
        }

        if (snappyProcess?.exitCode !== null || !snappyProcess) {
          throw new Error(
            getSnappyStartupErrorDetails() || 'Snappy server exited before becoming ready',
          )
        }

        await sleep(snappyStartupPollMs)
      }

      const details = getSnappyStartupErrorDetails()
      shutdownSnappyServer()
      throw new Error(
        details
          ? `Timed out waiting ${snappyStartupTimeoutMs}ms for the snappy server to start. Recent snappy output:\n${details}`
          : `Timed out waiting ${snappyStartupTimeoutMs}ms for the snappy server to start`,
      )
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
void ensureSnappyServer().catch((err) => {
  console.error(`Initial snappy startup with ${snappyPythonBin} did not complete:`, err)
})

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
