const request = require('@bluerobot/request')
const R = require('ramda')
const { logger } = require('@bluerobot/monitoring')
const { COUPON_SERVICE_URL } = process.env

const DEFAULT_TIMEOUT = Number(process.env.CALL_ENDPOINT_TIMEOUT) || 10000
const DEFAULT_RETRY_STATUSES = [
  408, // request timeout
  503, // service unavailable
  504 // gateway timeout
]

const DEFAULT_RETRIES = Number(process.env.MAX_RETRIES) || 100
const defaultRetries = R.defaultTo(DEFAULT_RETRIES)

const isSocketTimedOut = R.pipe(R.defaultTo(''), R.endsWith('ESOCKETTIMEDOUT'))
const isTimedOut = R.pipe(R.defaultTo(''), R.endsWith('ETIMEDOUT'))
const isTimeoutError = R.pipe(
  R.defaultTo({}),
  R.propSatisfies(R.either(isSocketTimedOut, isTimedOut), 'code')
)
const isNotTimedOut = R.complement(isTimeoutError)

const getStatusFromError = R.pipe(
  R.prop('error'),
  R.ifElse(
    isNotTimedOut,
    R.prop('statusCode'), // status code error (i.e. 4xx or 5xx)
    R.pipe(
      // non-status code error (i.e. ESOCKETTIMEDOUT or ETIMEDOUT)
      R.prop('code')
    )
  )
)
const getStatusFromResponse = R.pathOr(204, ['response', 'statusCode'])

const hasError = R.pipe(R.prop('error'), R.complement(R.isNil))

const getStatusCode = R.ifElse(
  hasError,
  getStatusFromError,
  getStatusFromResponse
)

const removeEmptyAndNil = R.reject(R.either(R.isNil, R.isEmpty))

const isFacebookError = R.startsWith('https://graph.facebook.com')

/**
 * Parses a string containing status codes and returns an array.
 *
 * @param {string} stringValue Comma delimited value of status codes
 * @returns {number[]} Parsed status codes
 */
function getStatusArrayFromString (stringValue) {
  if (!stringValue) {
    logger.debug("Empty value provided, defaulting to '[]'")
    return []
  }

  return stringValue
    .split(',')
    .map(v => {
      const status = Number(v)
      if (!status) {
        // status is 0 or NaN
        logger.debug(
          `Failed to parse retry status '${status}', skipping this value`
        )
        return // eslint-disable-line
      }
      return status // eslint-disable-line
    })
    .filter(v => Number.isInteger(v))
}

/**
 * Get the retry statuses from the provided action, else use environment values.
 * Lastly defaults to 408 (request timeout), 503 (service unavailable) and
 * 504 (gateway timeout).
 *
 * @param {object} action Action to check for retry statuses.
 * @param {string} action.retryStatuses Retry statuses to override defaults with
 * @param {string} fromEnvironment Override environment configured retry statuses
 * @returns {number[]} Retry status codes
 */
function getRetryStatuses (
  action,
  fromEnvironment = process.env.CALL_ENDPOINT_RETRY_STATUSES
) {
  // first try the statuses included in the action
  if (action.retryStatuses) {
    return getStatusArrayFromString(action.retryStatuses)
  }

  // then try the ones from the environment
  if (fromEnvironment) return getStatusArrayFromString(fromEnvironment)

  // and finally use default
  return DEFAULT_RETRY_STATUSES
}

/**
 * @typedef CallEndpointAction
 * @property {string} method HTTP method
 * @property {string} url Endpoint URL
 * @property {object} [headers={}] Request headers
 * @property {object} body Request body
 * @property {object} form Request form fields
 * @property {object} query Request query parameters
 * @property {object} auth Request authorization
 * @property {number} timeout Timeout in milliseconds
 */

/**
 * Use request to call specified endpoint.
 *
 * @param {CallEndpointAction} action Call endpoint action
 * @param {object=} deps Dependencies
 * @param {object=} deps.requestParam request module
 * @returns {Promise<object>} Resolves with request response
 */
