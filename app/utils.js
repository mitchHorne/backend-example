const R = require('ramda')

const defaultSanitizeKeys = ['twitterAccessTokens', 'apiKey']
const { logger } = require('@bluerobot/monitoring')
const db = require('./db')

/**
 * Determines if action is expired
 *
 * @param {object} action Action to evaluate
 * @param {object} options Configuration options
 * @param {number} options.now Override current date time as unix epoch milliseconds
 * @returns {boolean} Whether action is expired or not
 */
const isExpired = (
  action,
  // istanbul ignore next
  { now = Date.now() } = {}
) => {
  const { expiration } = action

  if (!expiration) return false

  const expired = expiration < now

  return expired
}

/**
 * Removes sensitive fields from an object
 *
 * @param {object} action Object to purge of its sensitive fields
 * @param {Array} keys Sensitive field names
 * @returns {object} Sanitized action
 */
const sanitizeAction = (action, keys = defaultSanitizeKeys) =>
  R.omit(keys, action)

/**
 * Checks if the provided error is a connection error
 *
 * @param {Error} error Error to be checked
 * @returns {boolean} Evaluation result
 */
const isConnectionError = (
  // istanbul ignore next
  { message } = {}
) =>
  R.anyPass([
    R.includes('ECONNREFUSED'),
    R.includes('socket hang up'),
    R.includes('ECONNRESET'),
    R.includes('ETIMEDOUT'),
    R.includes('EHOSTUNREACH')
  ])(message)

/**
 * Checks if the provided error is a media uploading error
 *
 * @param {Error} error Error to be checked
 * @returns {boolean} Evaluation result
 */
const isMediaUploadingError = R.pipe(R.propOr(0, 'statusCode'), R.equals(423))

// istanbul ignore next
const bufferFromPayload = R.pipe(JSON.stringify, Buffer.from)

/**
 * Calculate a delay based on the difference between the past in value and
 * the current time. Also adds a delay that is configurable via environment
 * variables.
 *
 * @param {number} limitResetAt Time reference point in seconds
 * @returns {number} The amount of time to wait in milliseconds
 */
function calculateDelay (limitResetAt) {
  const now = Math.round(Date.now() / 1000)
  const delay = Number(process.env.ACTION_RATE_LIMIT_DELAY) || 2

  if (!limitResetAt) return 0
  const difference = Number(limitResetAt) - now
  const calculatedDelay = (difference + delay) * 1000

  return calculatedDelay > 0 ? calculatedDelay : 0
}

/**
 * @typedef {object} DelayedAction
 * @property {object} action the action that should be delayed
 * @property {number} delay The amount of time to wait in milliseconds
 */

/**
 * Delays the passed in action based on a delay calculation.
 *
 * @param {object} params The parameters for delaying an action
 * @param {object} params.action Action that should be delayed
 * @param {number} params.limitResetAt Time at which limit will reset
 * @returns {DelayedAction} Action with calculated delay
 */
function delayAction ({ action, limitResetAt }) {
  return {
    action,
    delay: calculateDelay(limitResetAt)
  }
}

/**
 * @typedef RateLimitOptions
 * @property {string} action Action type
 * @property {object} headers Headers included with rate limit response
 * @property {string} method HTTP method
 * @property {string} endpoint endpoint called
 * @property {string} userId user ID
 */

/**
 * Adds a rate limit entry to the database
 *
 * @param {RateLimitOptions} options Confirugation options
 * @returns {Promise<DelayedAction>} Resolves when rate limit entry has been added to database
 */
