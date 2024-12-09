const { always, and, cond, equals, path, pathOr } = require('ramda')
const utils = require('../utils')
const { logger } = require('@bluerobot/monitoring')

const facebookDelayStatuses = utils.getFbDelayStatuses()

/**
 * @typedef MetaErrorHandlerResponse
 * @property {boolean} isHandled - Whether or not the error was handled
 * @property {object} metaResponseBody - The response body from the Meta API
 * @property {number} metaResponseCode - The response code from the Meta API
 * @property {boolean=} deleteParticipant - Whether or not to delete the participant
 * @property {Error=} error - The error that was passed in
 */

/**
 * Handles the response from the Meta API for Facebook requests
 * https://developers.facebook.com/docs/messenger-platform/error-codes/
 *
 * @param {Error} error - The error thrown from the bluerobot/request module, probably
 * @param {object} action - An object containing info about the action type that was actioned
 * @returns {MetaErrorHandlerResponse} - An object with details about the error handling
 */
async function handleMetaApiResponse (error, action) {
  const metaResponse = getMetaResponseFromError(error)

  const isRateLimited = facebookDelayStatuses.includes(
    path(['response', 'body', 'error', 'code'], error)
  )
  if (isRateLimited) {
    const delayAction = await handleRateLimitedError(action)
    return {
      ...metaResponse,
      ...delayAction
    }
  }

  const isFacebookDuplicateOptInError = and(
    equals(613, path(['response', 'body', 'error', 'code'], error)),
    equals(1893016, path(['response', 'body', 'error', 'error_subcode'], error))
  )
  if (isFacebookDuplicateOptInError) {
    await handleDuplicateOptInError(metaResponse, action)
    return {
      ...metaResponse,
      isHandled: true
    }
  }

  const isFacebookStoppedNotificationError = and(
    equals(10, path(['response', 'body', 'error', 'code'], error)),
    equals(1893015, path(['response', 'body', 'error', 'error_subcode'], error))
  )
  if (isFacebookStoppedNotificationError) {
    handleStoppedNotificationError(metaResponse, action)
    return {
      ...metaResponse,
      isHandled: true,
      deleteParticipant: true
    }
  }

  const userIsNotAvailable = equals(
    551,
    path(['response', 'body', 'error', 'code'], error)
  )
  if (userIsNotAvailable) {
    handleUserIsNotAvailable(metaResponse, action)

    return {
      ...metaResponse,
      isHandled: true
    }
  }

  const unexpectedInternalError = equals(
    -1,
    path(['response', 'body', 'error', 'code'], error)
  )
  if (unexpectedInternalError) {
    handleUnexpectedInternalError(metaResponse, action)

    return {
      ...metaResponse,
      isHandled: true
    }
  }

  return {
    error,
    ...metaResponse,
    isHandled: false
  }
}

/**
 * Handles rate limited actions by setting a delay on the action
 *
 * @param {object} action - The action that was rate limited
 * @returns {Promise<import('../utils').DelayedAction>} Promise of the delayed action object
 */
async function handleRateLimitedError (action) {
  const DEFAULT_FACEBOOK_DELAY = 60 * 60 * 1000 // 1 hour in milliseconds
  const actionType = path(['type'], action)
  const endpoint = cond([
    [equals('SEND_FACEBOOK_COMMENT'), always('comments')],
    [equals('SEND_FACEBOOK_MESSAGE'), always('messages')]
  ])(actionType)

  return await utils.setRateLimit({
    action,
    platform: 'FACEBOOK',
    headers: {
      'x-rate-limit-reset': Math.round(
        (Date.now() + DEFAULT_FACEBOOK_DELAY) / 1000
      )
    },
    method: 'POST',
    endpoint: `${endpoint}`,
    userId: action.userId
  })
}

/**
 * Handles duplicate opt-in errors from Facebook
 *
 * @param {object} metaResponse - The response from Facebook API
 * @param {object} action - The action that was attempted
 * @param {string} action.widgetId - The widget ID of the action
 * @param {string} action.participantId - The participant ID of our DB entry in facebook_participants
 * @returns {Promise} - A promise that resolves when the error has been handled
 */
function handleDuplicateOptInError (metaResponse, action) {
  const widgetId = pathOr('', ['widgetId'], action)
  const participantId = pathOr('', ['participantId'], action)
  logger.info(
    { metaResponse, widgetId, participantId },
    `Duplicate Notification opt-in request error received from Facebook. Acknowledged.`
  )
  return Promise.resolve()
}

/**
 * Handles stopped notification errors from Facebook
 *
 * @param {object} metaResponse - The response from Facebook API
 * @param {object} action - The action that was attempted
 * @param {string} action.widgetId - The widget ID of the action
 * @param {string} action.participantId - The participant ID of our DB entry in facebook_participants
 */
function handleStoppedNotificationError (metaResponse, action) {
  const widgetId = pathOr('', ['widgetId'], action)
  const participantId = pathOr('', ['participantId'], action)
  logger.info(
    { metaResponse, widgetId, participantId },
    `Stopped Notification request error received from Facebook. Acknowledged.`
  )
}

/**
 * Handles user is not available errors from Facebook
 *
 * @param {object} metaResponse - The response from Facebook API
 * @param {object} action - The action that was attempted
 * @param {string} action.widgetId - The widget ID of the action
 * @param {string} action.participantId - The participant ID of our DB entry in facebook_participants
 */
function handleUserIsNotAvailable (metaResponse, action) {
  const widgetId = pathOr('', ['widgetId'], action)
  const participantId = pathOr('', ['participantId'], action)
  logger.warn(
    { metaResponse, widgetId, participantId },
    `User is not available. Acknowledged.`
  )
}

/**
 * Handles unexpected internal errors from Facebook
 *
 * @param {object} metaResponse - The response from Facebook API
 * @param {object} action - The action that was attempted
 * @param {string} action.widgetId - The widget ID of the action
 * @param {string} action.participantId - The participant ID of our DB entry in facebook_participants
 */
function handleUnexpectedInternalError (metaResponse, action) {
  const widgetId = pathOr('', ['widgetId'], action)
  const participantId = pathOr('', ['participantId'], action)
  logger.warn(
    { metaResponse, widgetId, participantId },
    `Facebook threw an unexpected internal error. Acknowledged`
  )
}

/**
 * @param {object} error - The error thrown from the bluerobot/request module, probably
 * @returns {object} - An object containing the Meta response body and code from the error
 */
function getMetaResponseFromError (error) {
  return {
    metaResponseBody: pathOr({}, ['response', 'body'], error),
    metaResponseCode: pathOr(0, ['statusCode'], error)
  }
}

module.exports = {
  handleMetaApiResponse
}
