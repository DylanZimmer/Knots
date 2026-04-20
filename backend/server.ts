import express from 'express'
import router from './routes'

const app = express()
const port = 3001
const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ||
    'http://localhost:5173,https://knotresearch.netlify.app')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin

  if (!requestOrigin || allowedOrigins.has(requestOrigin)) {
    if (requestOrigin) {
      res.header('Access-Control-Allow-Origin', requestOrigin)
      res.header('Vary', 'Origin')
    }

    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }

  next()
})

app.use(express.json())
app.use('/api/knots', router)

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`)
})
