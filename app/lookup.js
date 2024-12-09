const R = require('ramda')
const { logger, metrics } = require('@bluerobot/monitoring')
const request = require('@bluerobot/request')
const Tokenizer = require('wink-tokenizer')
const { getStatusCode, removeEmptyAndNil } = require('./endpoints')
const utils = require('./utils')

const stringTokenizer = new Tokenizer()

// Status code boundaries for different HTTP status code groups
const SUCCESS_CODE_MIN = 200
const SUCCESS_CODE_MAX = 299
const REDIRECT_CODE_MIN = 300
const REDIRECT_CODE_MAX = 399
const CLIENT_ERROR_CODE_MIN = 400
const CLIENT_ERROR_CODE_MAX = 499
const SERVER_ERROR_CODE_MIN = 500
const SERVER_ERROR_CODE_MAX = 599

// Specific status codes used for logic that applies to specific status codes
const STATUS_CODE_BAD_GATEWAY = 502
const STATUS_CODE_SERVICE_UNAVAILABLE = 503
const STATUS_CODE_GATEWAY_TIMEOUT = 504
const STATUS_CODE_NOT_FOUND = 404

// Array of specific status codes which indicate a transient error
const TRANSIENT_ERROR_STATUS_CODES = [
  STATUS_CODE_BAD_GATEWAY,
  STATUS_CODE_SERVICE_UNAVAILABLE,
  STATUS_CODE_GATEWAY_TIMEOUT
]

// Constants used for building request object
const REQUEST_METHOD = 'GET'
const REQUEST_TIMEOUT = 5000

// Constants used to define limits for field values
const CHARACTER_LIMIT = 30
const CONSECUTIVE_PUNCTUATION_LIMIT = 3

// Constants used for testing the type of wink-tokenizer tokens
const URL_TOKEN_TAG = 'url'
const PUNCTUATION_TOKEN_TAG = 'punctuation'

// Check if status code indicates success
const isSuccessStatusCode = R.both(
  R.lte(SUCCESS_CODE_MIN),
  R.gte(SUCCESS_CODE_MAX)
)

// Check if status code indicates a redirect
const isRedirectStatusCode = R.both(
  R.lte(REDIRECT_CODE_MIN),
  R.gte(REDIRECT_CODE_MAX)
)

// Check if status code indicates a client error
const isClientErrorStatusCode = R.both(
  R.lte(CLIENT_ERROR_CODE_MIN),
  R.gte(CLIENT_ERROR_CODE_MAX)
)

// Check if status code indicates a server error
const isServerErrorStatusCode = R.both(
  R.lte(SERVER_ERROR_CODE_MIN),
  R.gte(SERVER_ERROR_CODE_MAX)
)

/*
 * Check if status indicates a transient error. This applies to BAD GATEWAY (502),
 * SERVICE UNAVAILABLE (503), and GATEWAY TIMEOUT (504)
 */
const isTransientServerError = R.flip(R.includes)(TRANSIENT_ERROR_STATUS_CODES)

/*
 * Check if status implies a "permanent expected" error. This applies to
 * all non-transient server errors, as well as NOT FOUND (404)
 */
const isPermanentExpectedError = R.anyPass([
  R.equals(STATUS_CODE_NOT_FOUND),
  R.allPass([isServerErrorStatusCode, R.complement(isTransientServerError)])
])

/*
 * Check if status implies a "permanent unexpected" error. This applies to
 * redirect status codes (300-399) and all client error status codes (400-499)
 * other than NOT FOUND (404), as well as NodeJS timeout errors
 */
const isPermanentUnexpectedError = R.anyPass([
  isRedirectStatusCode,
  R.allPass([
    isClientErrorStatusCode,
    R.complement(R.equals(STATUS_CODE_NOT_FOUND))
  ])
])

// If input value is a string then return it as-is, otherwise convert to string
const getAsString = R.ifElse(R.is(String), R.identity, R.toString)

