// Static asset modules.
//
// Metro resolves `import logo from './x.png'` to an asset reference that
// <Image source={...}> accepts, but TypeScript has no built-in knowledge of
// that: Expo's tsconfig.base ships no image declarations and this app has no
// expo-env.d.ts, so the import fails typecheck with TS2307.
//
// `number` is the honest type on native — Metro replaces the import with an
// opaque asset registry id. On web it resolves to an object, and both forms are
// accepted by react-native's ImageSourcePropType.
//
// Only the extensions Metro's default asset resolver actually handles are
// declared. `*.svg` deliberately is NOT: this app has no
// react-native-svg-transformer, so declaring it would let an SVG import pass
// typecheck and then fail at runtime.
declare module '*.png' {
  const asset: number
  export default asset
}

declare module '*.jpg' {
  const asset: number
  export default asset
}
