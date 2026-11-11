// Expo configuration with a development variant: with APP_VARIANT=development the app is called
// "La Estantería_dev" and uses the .dev package, so it lives next to the real one on the same phone.
const base = require('./app.json').expo

const IS_DEV = process.env.APP_VARIANT === 'development'

module.exports = {
  ...base,
  name: IS_DEV ? `${base.name}_dev` : base.name,
  scheme: IS_DEV ? `${base.scheme}-dev` : base.scheme,
  android: { ...base.android, package: IS_DEV ? `${base.android.package}.dev` : base.android.package },
}
