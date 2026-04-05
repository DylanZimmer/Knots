import express from 'express'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { insertKnot } from './db/fxns'

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
  pd_notation: '[[1,5,2,4],[3,1,4,6],[5,3,6,2]]',
}

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
      body: JSON.stringify({
        name:
          typeof req.query.name === 'string'
            ? req.query.name
            : defaultDiagramPayload.name,
        pd_notation:
          typeof req.query.pd_notation === 'string'
            ? req.query.pd_notation
            : defaultDiagramPayload.pd_notation,
      }),
    })

    const body = await diagramRes.text()

    if (!diagramRes.ok) {
      throw new Error(body || 'Snappy diagram generation failed')
    }

    res.type(diagramRes.headers.get('content-type') || 'image/svg+xml').send(body)
  } catch (err) {
    console.error('GET /api/knots/svg failed:', err)
    res.status(500).send(err instanceof Error ? err.message : 'SVG render failed')
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
