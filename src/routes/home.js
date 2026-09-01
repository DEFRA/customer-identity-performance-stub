/**
 * Home page route
 */

import homeHandler from '../handlers/home.js'

export default {
  method: 'GET',
  path: '/',
  handler: homeHandler
}
