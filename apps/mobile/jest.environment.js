// react-native's jest-preset pins testEnvironment to its OWN
// jest-environment-node@^29 (node_modules/react-native/jest/react-native-env.js),
// whose ModuleMocker lacks the clearMocksOnScope API that jest-runtime >= 30.4
// calls — every suite dies with "this._moduleMocker.clearMocksOnScope is not a
// function". Recreate that (trivial) environment here so `jest-environment-node`
// resolves from apps/mobile's tree, which declares the jest-30-matched version.
'use strict';

const NodeEnv = require('jest-environment-node').TestEnvironment;

module.exports = class ReactNativeEnv extends NodeEnv {
  customExportConditions = ['require', 'react-native'];
};
