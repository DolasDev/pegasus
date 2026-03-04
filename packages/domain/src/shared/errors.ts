// ---------------------------------------------------------------------------
// Domain errors
//
// DomainError is the base class for all business-rule violations raised by
// the domain layer. The API layer catches DomainError and logs at WARN
// (not ERROR) because these are expected, handled failures — not bugs.
//
// Zero imports: this file must remain dependency-free.
// ---------------------------------------------------------------------------

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}
