// The viewer goes in the JS bundle's assets as a zip (scripts/zip-viewer.mjs), so EAS Update carries it.
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.resolver.assetExts.push('zip')
module.exports = config
