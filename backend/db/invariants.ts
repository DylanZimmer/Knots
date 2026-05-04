import { getSupabase } from '../supabase'
import {
  type DiagramGeometryPayload,
  type KnotInvariantsRecord,
  createHttpError,
  normalizeInvariantValue,
} from './common'
import { getKnotIdByName } from './knots'
import { getCurrentDiagramGeometry } from './diagrams'

export async function getStoredKnotInvariants(name: string) {
  const supabase = getSupabase()
  const knotId = await getKnotIdByName(name)

  for (const knotKey of ['id', 'name'] as const) {
    const queryValue = knotKey === 'id' ? knotId : name

    if (queryValue == null) {
      continue
    }

    const { data: invariantsRow, error: invariantsError } = await supabase
      .from('invariants_rolf')
      .select('id, name, determinant, alexander_polynomial, jones_polynomial')
      .eq(knotKey, queryValue)
      .single()

    if (!invariantsError && invariantsRow) {
      const {
        name: storedName,
        determinant,
        alexander_polynomial,
        jones_polynomial,
      } = invariantsRow as KnotInvariantsRecord

      return {
        name:
          typeof storedName === 'string' && storedName.trim().length > 0
            ? storedName
            : name,
        determinant: normalizeInvariantValue(determinant),
        alexander_polynomial: normalizeInvariantValue(alexander_polynomial),
        jones_polynomial: normalizeInvariantValue(jones_polynomial),
      }
    }
  }

  console.error('Knot invariants not found for:', name)
  throw createHttpError(404, `No invariants data for '${name}'`)
}

function getCurrentInvariantBaseName(currentDiagram: DiagramGeometryPayload) {
  if (
    typeof currentDiagram.name === 'string' &&
    currentDiagram.name.trim().length > 0
  ) {
    return currentDiagram.name
  }

  throw createHttpError(404, 'No current knot diagram is available for invariants')
}

export async function getCurrentKnotInvariants() {
  const currentDiagram = await getCurrentDiagramGeometry()
  const baseName = getCurrentInvariantBaseName(currentDiagram)
  const invariants = await getStoredKnotInvariants(baseName)

  return {
    base_name: invariants.name,
    determinant: normalizeInvariantValue(invariants.determinant),
    alexander_polynomial: normalizeInvariantValue(invariants.alexander_polynomial),
    jones_polynomial: normalizeInvariantValue(invariants.jones_polynomial),
  }
}
