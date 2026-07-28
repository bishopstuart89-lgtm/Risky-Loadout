/**
 * Temporary diagnostic. Visit /api/debug on the deployment that is failing.
 *
 * Reports whether the function can see the key, and which deployment
 * environment it is running in. Never returns the key itself — only its
 * length and whether it has the expected prefix.
 *
 * DELETE THIS FILE once the problem is found.
 */
export default function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const key = process.env.ANTHROPIC_API_KEY;

  // Names only, never values. A typo in the variable name shows up here.
  const anthropicish = Object.keys(process.env)
    .filter(k => /anthropic|claude|api.?key/i.test(k))
    .sort();

  res.status(200).json({
    keyVisible: Boolean(key),
    keyLength: key ? key.length : 0,
    keyLooksRight: key ? key.startsWith('sk-ant-') : false,
    keyHasWhitespace: key ? /^\s|\s$/.test(key) : false,

    refreshTokenSet: Boolean(process.env.REFRESH_TOKEN),

    // Which environment is this deployment actually running as?
    vercelEnv: process.env.VERCEL_ENV || '(not on Vercel)',
    vercelTargetEnv: process.env.VERCEL_TARGET_ENV || '(unset)',
    deploymentUrl: process.env.VERCEL_URL || '(unset)',
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || '(unset)',
    branch: process.env.VERCEL_GIT_COMMIT_REF || '(unset)',

    // Variable names matching anything key-like, so a typo is obvious.
    matchingVariableNames: anthropicish,
    totalEnvVars: Object.keys(process.env).length,

    nodeVersion: process.version,
    checkedAt: new Date().toISOString()
  });
}
