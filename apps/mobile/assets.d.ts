// Static asset modules.
//
// Metro resolves `import logo from './x.png'` to an asset reference that
// <Image source={...}> accepts, but TypeScript has no built-in knowledge of
// that: Expo's tsconfig.base ships no image declarations and this app has no
// expo-env.d.ts, so the import fails typecheck with TS2307.
//
// `number` is the honest type on native — Metro replaces the import with an
// opaque asset registry id. On web it is an object, which is why the return is
// widened to what react-native's ImageSourcePropType already accepts.
declare module '*.png' {
  const asset: number
  export default asset
}

declare module '*.jpg' {
  const asset: number
  export default asset
}

declare module '*.svg' {
  const asset: number
  export default asset
}
