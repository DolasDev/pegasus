// ---------------------------------------------------------------------------
// Dynamic Expo config — app.json is the base, this layers on the parts that
// depend on the build environment.
//
// Today that is exactly one thing: `android.googleServicesFile`. Android push
// goes Expo Push Service → FCM, and FCM needs the Firebase client config
// (`google-services.json`) baked into the build to mint a token at all. That
// file is per-Firebase-project and is deliberately NOT in git (see .gitignore);
// it is supplied to EAS Build as a `file`-type env var, GOOGLE_SERVICES_JSON,
// which EAS materializes on the build machine and exposes as an absolute path:
//
//   eas env:create --name GOOGLE_SERVICES_JSON --type file --scope project \
//     --visibility secret --value ./google-services.json --environment production
//
// The existence check is what keeps this non-breaking: with no file present —
// local `expo start`, a CI typecheck, an iOS-only build — the key is simply
// omitted and the config is byte-identical to app.json. Point Expo at a
// missing googleServicesFile and prebuild fails hard, so "declare it only when
// it's really there" is the difference between this being inert and this being
// a broken build for everyone until the Firebase project exists.
// ---------------------------------------------------------------------------

const fs = require('fs')
const path = require('path')

/** Absolute path to the google-services.json for this build, or null. */
function resolveGoogleServicesFile() {
  // EAS `file`-type env vars arrive as an absolute path; a local override may
  // be relative to this directory.
  const fromEnv = process.env.GOOGLE_SERVICES_JSON
  const candidate = fromEnv
    ? path.isAbsolute(fromEnv)
      ? fromEnv
      : path.resolve(__dirname, fromEnv)
    : path.resolve(__dirname, 'google-services.json')

  return fs.existsSync(candidate) ? candidate : null
}

module.exports = ({ config }) => {
  const googleServicesFile = resolveGoogleServicesFile()

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  }
}
