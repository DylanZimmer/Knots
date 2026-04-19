import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import './App.css';
import * as moves from './moves_in_fn';

type KnotGeometryPayload = {
  name: string
  moves?: string[]
  vertex_positions: unknown
  arrows: unknown
  crossing_specs: unknown
}

type KnotMovesPayload = {
  name: string
  full_notation: moves.FullNotation | null
}

type InvariantValue = string | number | boolean | null
type KnotInvariantsPayload = Record<string, InvariantValue>

type PanelMode = 'moves' | 'invariants' | 'both'
type PanelKind = Exclude<PanelMode, 'both'>
type InvariantKey = string

type KnotParts = {
  prefix: string
  suffix: string
}

const MIN_PANEL_SPLIT = 0.25
const MAX_PANEL_SPLIT = 0.75
const PANEL_SPLIT_KEYBOARD_STEP = 0.05

function clampPanelSplit(value: number) {
  return Math.min(MAX_PANEL_SPLIT, Math.max(MIN_PANEL_SPLIT, value))
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

function formatInvariantLabel(key: string) {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

type MoveFunction = (fullNotation: moves.FullNotation) => moves.FullNotation

async function readJsonResponse(res: Response) {
  const text = await res.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    const trimmedText = text.trimStart()
    const responseType =
      trimmedText.startsWith('<!DOCTYPE') || trimmedText.startsWith('<html')
        ? 'HTML'
        : 'non-JSON content'

    throw new Error(
      `Expected JSON from ${res.url || 'the server'}, but received ${responseType} (${res.status} ${res.statusText})`,
    )
  }
}

function cloneFullNotation(fullNotation: moves.FullNotation): moves.FullNotation {
  return fullNotation.map((line) => ({
    ...line,
    edges: [...line.edges] as [number, number],
    lines: [...line.lines] as [number, number],
  }))
}

// ─── KnotPicker ─────────────────────────────────────────────────────────────

type KnotPickerProps = {
  knotN1Options: string[]
  knotN2Options: string[]
  knotOptionsLoading: boolean
  selectedN1: string
  selectedN2: string
  canSubmit: boolean
  onN1Change: (value: string) => void
  onN2Change: (value: string) => void
  onSubmit: () => void
}

function KnotPicker({
  knotN1Options,
  knotN2Options,
  knotOptionsLoading,
  selectedN1,
  selectedN2,
  canSubmit,
  onN1Change,
  onN2Change,
  onSubmit,
}: KnotPickerProps) {
  return (
    <div className="knot_picker" aria-label="Knot selector">
      <select
        id="knot-prefix"
        className="knot_picker_input"
        aria-label="n1"
        value={selectedN1}
        disabled={knotOptionsLoading || knotN1Options.length === 0}
        onChange={(event) => onN1Change(event.target.value)}
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
      <span className="knot_picker_sep" aria-hidden="true">
        _
      </span>
      <select
        id="knot-index"
        className="knot_picker_input"
        aria-label="n2"
        value={selectedN2}
        disabled={
          knotOptionsLoading || knotN1Options.length === 0 || knotN2Options.length === 0
        }
        onChange={(event) => onN2Change(event.target.value)}
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
      <button
        type="button"
        className="knot_picker_go"
        aria-label="Load selected knot"
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        Go
      </button>
    </div>
  )
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  const splitPanelRef = useRef<HTMLDivElement | null>(null)
  const panelDividerRef = useRef<HTMLDivElement | null>(null)
  const dragPointerIdRef = useRef<number | null>(null)
  const [knotNames, setKnotNames] = useState<string[]>([])
  const [knotOptionsLoading, setKnotOptionsLoading] = useState(true)
  const [knotListError, setKnotListError] = useState<string | null>(null)
  const [selectedN1, setSelectedN1] = useState('')
  const [selectedN2, setSelectedN2] = useState('')
  const [appliedKnotName, setAppliedKnotName] = useState('')
  const [hasInitializedAppliedKnot, setHasInitializedAppliedKnot] = useState(false)
  const [diagramPayload, setDiagramPayload] = useState<KnotGeometryPayload | null>(null)
  const [payloadError, setPayloadError] = useState<string | null>(null)
  const [movesPayload, setMovesPayload] = useState<KnotMovesPayload | null>(null)
  const [movesError, setMovesError] = useState<string | null>(null)
  const [invariantsPayload, setInvariantsPayload] = useState<KnotInvariantsPayload | null>(null)
  const [invariantsError, setInvariantsError] = useState<string | null>(null)
  const [knotSvg, setKnotSvg] = useState('')
  const [svgError, setSvgError] = useState<string | null>(null)
  const [panelMode, setPanelMode] = useState<PanelMode>('both')
  const [panelSplit, setPanelSplit] = useState(0.58)
  const [workingFullNotation, setWorkingFullNotation] = useState<moves.FullNotation | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [shownInvariantKeys, setShownInvariantKeys] = useState<InvariantKey[]>([])
  const [isEditingInvariants, setIsEditingInvariants] = useState(false)
  const [isDraggingPanelDivider, setIsDraggingPanelDivider] = useState(false)

  const parsedKnots = useMemo(
    () =>
      knotNames
        .map(parseKnotName)
        .filter((knot): knot is KnotParts => knot !== null),
    [knotNames],
  )

  const knotN1Options = useMemo(
    () => getUniqueSorted(parsedKnots.map((knot) => knot.prefix)),
    [parsedKnots],
  )

  const knotN2Options = useMemo(
    () =>
      getUniqueSorted(
        parsedKnots
          .filter((knot) => knot.prefix === selectedN1)
          .map((knot) => knot.suffix),
      ),
    [parsedKnots, selectedN1],
  )

  const draftKnotName =
    selectedN1 && selectedN2 && knotN2Options.includes(selectedN2)
      ? `${selectedN1}_${selectedN2}`
      : ''
  const knotName = appliedKnotName
  const canSubmitKnot = Boolean(draftKnotName) && draftKnotName !== knotName

  const activeFullNotation = useMemo(
    () => workingFullNotation ?? movesPayload?.full_notation ?? null,
    [movesPayload, workingFullNotation],
  )
  const moveEntries = useMemo(
    () => Object.entries(moves.movesNoArgument) as Array<[string, MoveFunction]>,
    [],
  )
  const appliedMovesText = useMemo(() => {
    if (!diagramPayload) {
      return payloadError ? 'Unavailable' : 'Loading...'
    }

    const currentMoves = Array.isArray(diagramPayload.moves)
      ? diagramPayload.moves
          .filter((move): move is string => typeof move === 'string')
          .map((move) => move.trim())
          .filter(Boolean)
      : []

    return currentMoves.length > 0 ? currentMoves.join(', ') : 'none'
  }, [diagramPayload, payloadError])

  const renderPayload = useMemo(() => diagramPayload, [diagramPayload])
  const availableInvariantKeys = useMemo(
    () => (invariantsPayload ? Object.keys(invariantsPayload) : []),
    [invariantsPayload],
  )

  // Load the list of available knot names
  useEffect(() => {
    let cancelled = false

    async function loadKnotNames() {
      try {
        const res = await fetch('/api/knots')
        const payload = await readJsonResponse(res)

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

  // Keep selectedN1 valid when knotNames changes
  useEffect(() => {
    if (knotN1Options.length === 0) {
      setSelectedN1('')
      return
    }

    setSelectedN1((current) =>
      current && knotN1Options.includes(current)
        ? current
        : knotN1Options[0],
    )
  }, [knotN1Options])

  // Keep selectedN2 valid when knotNames or selectedN1 changes
  useEffect(() => {
    if (!selectedN1 || knotN2Options.length === 0) {
      setSelectedN2('')
      return
    }

    setSelectedN2((current) =>
      current && knotN2Options.includes(current)
        ? current
        : selectedN1 === '0' && knotN2Options.includes('1')
          ? '1'
          : knotN2Options[0],
    )
  }, [knotN2Options, selectedN1])

  useEffect(() => {
    if (hasInitializedAppliedKnot || !draftKnotName) {
      return
    }

    setAppliedKnotName(draftKnotName)
    setHasInitializedAppliedKnot(true)
  }, [draftKnotName, hasInitializedAppliedKnot])

  useEffect(() => {
    if (!knotName) {
      return
    }

    if (knotNames.includes(knotName)) {
      return
    }

    setAppliedKnotName('')
  }, [knotName, knotNames])

  // Initialize the current diagram entry and load its payload when selected knot changes
  useEffect(() => {
    let cancelled = false

    setDiagramPayload(null)
    setPayloadError(null)
    setMovesPayload(null)
    setMovesError(null)
    setInvariantsPayload(null)
    setInvariantsError(null)
    setWorkingFullNotation(null)
    setMoveError(null)
    setKnotSvg('')
    setSvgError(null)

    if (!knotName) {
      return
    }

    async function loadDiagramPayload() {
      let diagramInitialized = false

      try {
        const res = await fetch('/api/knots/current', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: knotName }),
        })
        const payload = await readJsonResponse(res)

        if (!res.ok) {
          throw new Error(payload?.error || 'Failed to initialize current knot diagram')
        }

        if (!cancelled) {
          setDiagramPayload(payload)
          setPayloadError(null)
        }

        diagramInitialized = true

        const invariantsRes = await fetch('/api/knots/current/invariants')
        const invariantsPayload = await readJsonResponse(invariantsRes)

        if (!invariantsRes.ok) {
          throw new Error(invariantsPayload?.error || 'Failed to load current invariants')
        }

        if (!cancelled) {
          setInvariantsPayload(invariantsPayload)
          setInvariantsError(null)
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : 'Failed to initialize current knot diagram'

          if (!diagramInitialized) {
            setPayloadError(message)
          }

          setInvariantsPayload(null)
          setInvariantsError(message)
        }
      }
    }

    loadDiagramPayload()

    return () => {
      cancelled = true
    }
  }, [knotName])

  useEffect(() => {
    let cancelled = false

    if (!knotName) {
      setMovesPayload(null)
      setMovesError(null)
      return
    }

    async function loadMovesPayload() {
      try {
        const res = await fetch(`/api/knots/${knotName}/full-notation`)
        const payload = await readJsonResponse(res)

        if (!res.ok) {
          throw new Error(payload?.error || 'Failed to load full notation')
        }

        if (!cancelled) {
          setMovesPayload(payload)
          setMovesError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setMovesPayload(null)
          setMovesError(
            error instanceof Error ? error.message : 'Failed to load full notation',
          )
        }
      }
    }

    loadMovesPayload()

    return () => {
      cancelled = true
    }
  }, [knotName])

  useEffect(() => {
    setWorkingFullNotation(
      movesPayload?.full_notation ? cloneFullNotation(movesPayload.full_notation) : null,
    )
    setMoveError(null)
  }, [movesPayload])

  useEffect(() => {
    setShownInvariantKeys(availableInvariantKeys)
  }, [availableInvariantKeys])

  const updatePanelSplitFromClientY = useEffectEvent((clientY: number) => {
    const splitPanelElement = splitPanelRef.current

    if (!splitPanelElement) {
      return
    }

    const splitPanelRect = splitPanelElement.getBoundingClientRect()
    const dividerHeight = panelDividerRef.current?.getBoundingClientRect().height ?? 0
    const availablePanelHeight = splitPanelRect.height - dividerHeight

    if (availablePanelHeight <= 0) {
      return
    }

    const topPanelHeight = clientY - splitPanelRect.top - dividerHeight / 2
    const nextSplit = clampPanelSplit(topPanelHeight / availablePanelHeight)
    setPanelSplit(nextSplit)
  })

  useEffect(() => {
    if (!isDraggingPanelDivider) {
      return
    }

    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'

    function stopDragging(pointerId?: number) {
      if (pointerId != null && dragPointerIdRef.current !== pointerId) {
        return
      }

      dragPointerIdRef.current = null
      setIsDraggingPanelDivider(false)
    }

    function handlePointerMove(event: PointerEvent) {
      if (dragPointerIdRef.current !== event.pointerId) {
        return
      }

      updatePanelSplitFromClientY(event.clientY)
    }

    function handlePointerUp(event: PointerEvent) {
      stopDragging(event.pointerId)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [isDraggingPanelDivider, updatePanelSplitFromClientY])

  // Load the knot SVG once there is a geometry or full-notation render source
  useEffect(() => {
    if (!renderPayload) {
      return
    }

    let cancelled = false

    async function loadKnotVisuals() {
      try {
        const svgRes = await fetch('/api/knots/svg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(renderPayload),
        })

        const svg = await svgRes.text()

        if (!svgRes.ok) throw new Error(svg || 'Failed to load knot SVG')

        if (!cancelled) {
          setKnotSvg(svg)
          setSvgError(null)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load knot data'
          setSvgError(message)
        }
      }
    }

    loadKnotVisuals()

    return () => {
      cancelled = true
    }
  }, [renderPayload])

  function getSinglePanelLabel(kind: PanelKind) {
    return kind === 'moves' ? 'moves' : 'invariants'
  }

  function getSinglePanelOppositeLabel(kind: PanelKind) {
    return kind === 'moves' ? 'invariants' : 'moves'
  }

  function getPanelStatus(kind: PanelKind) {
    if (knotOptionsLoading) {
      return 'Loading knot options...'
    }

    if (knotListError) {
      return knotListError
    }

    if (!knotName) {
      return draftKnotName
        ? 'Press Go to load the selected knot.'
        : 'Choose an n1 and n2 to load a knot.'
    }

    if (kind === 'moves') {
      if (movesError) {
        return movesError
      }

      if (!movesPayload) {
        return 'Loading moves...'
      }

      if (!activeFullNotation) {
        return 'No moves are available for this knot.'
      }

      return null
    }

    if (invariantsError) {
      return invariantsError
    }

    if (!invariantsPayload) {
      return 'Loading invariants...'
    }

    return null
  }

  function getKnotVisualStatus() {
    if (knotOptionsLoading) {
      return 'Loading knot options...'
    }
    if (knotListError) {
      return knotListError
    }
    if (!knotName) {
      return draftKnotName
        ? 'Press Go to load the selected knot.'
        : 'Choose an n1 and n2 to load a knot.'
    }
    if (knotSvg) {
      return null
    }
    if (svgError) {
      return svgError
    }
    if (renderPayload) {
      return 'Rendering knot...'
    }
    if (payloadError) {
      return payloadError
    }
    return 'Loading knot data...'
  }

  async function handleMoveClick(moveName: string, move: MoveFunction) {
    if (!activeFullNotation) {
      return
    }

    try {
      const routeKey = moves.getMoveRouteKey(moveName)
      const res = await fetch(`/api/knots/current/${encodeURIComponent(routeKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const payload = await readJsonResponse(res)

      if (!res.ok) {
        throw new Error(payload?.error || `Failed to ${moveName}`)
      }

      setDiagramPayload(payload)
      setMoveError(null)
    } catch (error) {
      setMoveError(
        error instanceof Error ? error.message : `Failed to ${moveName}`,
      )
      return
    }

    const nextFullNotation = move(cloneFullNotation(activeFullNotation))
    setWorkingFullNotation(cloneFullNotation(nextFullNotation))
    setMoveError(null)
  }

  function toggleShownInvariant(key: InvariantKey) {
    setShownInvariantKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    )
  }

  function renderMovesContent() {
    if (!activeFullNotation) {
      return null
    }

    return (
      <div className="moves_panel">
        {moveError ? <p className="move_feedback">{moveError}</p> : null}
        <div className="move_status" aria-live="polite">
          <p className="move_status_value">{appliedMovesText}</p>
          <span className="move_status_label">moves applied</span>
        </div>
        <div className="move_list">
          {moveEntries.map(([moveName, move]) => {
            return (
              <button
                key={moveName}
                type="button"
                className="move_action_button"
                onClick={() => {
                  void handleMoveClick(moveName, move)
                }}
              >
                {moveName}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  function renderInvariantsContent() {
    if (!invariantsPayload) {
      return null
    }

    return (
      <div className="invariants_panel_wrap">
        <dl className="invariants_panel">
          {availableInvariantKeys
            .filter((key) => shownInvariantKeys.includes(key))
            .map((key) => (
              <div
                key={key}
                className={`invariant_row ${
                  key === 'alexander_polynomial' ? 'invariant_row--stacked' : ''
                }`}
              >
                <dt className="invariant_label">{formatInvariantLabel(key)}</dt>
                <dd
                  className={`invariant_value ${
                    key === 'alexander_polynomial' ? 'invariant_formula' : ''
                  }`}
                >
                  {invariantsPayload[key] ?? 'Not available'}
                </dd>
              </div>
            ))}
        </dl>
        {shownInvariantKeys.length === 0 ? (
          <p className="knot_status">No invariants are selected.</p>
        ) : null}
        <button
          type="button"
          className="panel_button panel_button--selector"
          onClick={() => setIsEditingInvariants(true)}
        >
          Change shown invariants
        </button>
      </div>
    )
  }

  function renderInvariantSelector() {
    return (
      <div className="selector_panel">
        <div className="selector_intro">
          Choose which invariants should appear in the invariants panel.
        </div>
        <div className="selector_list" role="group" aria-label="Shown invariants">
          {availableInvariantKeys.map((key) => (
            <label key={key} className="selector_option">
              <input
                type="checkbox"
                checked={shownInvariantKeys.includes(key)}
                onChange={() => toggleShownInvariant(key)}
              />
              <span>{formatInvariantLabel(key)}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          className="panel_button panel_button--selector"
          onClick={() => setIsEditingInvariants(false)}
        >
          Done
        </button>
      </div>
    )
  }

  function renderPanelContent(kind: PanelKind) {
    const status = getPanelStatus(kind)

    return status ? (
      <p className="knot_status">{status}</p>
    ) : kind === 'moves' ? (
      renderMovesContent()
    ) : (
      renderInvariantsContent()
    )
  }

  function handlePanelDividerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }

    dragPointerIdRef.current = event.pointerId
    setIsDraggingPanelDivider(true)
    updatePanelSplitFromClientY(event.clientY)
    event.preventDefault()
  }

  function handlePanelDividerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setPanelSplit((current) => clampPanelSplit(current - PANEL_SPLIT_KEYBOARD_STEP))
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setPanelSplit((current) => clampPanelSplit(current + PANEL_SPLIT_KEYBOARD_STEP))
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setPanelSplit(MIN_PANEL_SPLIT)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setPanelSplit(MAX_PANEL_SPLIT)
    }
  }

  const knotVisualStatus = getKnotVisualStatus()

  return (
    <div className="background">
      <div className="container">
        <div className="knot_box">
          <KnotPicker
            knotN1Options={knotN1Options}
            knotN2Options={knotN2Options}
            knotOptionsLoading={knotOptionsLoading}
            selectedN1={selectedN1}
            selectedN2={selectedN2}
            canSubmit={canSubmitKnot}
            onN1Change={setSelectedN1}
            onN2Change={setSelectedN2}
            onSubmit={() => setAppliedKnotName(draftKnotName)}
          />
          {knotSvg ? (
            // SVG is fetched from our own API — trusted source, no user input reflected
            <div className="knot_svg" dangerouslySetInnerHTML={{ __html: knotSvg }} />
          ) : knotVisualStatus ? (
            <p className="knot_status">
              {knotVisualStatus === 'Choose an n1 and n2 to load a knot.' ? (
                <>
                  Choose an <code>n1</code> and <code>n2</code> to load a knot.
                </>
              ) : knotVisualStatus === 'Press Go to load the selected knot.' ? (
                <>
                  Press <code>Go</code> to load the selected knot.
                </>
              ) : (
                knotVisualStatus
              )}
            </p>
          ) : (
            <p className="knot_status">
              {draftKnotName ? (
                <>
                  Press <code>Go</code> to load the selected knot.
                </>
              ) : (
                <>
                  Choose an <code>n1</code> and <code>n2</code> to load a knot.
                </>
              )}
            </p>
          )}
        </div>
        {isEditingInvariants ? (
          <div className="right_col">
            <div className="invariants_box panel_box panel_box--single">
              <div className="panel_header">shown invariants</div>
              <div className="panel_body">{renderInvariantSelector()}</div>
            </div>
          </div>
        ) : panelMode === 'both' ? (
          <div className="right_col right_col--split">
            <div ref={splitPanelRef} className="panel_split_stack">
              <div className="moves_box panel_box panel_box--top" style={{ flex: panelSplit }}>
                <div className="panel_header">moves</div>
                <div className="panel_body">{renderPanelContent('moves')}</div>
              </div>
              <div
                ref={panelDividerRef}
                role="separator"
                tabIndex={0}
                aria-label="Resize moves and invariants panels"
                aria-orientation="horizontal"
                aria-valuemin={MIN_PANEL_SPLIT * 100}
                aria-valuemax={MAX_PANEL_SPLIT * 100}
                aria-valuenow={Math.round(panelSplit * 100)}
                className={`panel_divider${
                  isDraggingPanelDivider ? ' panel_divider--dragging' : ''
                }`}
                onPointerDown={handlePanelDividerPointerDown}
                onKeyDown={handlePanelDividerKeyDown}
              >
                <span className="panel_divider_label">drag to resize</span>
              </div>
              <div
                className="invariants_box panel_box panel_box--bottom"
                style={{ flex: 1 - panelSplit }}
              >
                <div className="panel_header">invariants</div>
                <div className="panel_body">{renderPanelContent('invariants')}</div>
              </div>
            </div>
            <div className="panel_actions panel_actions--both">
              <button
                type="button"
                className="panel_button"
                onClick={() => setPanelMode('moves')}
              >
                show moves instead
              </button>
              <button
                type="button"
                className="panel_button"
                onClick={() => setPanelMode('invariants')}
              >
                show invariants instead
              </button>
            </div>
          </div>
        ) : (
          <div className="right_col">
            <div className={`${panelMode}_box panel_box panel_box--single`}>
              <div className="panel_header">{getSinglePanelLabel(panelMode)}</div>
              <div className="panel_body">{renderPanelContent(panelMode)}</div>
            </div>
            <div className="panel_actions">
              <button
                type="button"
                className="panel_button"
                onClick={() => setPanelMode('both')}
              >
                show {getSinglePanelOppositeLabel(panelMode)}
              </button>
              <button
                type="button"
                className="panel_button"
                onClick={() => setPanelMode(getSinglePanelOppositeLabel(panelMode))}
              >
                show {getSinglePanelOppositeLabel(panelMode)} instead
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
