// Expo SDK 52+ auto-configures pnpm monorepos (watchFolders + nodeModulesPaths).
// We only pin React / React Native to this app's copies: shared workspace packages
// (e.g. @elixir/local-store) carry their own React devDependency for web/tests, and a
// second React instance in the bundle would break hooks.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const SINGLETONS = ['react', 'react-dom', 'react-native', 'react-native-web'];
const appOrigin = path.join(__dirname, 'package.json');
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (SINGLETONS.some((s) => moduleName === s || moduleName.startsWith(`${s}/`))) {
    return resolve({ ...context, originModulePath: appOrigin }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
