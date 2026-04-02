import express from 'express'
import { insertKnot } from './db/fxns'

const router = express.Router()

router.post('/', async (req, res) => {
  const { id, rolf_num, extension } = req.body
  console.log('POST /api/knots body:', req.body)
  try {
    const knot = await insertKnot({ id, rolf_num, extension })
    res.json(knot)
  } catch (err) {
    console.error('POST /api/knots failed:', err)
    res.status(500).json({ error: 'Insert failed' })
  }
  console.log("End of routes")
})

export default router
