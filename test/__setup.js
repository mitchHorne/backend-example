require('dotenv-safe').config({
  silent: true,
  path: 'test/.env.test'
})

const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')

chai.use(chaiAsPromised)

/**
 * Unhandled rejection handler for tests.
 *
 * @param {object} reason Reason for the rejection
 */
function unhandledRejectionHandler (
  reason
) {
  let msg = 'Unhandled Promise Rejection'
  // include the error message if reason is an error
  if (reason && reason.message) msg += ': ' + reason.message

  throw new Error(msg)
}

// ensure that we throw any unhandled promise rejections, and fail the tests
process.on('unhandledRejection', unhandledRejectionHandler)
