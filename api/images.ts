export { handleImages as default } from '../src/shared/server/billingHttp.js'
// Images can take longer than normal diagram operations. Configure the matching
// function duration in the hosting plan before enabling this provider.
export const maxDuration = 120
