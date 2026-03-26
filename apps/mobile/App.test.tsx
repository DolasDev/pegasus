import React from 'react'
import { render } from '@testing-library/react-native'
import App from './App'

describe('App', () => {
  it('renders without crashing', () => {
    const { getByTestId } = render(<App />)
    expect(getByTestId('app-image')).toBeTruthy()
  })

  it('displays an image', () => {
    const { getByTestId } = render(<App />)
    const image = getByTestId('app-image')

    // Verify the image component exists
    expect(image).toBeTruthy()

    // Verify it has the correct style dimensions
    expect(image.props.style).toMatchObject({
      width: 300,
      height: 141,
    })
  })

  it('renders the app structure correctly', () => {
    const { toJSON } = render(<App />)
    const tree = toJSON()

    // Verify the component renders successfully
    expect(tree).toBeTruthy()
  })
})
