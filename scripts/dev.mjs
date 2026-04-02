import { spawn } from 'node:child_process'

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function start(name, script) {
  const child = spawn(npmCmd, ['run', script], {
    stdio: 'inherit',
    env: process.env,
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`${name} exited with signal ${signal}`)
      return
    }

    if (code !== 0) {
      console.error(`${name} exited with code ${code}`)
      shutdown(code ?? 1)
    }
  })

  return child
}

const children = [
  start('frontend', 'dev:frontend'),
  start('backend', 'dev:backend'),
]

let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