async function callEndpoint (
  action,
  // istanbul ignore next
  { requestParam = request } = {}
) {
  const {
    method,
    url,
    headers = {},
    body,
    form,
    query,
    auth,
    timeout,
    userId,
    widgetId
  } = action
  let retryRemaining = action.retryRemaining

  // verify that required field url is present
  if (!url) throw new Error("because required field 'url' is missing")

  // verify that required field method is present
  if (!method) throw new Error("because required field 'method' is missing")

  if (retryRemaining && isNaN(retryRemaining)) {
    throw new Error("'retryRemaining' must be a number")
  }

  let jsonBody = body

  // verify that body, if present, contains valid JSON
  if (body) {
    try {
      if (typeof body === 'string') {
        jsonBody = JSON.parse(body)
      }

      headers['Content-Type'] = 'application/json'
    } catch (err) {
      throw new Error('because of badly formatted JSON in the request body')
    }
  }

  const requestOptions = removeEmptyAndNil({
    method: method.toUpperCase(),
    url,
    headers,
    timeout: Number(timeout) || DEFAULT_TIMEOUT,
    json: jsonBody,
    form,
    ...auth,
    searchParams: query
  })

  let response, error
  try {
    response = await requestParam(requestOptions)
  } catch (e) {
    if (isFacebookError(requestOptions.url)) {
      const { HTTPError } = request
      if (e instanceof HTTPError) {
        const metaError = R.pathOr({}, ['response', 'body', 'error'], e)
        logger.error(
          { metaError },
          `Error processing request for widget ${widgetId}`
        )
        error = { message: metaError.message, statusCode: e.statusCode }
      } else if (isTimeoutError(e)) {
        error = {
          code: e.code,
          message: e.message,
          stack: e.stack,
          statusCode: 408,
          type: e.type
        }
      } else {
        logger.error(
          { err: e, body: jsonBody, widgetId },
          'Error processing request'
        )
        const message = R.propOr({}, 'body', e.response)
        const statusCode = R.propOr(500, 'statusCode', e.response)
        error = { message, statusCode }
      }
    } else error = e
  }

  const status = getStatusCode({ error, response })
  const retryStatuses = getRetryStatuses(action)

  const noRemainingRetries = R.pipe(Number, R.gte(0))
  const dontRetryOrNoRetriesRemaining = R.either(R.isNil, noRemainingRetries)

  /**
   * A timeout usually only happens when there's something temporarily wrong with the
   * network
   * Or when the service on the other end is restarting
   * So we always retry them
   * It can also be due to a firewall dropping packets,
   * or the other service just giving silent treatment
   * but we'll burn that bridge when we get there
   */

  const getErrorResponse = error => error && error?.message
  const getResponseBody = response =>
    response?.body ? response.body : response

  if (error && isTimeoutError(error)) {
    retryRemaining = defaultRetries(retryRemaining)

    logger.warn(
      {
        method,
        url,
        err: error,
        userId,
        widgetId,
        timeout: Number(timeout) || DEFAULT_TIMEOUT,
        retryRemaining
      },
      `A timeout occurred processing a request for owner '${userId}'`
    )
  }

  if (dontRetryOrNoRetriesRemaining(retryRemaining) && error) {
    throw new Error(error.message)
  }

  const retry = R.or(isTimeoutError(error), retryStatuses.includes(status))

  return {
    status,
    body: getErrorResponse(error) || getResponseBody(response),
    retry,
    retryRemaining: retry ? retryRemaining : undefined
  }
}

const unlockCoupons = async (action, { req = request } = {}) => {
  const { widgetId } = action
  const actionBody = {
    body: JSON.stringify(action),
    method: 'POST',
    url: `${COUPON_SERVICE_URL}/coupon/unlock/${action.widgetId}`
  }
  try {
    const { statusCode: status } = await req(actionBody)
    return status
  } catch (err) {
    const message = R.propOr({}, 'body', err.response)
    const statusCode = R.propOr(500, 'statusCode', err.response)
    logger.error(
      { message, statusCode },
      `Failed call to coupon service to update coupons for widget ${widgetId}`
    )
    return 500
  }
}

module.exports = {
  DEFAULT_TIMEOUT,
  DEFAULT_RETRY_STATUSES,
  getStatusArrayFromString,
  getRetryStatuses,
  callEndpoint,
  getStatusCode,
  removeEmptyAndNil,
  unlockCoupons
}
