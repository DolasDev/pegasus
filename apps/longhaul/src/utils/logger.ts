class Logger {
  private readonly name: string
  constructor(name: string) {
    this.name = name
  }
  info(...args: any) {
    console.log(`[${this.name}]`, ...args)
  }
  warn(error: Error, context: Object = {}) {
    console.warn(`[${this.name}]`, error, context)
  }
  error(error: Error, context: Object = {}) {
    console.error(`[${this.name}]`, error, context)
  }
}

export default new Logger('default')
