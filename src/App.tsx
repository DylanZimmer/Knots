import { useEffect, useState } from 'react'
import './App.css'

type DiagramPayload = {
  name: string
  ci_notation: string
}

type KnotParts = {
  prefix: string
  suffix: string
}

function parseKnotName(name: string): KnotParts | null {
  const [prefix, suffix, ...rest] = name.trim().split('_')

  if (!prefix || !suffix || rest.length > 0) {
    return null
  }

  return { prefix: prefix.trim(), suffix: suffix.trim() }
}

function getUniqueSorted(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => {
      const leftNumber = Number(left)
      const rightNumber = Number(right)

      if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber)) {
        return leftNumber - rightNumber
      }

      return left.localeCompare(right, undefined, { numeric: true })
    },
  )
}

function App() {
  const [showMoves] = useState(true)
  const [showInvariants] = useState(true)
  const [knotNames, setKnotNames] = useState<string[]>([])
  const [knotOptionsLoading, setKnotOptionsLoading] = useState(true)
  const [knotListError, setKnotListError] = useState<string | null>(null)
  const [selectedN1, setSelectedN1] = useState('')
  const [selectedN2, setSelectedN2] = useState('')
  const [diagramPayload, setDiagramPayload] = useState<DiagramPayload | null>(null)
  const [payloadError, setPayloadError] = useState<string | null>(null)
  const [knotSvg, setKnotSvg] = useState('')
  const [svgError, setSvgError] = useState<string | null>(null)
  const [debugJson, setDebugJson] = useState('')
  const [debugError, setDebugError] = useState<string | null>(null)

  const parsedKnots = knotNames
    .map(parseKnotName)
    .filter((knot): knot is KnotParts => knot !== null)
  const knotN1Options = getUniqueSorted(parsedKnots.map((knot) => knot.prefix))
  const knotN2Options = getUniqueSorted(
    parsedKnots
      .filter((knot) => knot.prefix === selectedN1)
      .map((knot) => knot.suffix),
  )
  const knotName =
    selectedN1 && selectedN2 && knotN2Options.includes(selectedN2)
      ? `${selectedN1}_${selectedN2}`
      : ''

  useEffect(() => {
    let cancelled = false

    async function loadKnotNames() {
      try {
        const res = await fetch('/api/knots')
        const payload = await res.json()

        if (!res.ok) {
          throw new Error(payload?.error || 'Failed to load knot list')
        }

        if (!Array.isArray(payload) || !payload.every((item) => typeof item === 'string')) {
          throw new Error('Unexpected knot list response')
        }

        if (!cancelled) {
          setKnotNames(payload)
          setKnotListError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setKnotNames([])
          setSelectedN1('')
          setSelectedN2('')
          setKnotListError(
            error instanceof Error ? error.message : 'Failed to load knot list',
          )
        }
      } finally {
        if (!cancelled) {
          setKnotOptionsLoading(false)
        }
      }
    }

    loadKnotNames()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const availableN1Options = getUniqueSorted(
      knotNames
        .map(parseKnotName)
        .filter((knot): knot is KnotParts => knot !== null)
        .map((knot) => knot.prefix),
    )

    if (availableN1Options.length === 0) {
      setSelectedN1('')
      return
    }

    setSelectedN1((current) =>
      current && availableN1Options.includes(current)
        ? current
        : availableN1Options[0],
    )
  }, [knotNames])

  useEffect(() => {
    const availableN2Options = getUniqueSorted(
      knotNames
        .map(parseKnotName)
        .filter((knot): knot is KnotParts => knot !== null)
        .filter((knot) => knot.prefix === selectedN1)
        .map((knot) => knot.suffix),
    )

    if (!selectedN1 || availableN2Options.length === 0) {
      setSelectedN2('')
      return
    }

    setSelectedN2((current) =>
      current && availableN2Options.includes(current)
        ? current
        : availableN2Options[0],
    )
  }, [knotNames, selectedN1])

  useEffect(() => {
    let cancelled = false

    setDiagramPayload(null)
    setPayloadError(null)
    setKnotSvg('')
    setSvgError(null)
    setDebugJson('')
    setDebugError(null)

    if (!knotName) {
      return
    }

    async function loadDiagramPayload() {
      try {
        const res = await fetch(`/api/knots/${knotName}`)
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
  }, [knotName])

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
        <div className="moves_inputs">
          <label className="moves_label" htmlFor="knot-prefix">
            n1
          </label>
          <select
            id="knot-prefix"
            className="moves_input"
            value={selectedN1}
            disabled={knotOptionsLoading || knotN1Options.length === 0}
            onChange={(event) => setSelectedN1(event.target.value)}
          >
            {knotOptionsLoading ? (
              <option value="">Loading knots...</option>
            ) : knotN1Options.length === 0 ? (
              <option value="">No knot prefixes found</option>
            ) : (
              knotN1Options.map((n1) => (
                <option key={n1} value={n1}>
                  {n1}
                </option>
              ))
            )}
          </select>
          <label className="moves_label" htmlFor="knot-index">
            n2
          </label>
          <select
            id="knot-index"
            className="moves_input"
            value={selectedN2}
            disabled={
              knotOptionsLoading || knotN1Options.length === 0 || knotN2Options.length === 0
            }
            onChange={(event) => setSelectedN2(event.target.value)}
          >
            {knotOptionsLoading ? (
              <option value="">Loading knots...</option>
            ) : knotN2Options.length === 0 ? (
              <option value="">No matching n2 values</option>
            ) : (
              knotN2Options.map((n2) => (
                <option key={n2} value={n2}>
                  {n2}
                </option>
              ))
            )}
          </select>
        </div>
        <p className="moves_hint">
          Looks up <code>{knotName || 'n1_n2'}</code>
        </p>
      </div>
    </div>
  )

  return (
    <div className="background">
      <div className="container">
        <div className="knot_box">
          {knotOptionsLoading ? (
            <p className="knot_status">Loading knot options...</p>
          ) : knotListError ? (
            <p className="knot_status">{knotListError}</p>
          ) : !knotName ? (
            <p className="knot_status">
              Choose an <code>n1</code> and <code>n2</code> to load a knot.
            </p>
          ) : payloadError ? (
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
