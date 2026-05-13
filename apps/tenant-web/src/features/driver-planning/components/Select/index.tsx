import React from 'react'
import ReactSelect from 'react-select'

// `classNamePrefix` gives react-select's internals stable, documented class
// names (`rs__control`, `rs__menu`, `rs__option`, `rs__multi-value`, …)
// alongside the emotion-hashed ones — without it the only way to target a chip
// or a menu option in a test is by text, which is brittle. It changes nothing
// visually (no CSS targets these names; styling goes through the `styles` prop).
export function Select({ ...rest }: any) {
  return <ReactSelect classNamePrefix="rs" {...rest} />
}