async function setRateLimit (options) {
  const {
    action,
    headers,
    method,
    endpoint,
    userId,
    platform,
    defaultLimitResetAt
  } = options

  logger.warn(
    `${platform} rate limit exceeded for ${method} ${endpoint} endpoint, user id: ${userId}`
  )

  if (!headers) {
    logger.error(options, 'No rate limit headers attached')
    return Promise.reject(
      new Error(`No headers in the rate limited ${platform} response`)
    )
  }

  const limitResetAt = headers['x-rate-limit-reset'] || defaultLimitResetAt

  if (!limitResetAt) {
    logger.error(options, 'No x-rate-limit-reset field found in headers')
    return Promise.reject(
      new Error(
        `No x-rate-limit-reset field found in headers of the rate limited ${platform} response`
      )
    )
  }

  logger.warn(
    `${userId} has reached rate limit, x-rate-limit-reset: ${limitResetAt}`
  )
  // insert rate limit reset to database
  await db.upsertRateLimit({
    userId,
    platform,
    method,
    endpoint,
    limitResetAt
  })

  return delayAction({
    action,
    limitResetAt
  })
}

/**
 * Converts the given milliseconds to seconds
 *
 * @param {number} milliseconds milliseconds to convert
 * @returns {number} seconds
 */
const convertToSeconds = R.pipe(R.divide(R.__, 1000), Math.round)

/**
 * Adds the given millisecond delay to the current datetime
 *
 * @param {number} delay the delay in milliseconds
 * @returns {number} millisecond timestamp
 */
const addDelayToCurrentTime = delay => R.add(Date.now(), delay)

/**
 * Returns the timestamp (in seconds) for when the rate limit will reset
 *
 * @param {number} delay the number of milliseconds to delay by
 * @returns {number}
 */
const getRateLimitResetTimestamp = R.pipe(
  addDelayToCurrentTime,
  convertToSeconds
)

/**
 * @typedef {object} RateLimitHeaders
 * @property {number} x-rate-limit-reset rate limit header
 */

/**
 * Returns the headers to use when setting a rate limit
 *
 * @param {number} delay the number of milliseconds to delay  by
 * @returns {RateLimitHeaders} rate-limit headers object
 */
const getRateLimitHeaders = R.applySpec({
  'x-rate-limit-reset': getRateLimitResetTimestamp
})

/**
 * Checks if incoming value is an object or not. If it is a JSON object then it is returned as-is,
 * otherwise the value will be parsed as a JSON object and be returned
 */
const parseJson = R.ifElse(R.is(Object), R.identity, R.unapply(JSON.parse))

// Parses a value as JSON and returns it. Defaults to null if there is an error when trying to parse the JSON
const tryParseJson = R.tryCatch(parseJson, R.always(null))

