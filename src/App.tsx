import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [showMoves] = useState(true)
  const [showInvariants] = useState(true)
  const [knotSvg, setKnotSvg] = useState('')
  const [svgError, setSvgError] = useState<string | null>(null)
  const [debugJson, setDebugJson] = useState('')
  const [debugError, setDebugError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadKnotSvg() {
      try {
        const res = await fetch('/api/knots/svg')
        const svg = await res.text()

        if (!res.ok) {
          throw new Error(svg || 'Failed to load knot SVG')
        }

        if (!cancelled) {
          setKnotSvg(svg)
          setSvgError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setSvgError(
            error instanceof Error ? error.message : 'Failed to load knot SVG'
          )
        }
      }
    }

    loadKnotSvg()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadKnotDebug() {
      try {
        const res = await fetch('/api/knots/debug')
        const json = await res.json()

        if (!res.ok) {
          throw new Error(json?.error || 'Failed to load knot debug data')
        }

        if (!cancelled) {
          setDebugJson(JSON.stringify(json, null, 2))
          setDebugError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setDebugError(
            error instanceof Error ? error.message : 'Failed to load knot debug data'
          )
        }
      }
    }

    loadKnotDebug()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="background">
      <div className="container">
        <div className="knot_box">
          {svgError ? (
            <p className="knot_status">{svgError}</p>
          ) : knotSvg ? (
            <div
              className="knot_svg"
              dangerouslySetInnerHTML={{ __html: knotSvg }}
            />
          ) : (
            <p className="knot_status">Rendering knot...</p>
          )}
        </div>
        {showMoves && showInvariants ? (
          <div className="right_col">
            <div className="moves_box"></div>
            <div className="invariants_box">
              {debugError ? (
                <p className="knot_status">{debugError}</p>
              ) : debugJson ? (
                <pre className="knot_status">{debugJson}</pre>
              ) : (
                <p className="knot_status">Loading debugger...</p>
              )}
            </div>
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
