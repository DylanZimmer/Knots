const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''

const normalizedApiBaseUrl = rawApiBaseUrl.replace(/\/+$/, '')

export function getApiUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`API paths must start with '/'. Received '${path}'.`)
  }

  return normalizedApiBaseUrl ? `${normalizedApiBaseUrl}${path}` : path
}
