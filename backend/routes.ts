import express from 'express'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { insertKnot } from './db/fxns'
import { getSupabase } from './supabase'

const router = express.Router()
const snappyDirPath = fileURLToPath(new URL('./snappy/', import.meta.url))
const snappyAppPath = fileURLToPath(new URL('./snappy/app.py', import.meta.url))
const snappyServePath = fileURLToPath(new URL('./snappy/serve.py', import.meta.url))
const snappyBaseUrl = 'http://127.0.0.1:5000'
const snappyPythonBin =
  process.env.SNAPPY_PYTHON_BIN ||
  process.env.PYTHON ||
  '/home/dylan/miniforge3/bin/python3'
const defaultDiagramPayload = {
  name: '3_1',
  braid_notation: '[1,1,1]',
  braid_index: 2,
}

type DiagramPayload = {
  name: string
  braid_notation: string
  braid_index?: number
}

type HttpError = Error & { status?: number }

let snappyProcess: ChildProcessWithoutNullStreams | null = null
let snappyBootPromise: Promise<void> | null = null
let snappyLastError = ''
let snappySourceVersion = 0

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

function createHttpError(status: number, message: string) {
  const error = new Error(message) as HttpError
  error.status = status
  return error
}

function parseBraidIndex(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
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

function getDiagramPayload(req: express.Request): DiagramPayload {
  return {
    name:
      typeof req.query.name === 'string'
        ? req.query.name
        : defaultDiagramPayload.name,
    braid_notation:
      typeof req.query.braid_notation === 'string'
        ? req.query.braid_notation
        : defaultDiagramPayload.braid_notation,
    braid_index:
      parseBraidIndex(req.query.braid_index) ?? defaultDiagramPayload.braid_index,
  }
}

async function getStoredDiagramPayload(name: string): Promise<DiagramPayload> {
  const supabase = getSupabase()

  const { data: knotRow, error: knotError } = await supabase
    .from('knots')
    .select('id')
    .eq('name', name)
    .single()

  if (knotError || !knotRow) {
    console.error('Knot not found:', name, knotError)
    throw createHttpError(404, `Knot '${name}' not found`)
  }

  const knotId = knotRow.id

  const { data: diagramRow, error: diagramError } = await supabase
    .from('knot_diagrams')
    .select('braid_notation')
    .eq('knot_id', knotId)
    .single()

  if (diagramError || !diagramRow?.braid_notation) {
    console.error('Braid notation not found for:', name, diagramError)
    throw createHttpError(404, `No braid notation for '${name}'`)
  }

  const { data: combinatorialRow, error: combinatorialError } = await supabase
    .from('knot_combinatorial')
    .select('braid_index')
    .eq('knot_id', knotId)
    .single()

  if (combinatorialError || combinatorialRow?.braid_index == null) {
    console.error('Braid index not found for:', name, combinatorialError)
    throw createHttpError(404, `No braid index for '${name}'`)
  }

  return {
    name,
    braid_notation: diagramRow.braid_notation,
    braid_index: Number(combinatorialRow.braid_index),
  }
}

function startSnappyProcess() {
  if (snappyProcess && snappyProcess.exitCode === null && !snappyProcess.killed) {
    return
  }

  snappyLastError = ''
  snappySourceVersion = getSnappySourceVersion()
  console.log(`Starting snappy with ${snappyPythonBin}`)
  snappyProcess = spawn(snappyPythonBin, [snappyServePath], {
    cwd: snappyDirPath,
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

process.on('exit', shutdownSnappyServer)
process.on('SIGINT', () => {
  shutdownSnappyServer()
  process.exit(0)
})
process.on('SIGTERM', () => {
  shutdownSnappyServer()
  process.exit(0)
})

router.get('/svg', async (req, res) => {
  try {
    await ensureSnappyServer()

    const diagramRes = await fetch(`${snappyBaseUrl}/diagram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getDiagramPayload(req)),
    })

    const body = await diagramRes.text()
    const parsedBody = parseJsonText(body)

    if (!diagramRes.ok) {
      throw new Error(
        (parsedBody &&
          typeof parsedBody === 'object' &&
          'error' in parsedBody &&
          typeof parsedBody.error === 'string' &&
          parsedBody.error) ||
          body ||
          'Snappy diagram generation failed',
      )
    }

    res.type(diagramRes.headers.get('content-type') || 'image/svg+xml').send(body)
  } catch (err) {
    console.error('GET /api/knots/svg failed:', err)
    res.status(500).send(err instanceof Error ? err.message : 'SVG render failed')
  }
})

router.get('/debug', async (req, res) => {
  try {
    await ensureSnappyServer()

    const debugRes = await fetch(`${snappyBaseUrl}/debug`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getDiagramPayload(req)),
    })

    const bodyText = await debugRes.text()
    const body = parseJsonText(bodyText)

    if (!debugRes.ok) {
      if (debugRes.status === 404) {
        return res.status(501).json({
          error: 'Snappy /debug is not available in backend/snappy/app.py yet',
        })
      }

      throw new Error(
        (body &&
          typeof body === 'object' &&
          'error' in body &&
          typeof body.error === 'string' &&
          body.error) ||
          bodyText ||
          'Snappy debug generation failed',
      )
    }

    res.json(body)
  } catch (err) {
    console.error('GET /api/knots/debug failed:', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Debug render failed',
    })
  }
})

router.get('/:name/diagram', async (req, res) => {
  const { name } = req.params

  try {
    const payload = await getStoredDiagramPayload(name)
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
          'Flask render failed',
      )
    }

    res.type(diagramRes.headers.get('content-type') || 'image/svg+xml').send(body)
  } catch (err) {
    const status = typeof (err as HttpError).status === 'number'
      ? (err as HttpError).status!
      : 500

    console.error(`GET /api/knots/${name}/diagram failed:`, err)
    res.status(status).json({
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
