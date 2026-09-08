const urlBase = 'http://localhost'

// Azure B2C issues refresh tokens when offline_access is requested without
// requiring prompt=consent, but oidc-provider strips offline_access unless that
// prompt is present. Add the prompt internally so public authorize requests
// remain B2C-compatible.
export const addConsentPromptForOfflineAccess = (method, requestUrl) => {
  const url = new URL(requestUrl, urlBase)
  const scopes = url.searchParams.get('scope')?.split(' ') || []

  if (
    method === 'GET' &&
    url.pathname === '/oidc/auth' &&
    scopes.includes('offline_access') &&
    !url.searchParams.has('prompt')
  ) {
    url.searchParams.set('prompt', 'consent')
  }

  return `${url.pathname}${url.search}`
}
