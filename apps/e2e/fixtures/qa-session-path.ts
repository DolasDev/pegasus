import { resolve } from 'path'

// Single source of truth for where the qa-setup project writes (and the qa-*
// fixtures read) the captured QA browser session. Kept side-effect-free so it
// can be imported from playwright.config.ts as well as from fixtures/specs.
export const QA_SESSION_PATH = resolve(__dirname, '..', 'playwright', '.auth', 'qa-session.json')