// Tests if a value exceeds the character limit defined by VALUE_CHARACTER_LIMIT
const isExceedingCharacterLimit = R.pipe(
  getAsString,
  R.length,
  R.lt(CHARACTER_LIMIT)
)

// Takes an object and checks if the 'tag' property equals the value in PUNCTUATION_TOKEN_TAG
const isPunctuationToken = R.propEq('tag', PUNCTUATION_TOKEN_TAG)

/**
 * Used for a "reduce". Will increment the accumulated value if the incoming token is a punctuation token,
 * otherwise it will reset the accumulated value to 0
 *
 * @param {number} accumulatedValue the value accumulated over the course of a "reduce"
 * @param {object} currentValue the string token for the current item from a list created by wink-tokenizer
 * @param {string} currentValue.value the value of the token created by wink-tokenizer
 * @param {string} currentValue.tag the tag assigned to the token by wink-tokenizer (i.e. 'word', 'punctuation')
 * @returns {number} the new accumulated value
 */
const cumulativelyCountConsecutivePunctuation = (
  accumulatedValue,
  currentValue
) => (isPunctuationToken(currentValue) ? R.inc(accumulatedValue) : 0)

// Split value into tokens using wink-tokenizer
const getStringTokens = R.pipe(getAsString, stringTokenizer.tokenize)

// Check if the incoming number value is less than or equal to the CONSECUTIVE_PUNCTUATION_LIMIT
const isWithinPunctuationLimit = R.gt(CONSECUTIVE_PUNCTUATION_LIMIT)

// Get the maximum number of consecutive punctuation tokens, limited to a maximum defined by CONSECUTIVE_PUNCTUATION_LIMIT
const getMaximumConsecutivePunctiation = R.reduceWhile(
  isWithinPunctuationLimit,
  cumulativelyCountConsecutivePunctuation,
  0
)

/**
 * Splits a value into tokens using wink-tokenizer and checks whether or not there is consecutive punctuation use which exceeds
 * the limit defined by CONSECUTIVE_PUNCTUATION_LIMIT
 */
const containsExcessivePunctuation = R.pipe(
  getStringTokens,
  getMaximumConsecutivePunctiation,
  R.complement(isWithinPunctuationLimit)
)

// Takes an object and checks if the 'tag' property equals the value in URL_TOKEN_TAG
const isUrlToken = R.propEq('tag', URL_TOKEN_TAG)

// Splits a value into tokens using wink-tokenizer and checks if any of then are a URL
const containsUrlInText = R.pipe(
  getStringTokens,
  R.filter(isUrlToken),
  R.complement(R.isEmpty)
)

/**
 * Tests the validity of a value. A value is valid so long as it:
 * Is not empty
 * Does not exceed the character limit defined character limit
 * Does not contain excessive punctuation
 * Does not contain a URL somewhere in the text
 */
const isValueValid = R.complement(
  R.anyPass([
    R.isNil,
    R.empty,
    isExceedingCharacterLimit,
    containsExcessivePunctuation,
    containsUrlInText
  ])
)

/**
 * Retrieves the value of a given property from a given object
 *
 * @param {string} propertyName the name of the property to retrieve the value of
 * @param {object} dataObject the object to retrieve the value from
 * @returns {any} the value of the given property in the object
 */
const getValueOfProperty = (propertyName, dataObject) =>
  R.propOr(null, propertyName)(dataObject)

/**
 * Checks if incoming value is an object or not. If it is a JSON object then it is stringified and returned,
 * otherwise it will be returned as-is
 *
 * @param {any} data the incoming data that may or may not be an object
 * @returns {string} the resulting JSON string
 */
const stringifyIfObject = data =>
  R.is(Object, data) ? JSON.stringify(data) : data

/**
 * Retrieves the value of the identifier (as defined within the action) in the data object
 *
 * @param {LookupApiAction} action lookup api action
 * @param {object | string} data the data returned from the API request
 * @returns {any} the value of the field value within the object
 */
