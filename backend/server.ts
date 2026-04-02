import express from 'express'
import router from './routes'

const app = express()
const port = 3001

app.use(express.json())
app.use('/api/knots', router)

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`)
})
