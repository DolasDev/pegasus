// Web stub for react-native-document-scanner-plugin.
//
// The real module is a bare native TurboModule — its entry point runs
// `TurboModuleRegistry.getEnforcing('DocumentScanner')` at MODULE SCOPE and it
// ships no web implementation. Under react-native-web that throws during import,
// and because src/services/documentCapture.ts imports it, the throw takes down
// the entire `shipment/[orderNum]` route: the screen renders as a blank white
// page with "Cannot read properties of undefined (reading 'getEnforcing')".
//
// The store-screenshot capture needs that screen (it is where documents live),
// so metro.config.js aliases this file in — but ONLY for a web bundle and ONLY
// when PEGASUS_STORE_CAPTURE=1. Device builds resolve the real native module,
// unchanged.
//
// Scanning is a camera flow that cannot happen in a headless browser anyway, so
// the stub only has to be import-safe and type-shaped. Calling scanDocument
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