function getIdentifierValue (action, data) {
  const { id } = action

  const json = utils.tryParseJson(data)

  const identifierValue = getValueOfProperty(id, json)

  return identifierValue
}

/**
 * Builds the API request object using the incoming lookup api action
 *
 * @param {LookupApiAction} action the incoming lookup api action
 * @returns {object} the api request to use in the api call
 */
function buildApiRequest (action) {
  const { url, id, username, password } = action

  const apiRequest = removeEmptyAndNil({
    method: REQUEST_METHOD,
    url,
    username,
    password,
    searchParams: {
      identifier: id
    },
    timeout: REQUEST_TIMEOUT
  })

  return apiRequest
}

/**
 * Send request to the client's API to retrieve lookup data
 *
 * @param {object} requestParam the request module
 * @param {LookupApiAction} action the incoming lookup api action
 * @returns {object} the result of the api call
 */
async function lookupDataOnApi (requestParam, action) {
  const apiRequest = buildApiRequest(action)

  let data, error
  try {
    data = await requestParam(apiRequest)
  } catch (e) {
    error = e
  }

  return {
    data: data && data.body ? data.body : data,
    error: error || null
  }
}

/**
 * Throws an error if one of the required fields are missing or blank
 *
 * @param {LookupApiAction} action lookup api action
 * @throws
 */
function throwErrorIfMissingFields (action) {
  const { url, id } = action

  if (!url) throw new Error("Required field 'url' is missing")
  if (!id) throw new Error("Required field 'id' is missing")
}

/**
 * Generic function that builds the object to use in warn/error logs
 *
 * @param {string} url the url being requested
 * @param {string} id  the identifier for the data being requested
 * @param {object | string} error the error response body
 * @returns {object} object to be used in warning/error log
 */
function buildErrorLogData (url, id, error) {
  return {
    url,
    id,
    err: error
  }
}

/**
 * Builds the response to be returned to action-processor
 *
 * @param {object} data the settings used in building the response
 * @param {boolean} data.lookupFailed indicates whether or not the lookup failed
 * @param {boolean} data.lookupTransientError indicates whether or not the lookup experienced a transient error
 * @param {object} data.body the response data to return
 * @returns {LookupApiResponse} the response to return to the action-processor
 */
function buildLookupResponse (data) {
  const { lookupFailed, lookupTransientError, body } = data

  const lookupResponse = {
    lookupFailed: lookupFailed || false,
    lookupTransientError: lookupTransientError || false,
    body: body ? stringifyIfObject(body) : null
  }

  return lookupResponse
}

/**
 * Tests the validity of a successful API response and returns a lookup response acfordingly
 *
 * @param {LookupApiAction} action lookup api action
 * @param {object | string} data the data returned by the API
 * @returns {LookupApiResponse} the response to return to the action-processor
 */
function getSuccessResponse (action, data) {
  const value = getIdentifierValue(action, data)

  if (!isValueValid(value)) {
    const { url, id } = action

    const logData = buildErrorLogData(url, id, `Invalid field value: ${value}`)

    logger.warn(
      logData,
      'API response returned an invalid field value for request'
    )

    return buildLookupResponse({ lookupFailed: true })
  }

  return buildLookupResponse({ body: data })
}

/**
 * Logs a warning, increments the relevant metric, and returns a lookup response
 * for transient errors
 *
 * @param {string} url the url to send the lookup request to
 * @param {string} id the identifier of the data that we are requesting
 * @param {object | string} error the error response body
 * @returns {LookupApiResponse} the response to return to the action-processor
 */
function getTransientErrorResponse (url, id, error) {
  const logData = buildErrorLogData(url, id, error)

  logger.warn(
    logData,
    `Transient error occured making lookup request to: ${url}`
  )

  return buildLookupResponse({ lookupTransientError: true })
}

/**
 * Logs a warning, increments the relevant metric, and returns a lookup response
 * for permanent expected errors
 *
 * @param {string} url the url being requested
 * @param {string} id  the identifier for the data being requested
 * @param {object | string} error the API request error
 * @returns {LookupApiResponse} the response to return to the action-processor
 */
