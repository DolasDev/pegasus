// Module declarations for third-party packages without bundled or @types type definitions.
// These allow TypeScript to import these modules without errors.

declare module 'downshift' {
  import { Component } from 'react'
  const Downshift: any
  export default Downshift
}

declare module 'react-select' {
  const ReactSelect: any
  export default ReactSelect
}

declare module 'redux-logger' {
  const logger: any
  export default logger
}

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.svg' {
  const content: string
  export default content
}

declare module 'classnames' {
  const classNames: (...args: any[]) => string
  export default classNames
}
