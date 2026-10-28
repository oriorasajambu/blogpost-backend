/** Versioned input policy shared by snapshot preparation and CI classification. */
export function isNonexecutingDocumentation(path: string): boolean {
  if (path.split('/').at(-1) === 'API_CONTRACT_V1.md') return false;
  return (
    ['README.md', 'LICENSE', 'LICENSE.md'].includes(path) ||
    /^docs\/(?:[^/]+\/)*[^/]+\.md$/.test(path)
  );
}

export function isForbiddenSourcePath(path: string): boolean {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes(':') ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return true;
  if (/(^|\/)\.env(?:$|\.)/i.test(path) && path !== '.env.example') return true;
  return (
    /(^|\/)(?:\.git|\.local|\.ssh|\.aws|\.config|node_modules|\.gradle|\.kotlin)(?:\/|$)/i.test(
      path,
    ) ||
    /^(?:dist|coverage|src\/generated)(?:\/|$)/i.test(path) ||
    /(?:^|\/)(?:key\.properties|local\.properties|gha-creds-[^/]+\.json)$/i.test(
      path,
    ) ||
    /(?:\.(?:jks|keystore|p12|pfx|key|pem)|(?:^|\/)id_(?:rsa|ed25519))$/i.test(
      path,
    ) ||
    /(?:^|\/)\.gitleaksignore$/i.test(path)
  );
}