function getPermanentExpectedResponse (url, id, error) {
  const logData = buildErrorLogData(url, id, error)

  logger.warn(
    logData,
    `Permanent Expected error occured making lookup request to: ${url}`
  )

  metrics.increment('actions.process.lookup_api.permanent_expected_error')

  return buildLookupResponse({ lookupFailed: true, data: error })
}

/**
 * Logs a warning, increments the relevant metric, and returns a lookup response
 * for permanent unexpected errors
 *
 * @param {string} url the url being requested
 * @param {string} id  the identifier for the data being requested
 * @param {object | string} error the API request error
 * @returns {LookupApiResponse} the response to return to the action-processor
 */
function getPermanentUnexpectedResponse (url, id, error) {
  const logData = buildErrorLogData(url, id, error)

  logger.error(
    logData,
    `Permanent Unexpected error occured making lookup request to: ${url}`
  )

  metrics.increment('actions.process.lookup_api.permanent_unexpected_error')

  return buildLookupResponse({ lookupFailed: true, data: error })
}

/**
 * Logs a warning, increments the relevant metric, and returns a lookup response
 * for lookup errors which are not specifically catered for by status checks
 *
 * @param {string} url the url being requested
 * @param {string} id  the identifier for the data being requested
 * @param {object | string} error the API request error
 * @returns {LookupApiResponse} the response to return to the action-processor
 */
function getGeneralLookupFailureResponse (url, id, error) {
  const logData = buildErrorLogData(url, id, error)

  logger.error(logData, `Error occured making lookup request to: ${url}`)

  metrics.increment('actions.process.lookup_api.general_error')

  return buildLookupResponse({ lookupFailed: true, data: error })
}

/**
 * Returns the lookup response based on the given response or error
 *
 * @param {LookupApiAction} action  the incoming lookup api action
 * @param {object | string} data the data returned from the lookup API endpoint
 * @param {object | string} error the API request error
 * @returns {LookupApiResponse} the response to return to the action-processor
 */
function getLookupResponse (action, data, error) {
  const { url, id } = action

  const status = getStatusCode({ error, response: data })

  const getResponse = R.cond([
    [isSuccessStatusCode, () => getSuccessResponse(action, data)],
    [isTransientServerError, () => getTransientErrorResponse(url, id, error)],
    [
      isPermanentExpectedError,
      () => getPermanentExpectedResponse(url, id, error)
    ],
    [
      isPermanentUnexpectedError,
      () => getPermanentUnexpectedResponse(url, id, error)
    ],
    [R.T, () => getGeneralLookupFailureResponse(url, id, error)]
  ])

  return getResponse(status)
}

/**
 * @typedef LookupApiAction
 * @property {string} url The endpoint on the client's API to make the lookup request to
 * @property {string} id Name of the data we are requesting (i.e 'customer_number')
 * @property {string} username Username used to auth lookup request
 * @property {string} password Password used to auth lookup request
 */

/**
 * @typedef LookupApiResponse
 * @param {boolean} lookupFailed indicates that the request either failed or the response was invalid
 * @param {boolean} lookupTransientError indicates that a transient error occurred when making the request
 * @param {string} body the json stringified response body returned from a successful request
 */

/**
 * Uses a given URL and credentials to request a value for a given identifier field
 *
 * @param {LookupApiAction} action  the incoming lookup api action
 * @param {object=} deps Dependencies
 * @param {object=} deps.requestParam request module
 * @returns {Promise<LookupApiResponse>} the response to return to the action-processor
 */
async function getLookupData (
  action,
  // istanbul ignore next
  { requestParam = request } = {}
) {
  throwErrorIfMissingFields(action)

  const { data, error } = await lookupDataOnApi(requestParam, action)

  return getLookupResponse(action, data, error)
}

module.exports = {
  getLookupData
}
