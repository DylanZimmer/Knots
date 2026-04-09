import { useEffect, useState } from 'react'
import './App.css'

const knotOptions = ['3_1', '4_1', '5_1', '5_2']

type DiagramPayload = {
  name: string
  ci_notation: string
}

function App() {
  const [showMoves] = useState(true)
  const [showInvariants] = useState(true)
  const [diagramPayload, setDiagramPayload] = useState<DiagramPayload | null>(null)
  const [payloadError, setPayloadError] = useState<string | null>(null)
  const [knotSvg, setKnotSvg] = useState('')
  const [svgError, setSvgError] = useState<string | null>(null)
  const [debugJson, setDebugJson] = useState('')
  const [debugError, setDebugError] = useState<string | null>(null)
  const [selectedKnot, setSelectedKnot] = useState(knotOptions[0])

  useEffect(() => {
    let cancelled = false

    setDiagramPayload(null)
    setPayloadError(null)
    setKnotSvg('')
    setSvgError(null)
    setDebugJson('')
    setDebugError(null)

    async function loadDiagramPayload() {
      try {
        const res = await fetch(`/api/knots/${selectedKnot}`)
        const payload = await res.json()

        if (!res.ok) {
          throw new Error(payload?.error || 'Failed to load knot data')
        }

        if (!cancelled) {
          setDiagramPayload(payload)
          setPayloadError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setPayloadError(
            error instanceof Error ? error.message : 'Failed to load knot data'
          )
        }
      }
    }

    loadDiagramPayload()

    return () => {
      cancelled = true
    }
  }, [selectedKnot])

  useEffect(() => {
    if (!diagramPayload) {
      return
    }

    let cancelled = false

    async function loadKnotSvg() {
      try {
        const res = await fetch('/api/knots/svg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(diagramPayload),
        })
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
  }, [diagramPayload])

  useEffect(() => {
    if (!diagramPayload) {
      return
    }

    let cancelled = false

    async function loadKnotDebug() {
      try {
        const res = await fetch('/api/knots/debug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(diagramPayload),
        })
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
  }, [diagramPayload])

  const movesContent = (
    <div className="moves_box">
      <div className="moves_controls">
        <label className="moves_label" htmlFor="knot-select">
          Knot
        </label>
        <select
          id="knot-select"
          className="moves_select"
          value={selectedKnot}
          onChange={(event) => setSelectedKnot(event.target.value)}
        >
          {knotOptions.map((knot) => (
            <option key={knot} value={knot}>
              {knot}
            </option>
          ))}
        </select>
      </div>
    </div>
  )

  return (
    <div className="background">
      <div className="container">
        <div className="knot_box">
          {payloadError ? (
            <p className="knot_status">{payloadError}</p>
          ) : svgError ? (
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
            {movesContent}
            <div className="invariants_box">
              {payloadError ? (
                <p className="knot_status">{payloadError}</p>
              ) : debugError ? (
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
            {showMoves && movesContent}
            {showInvariants && <div className="invariants_box"></div>}
          </>
        )
      }
      </div>
    </div>
  )
}

export default App