const processInnerActions = (
  innerActions,
  widgetId,
  { buffer, channel, exchangeName, context }
) => {
  const replaceComments = R.replace(/\\\$/g, '$')
  const uncommentWhatsappMergeFields = R.over(
    R.lensPath(['message', 'text', 'body']),
    replaceComments
  )
  const uncommentMetaMergeFields = R.over(
    R.lensPath(['message', 'message', 'text']),
    replaceComments
  )

  const uncommentDefaultMergeFields = R.over(
    R.lensProp('text'),
    replaceComments
  )

  const uncommentMergeFields = R.cond([
    [R.propEq('type', 'SEND_INSTAGRAM_MESSAGE'), uncommentMetaMergeFields],
    [R.propEq('type', 'SEND_WHATSAPP_MESSAGE'), uncommentWhatsappMergeFields],
    [
      R.both(
        R.propEq('type', 'SEND_FACEBOOK_MESSAGE'),
        R.hasPath(['message', 'message', 'text'])
      ),
      uncommentMetaMergeFields
    ],
    [R.propEq('type', 'SEND_FACEBOOK_MESSAGE'), R.identity], // any type of rich media message
    [R.propEq('type', 'SEND_DARK_TWEET'), uncommentDefaultMergeFields],
    [R.T, uncommentDefaultMergeFields]
  ])

  const appendInstagramActivity = R.pipe(
    R.filter(action => R.equals('SEND_INSTAGRAM_MESSAGE', action.type)),
    R.pathOr(null, [0]),
    R.pathOr(null, ['message', 'recipient', 'id']),
    R.ifElse(
      R.complement(R.isNil),
      originalSenderId => ({
        messageEvent: {
          sender: {
            id: originalSenderId
          },
          recipient: {
            id: 'LOOKUP_API' // Action Builder requires this - we do not have access to original activity in the processor
          },
          type: 'text'
        }
      }),
      () => undefined
    )
  )

  const appendWhatsappMessage = R.pipe(
    R.filter(action => R.equals('SEND_WHATSAPP_MESSAGE', action.type)),
    R.ifElse(
      R.complement(R.isEmpty),
      () => ({}),
      () => undefined
    )
  )

  const appendFacebookMessage = R.pipe(
    R.filter(action => R.equals('SEND_FACEBOOK_MESSAGE', action.type)),
    R.ifElse(
      R.complement(R.isEmpty),
      () => ({}),
      () => undefined
    )
  )

  const appendFacebookActivity = R.pipe(
    R.filter(action => R.equals('SEND_FACEBOOK_MESSAGE', action.type)),
    R.ifElse(
      R.complement(R.isEmpty),
      () => ({ type: 'comment', changes: [{ value: { comment_id: '1234' } }] }),
      () => undefined
    )
  )

  const appendTwitterActivity = R.pipe(
    R.filter(action => R.equals('SEND_DARK_TWEET', action.type)),
    R.ifElse(
      R.complement(R.isEmpty),
      () => ({}),
      () => undefined
    )
  )

  const appendTwitterActivityType = R.pipe(
    R.filter(action => R.equals('SEND_DARK_TWEET', action.type)),
    R.ifElse(
      R.complement(R.isEmpty),
      () => 'favorite_event',
      () => undefined
    )
  )

  const actionBuilderPayload = R.pipe(
    R.applySpec({
      actions: R.map(uncommentMergeFields),
      context: () => context,
      instagramActivity: appendInstagramActivity,
      whatsappMessage: appendWhatsappMessage,
      facebookMessage: appendFacebookMessage,
      facebookActivity: appendFacebookActivity,
      twitterActivity: appendTwitterActivity,
      type: appendTwitterActivityType
    }),
    R.reject(R.isNil)
  )(innerActions)

  const routingKey = `actions.build.${widgetId}`
  logger.debug(
    { routingKey, actionBuilderPayload },
    'Publishing to action builder queue...'
  )
  channel.publish(exchangeName, routingKey, buffer(actionBuilderPayload))
}

const checkAndHandleSuccessActions = (
  action,
  { actionType, buffer, channel, exchangeName, result }
) => {
  if (action.success?.length >= 1) {
    const parseContext = resultBody => {
      try {
        return JSON.parse(resultBody)
      } catch (e) {
        logger.debug(
          { action, e },
          'Could not parse result body - setting context to empty'
        )

        return {}
      }
    }
    try {
      const context = parseContext(result.body)
      processInnerActions(action.success, action.widgetId, {
        actionType,
        buffer,
        channel,
        exchangeName,
        context
      })
    } catch (error) {
      logger.error(
        { error },
        `Failed to build and route action success due to building failure`
      )
      logger.debug({ action }, 'Failed action structure')
      logger.debug({ result }, 'Successful LOOKUP_API call body')
    }
  }
}

const checkAndHandleFailureActions = (
  action,
  { actionType, buffer, channel, exchangeName, result }
) => {
  if (action.failure?.length >= 1) {
    try {
      processInnerActions(action.failure, action.widgetId, {
        actionType,
        buffer,
        channel,
        exchangeName
      })
    } catch (error) {
      logger.error(
        `Failed to build and route action failure due to building failure`
      )
      logger.debug({ action }, 'Failed action structure')
      logger.debug({ result }, 'Successful LOOKUP_API call body')
    }
  }
}

const getFbDelayStatuses = () => [
  4, // app rate-limit
  17, // user rate-limit,
  32 // user OR page rate limit
]

module.exports = {
  isExpired,
  sanitizeAction,
  isConnectionError,
  isMediaUploadingError,
  bufferFromPayload,
  delayAction,
  setRateLimit,
  checkAndHandleFailureActions,
  checkAndHandleSuccessActions,
  getRateLimitHeaders,
  tryParseJson,
  getFbDelayStatuses
}
