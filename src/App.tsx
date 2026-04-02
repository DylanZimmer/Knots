import { useState } from 'react'
import './App.css'

function App() {
  const [showMoves] = useState(true)
  const [showInvariants] = useState(true)

  async function addKnotEx() {
    const res = await fetch('/api/knots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '1', rolf_num: '3_1', extension: '' })
    })
    const data = await res.json()
    console.log('Inserted knot:', data)
  }

  return (
    <div className="background">
      <div className="container">
        <div className="knot_box" onClick={addKnotEx}>
        </div>
        {showMoves && showInvariants ? (
          <div className="right_col">
            <div className="moves_box"></div>
            <div className="invariants_box"></div>
          </div>
        ) : (
          <>
            {showMoves && <div className="moves_box"></div>}
            {showInvariants && <div className="invariants_box"></div>}
          </>
        )
      }
      </div>
    </div>
  )
}

export default App
