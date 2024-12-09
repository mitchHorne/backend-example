const R = require('ramda')
const { logger, metrics } = require('@bluerobot/monitoring')
const utils = require('../utils')

const isFirstErrorCode = code => error => {
  const isNotEmpty = R.complement(R.isEmpty)
  const isArrayWithElements = R.both(R.is(Array), isNotEmpty)
  const getFirstElement = R.head
  const isSpecifiedErrorCode = R.both(R.has('code'), R.propEq('code', code))

  const getTwitterErrorsFromResponse = R.pathOr(
    [],
    ['response', 'body', 'errors']
  )
  const twitterErrors = getTwitterErrorsFromResponse(error)

  return R.both(
    isArrayWithElements,
    R.pipe(getFirstElement, isSpecifiedErrorCode)
  )(twitterErrors)
}

const invalidTokenError = 'Invalid or expired token.'
const facebookRateLimitExceededError =
  'Calls to this api have exceeded the rate limit'

const isUserDeletedConversation = errMessage =>
  errMessage.includes(
    '(#100) The thread owner has archived or deleted this conversation, or the thread does not exist.'
  )

const isFirstDuplicateError = isFirstErrorCode(187)
const isFirstOverCapacityError = isFirstErrorCode(130)
const isFirstInternalError = isFirstErrorCode(131)
const isFirst349Error = isFirstErrorCode(349)
const isDbError = R.allPass([
  R.has('sqlMessage'),
  R.pipe(
    R.propOr('', 'code'),
    R.anyPass([
      R.includes('ECONNREFUSED'),
      R.includes('ETIMEDOUT'),
      R.includes('EPIPE'),
      R.includes('PROTOCOL_CONNECTION_LOST')
    ])
  )
])

const shouldRequeue = R.pipe(
  R.prop('error'),
  R.anyPass([isFirstOverCapacityError, isFirstInternalError, isDbError])
)

// twitter errors are given as an array
const isTwitterError = Array.isArray

/*
  Error codes may be found here
  https://developer.twitter.com/ja/docs/basics/response-codes
  https://developer.twitter.com/en/support/twitter-api/error-troubleshooting
*/
const isTwitter130Error = code => code === 130
const isTwitter131Error = code => code === 131
const isTwitter187Error = code => code === 187

const getTwitterErrorMessageOrDefault = (errorCode, errorMessage) => {
  return R.cond([
    [
      isTwitter130Error,
      () => `Twitter error 130: ${errorMessage}. BR says: Over capacity`
    ],
    [
      isTwitter131Error,
      () =>
        `Twitter error 131: ${errorMessage}. BR says: Twitter Internal error`
    ],
    [
      isTwitter187Error,
      () => `Twitter error 187: ${errorMessage}. BR says: Duplicate tweet`
    ],
    [R.T, () => `Twitter error ${errorCode}: ${errorMessage}`]
  ])(errorCode, errorMessage)
}

const getErrorMessage = error => {
  const handleTwitterError = error => {
    const [{ code, message }] = error
    if (code && message) {
      return getTwitterErrorMessageOrDefault(code, message)
    }
    if (code && !message) {
      return `Unknown error with code ${code}`
    }
    return message
      ? `Twitter error: ${message}`
      : 'Twitter error: Unknown error'
  }

  const handleErrorDefault = error => error.message || 'Unknown error'

  return R.cond([
    [isTwitterError, handleTwitterError],
    [R.T, handleErrorDefault]
  ])(error)
}

const requeue = ({
  action,
  type,
  error,
  channel,
  message,
  exchangeName,
  buffer
}) => {
  const { priority } = message.properties
  const { userId } = action
  const routingKey = `actions.throttle.${type}.${userId}`
  const errorMessage = getErrorMessage(error)

  logger.warn(
    {
      action: utils.sanitizeAction(action),
      err: error
    },
    `Error processing ${type} action: '${errorMessage}'. Requeuing...`
  )

  channel.publish(exchangeName, routingKey, buffer(action), { priority })

  metrics.increment('actions.process.requeued')
}

const discard = ({ action, type, error }) => {
  const logData = {
    action: utils.sanitizeAction(action),
    err: error,
    errorDetails: {
      jsonString: JSON.stringify(error ?? ''),
      message: JSON.stringify(error?.message ?? ''),
      stack: JSON.stringify(error?.stack ?? '')
    }
  }

  const errorMessage = R.pipe(
    getErrorMessage,
    R.ifElse(R.is(Object), errMsg => JSON.stringify(errMsg), R.identity)
  )(error)

  const logMsg = `Error processing ${type} action: '${errorMessage}'. Discarding...`
  const log = logger.child(logData)

  metrics.increment('actions.process.discarded')

  if (action?.ignoreErrors) {
    log.info(logMsg)
    return
  }

  if (errorMessage === invalidTokenError) {
    /*
     * Set the logging level to 'warn' if the error Code 401 (Invalid or expired token) is returned
     */
    log.warn({ alertLevel: 'support-tier-1' }, logMsg)
    return
  }

  if (R.anyPass([isFirstDuplicateError, isFirst349Error])(error)) {
    /*
     * Set the logging level to 'info' if the error Code 187 (Duplicate Tweet) or Code 349 (You cannot send messages to this user) is returned
     */
    log.info(logMsg)
    return
  }

  if (errorMessage.includes(facebookRateLimitExceededError)) {
    /*
     * Set the logging level to 'warn' if the error is that a rate limit is reached
     */
    log.warn(logMsg)
    return
  }

  // Log user archiving conversation as an info
  if (isUserDeletedConversation(errorMessage)) {
    logger.info(
      { error: errorMessage },
      `User has archived/deleted the conversation. Discarding...`
    )
    return
  }

  // All other errors
  log.error(logMsg)
}

const requeueIfValid = R.ifElse(shouldRequeue, requeue, discard)

module.exports = {
  requeueIfValid
}
