// Web stub for react-native-document-scanner-plugin.
//
// The real module is a bare native TurboModule — its entry point runs
// `TurboModuleRegistry.getEnforcing('DocumentScanner')` at MODULE SCOPE and it
// ships no web implementation. Under react-native-web that throws during import,
// and because src/services/documentCapture.ts imports it, the throw takes down
// the entire `shipment/[orderNum]` route: the screen renders as a blank white
// page with "Cannot read properties of undefined (reading 'getEnforcing')".
//
// metro.config.js aliases this file in for EVERY web bundle — `expo start --web`
// in development and the store-screenshot export alike. Device (ios/android)
// builds resolve the real native module, unchanged.
//
// Scanning is a native camera flow with no browser equivalent, so the stub only
// has to be import-safe and type-shaped. Calling scanDocument
// returns a cancelled response, which is the same thing the real plugin returns
// when the user backs out of the scanner.

export const ResponseType = {
  ImageFilePath: 'imageFilePath',
  Base64: 'base64',
}

export const ScanDocumentResponseStatus = {
  Success: 'success',
  Cancel: 'cancel',
}

const DocumentScanner = {
  scanDocument: async () => ({
    status: ScanDocumentResponseStatus.Cancel,
    scannedImages: [],
  }),
}

export default DocumentScanner
