import { Notifier } from '@airbrake/browser'

// TODO: move these to a config if we vr have a frontnd config
const PROJECT_ID = 315072
const PROJECT_KEY = 'a5bc0fa8148829e6c037e511b2361912'

const airbrake = new Notifier({
  projectId: PROJECT_ID,
  projectKey: PROJECT_KEY,
  environment: process.env.NODE_ENV,
})

class Logger {
  private readonly name: string
  constructor(name: string) {
    this.name = name
  }
  info(...args: any) {
    console.log(...args)
  }
  warn(error: Error, context: Object = {}) {
    console.warn(error, context)
    airbrake.notify({
      error,
      context: {
        severity: 'warning',
        ...context,
        name: this.name,
      },
    })
  }
  error(error: Error, context: Object = {}) {
    console.error(error, context)
    airbrake.notify({
      error,
      context: {
        ...context,
        name: this.name,
      },
    })
  }
}

export default new Logger('default')
