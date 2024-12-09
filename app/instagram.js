const R = require('ramda')
const { logger, metrics } = require('@bluerobot/monitoring')

const cache = require('./cache')
const utils = require('./utils')

// |=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|
// |                                           ~* Type Definitions *~                                        |
// |=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|

/**
 * @typedef {object} InstagramMessagingRecipient
 * @property {string} id the IGSID of the user to send the Instagram message to
 */

/**
 * @typedef {object} InstagramTextMessage
 * @property {string} text the text of the message to send to a user
 */

/**
 * @typedef {object} InstagramTextMessagePayload
 * @property {InstagramMessagingRecipient} recipient the user receiving who will receive the message
 * @property {InstagramTextMessage} message the text message to send
 */

/**
 * @typedef {object} InstagramQuickReplyOption
 * @property {string} content_type the type of content in the quick reply. Must equal 'text'
 * @property {string} title the title of the quick reply option
 * @property {any} payload the payload that will be sent to us if the user clicks this option
 */

/**
 * @typedef {object} InstagramQuickReplyMessage
 * @property {string} text the text that it sent along with showing the reply options
 * @property {Array<InstagramQuickReplyOption>} quick_replies array of quick reply options a user can select
 */

/**
 * @typedef {object} InstagramQuickReplyMessagePayload
 * @property {InstagramMessagingRecipient} recipient the user receiving who will receive the message
 * @property {string} messaging_type the type of message. Must equal 'RESPONSE'
 * @property {InstagramQuickReplyMessage} message the text message to send
 */

/**
 * @typedef {object} SendInstagramMessageAction
 * @property {string} type the action type
 * @property {string} accessToken encrypted Instagram page access token
 * @property {InstagramMessagingPayload} message the message payload to send to Instagram
 * @property {string} userId the ID of the widget owner. Retrieved from the AMQP routing key
 */

// Groups the Instagram Messaging Payload types under a single type for functions which take/return
// an InstagramTextMessagePayload or InstagramQuickReplyMessagePayload
/**
 * @typedef {InstagramTextMessagePayload | InstagramQuickReplyMessagePayload} InstagramMessagingPayload
 */

// Groups the different types of payloads for Instagram under a single type for functions which have parameters
// for Instagram payloads for messaging, as well as future Instagram payloads for competitions and so on. This
// allows the code to be written in a way which is extensible

/**
 * @typedef {InstagramMessagingPayload | object} InstagramPayload
 */

// Groups the different types of actions for Instagram under a single type for functions which have parameters
// for Instagram actions for messaging, as well as future Instagram payloads for competitions and so on. This
// allows the code to be written in a way which is extensible

/**
 * @typedef {SendInstagramMessageAction | object} InstagramAction
 */

// |=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|
// |                                         ~* Variable Definitions *~                                      |
// |=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|

// The maximum number of retries for sending an Instagram Message
const INSTAGRAM_MESSAGING_RETRY_LIMIT =
  process.env.INSTAGRAM_MESSAGING_RETRY_LIMIT || 10

// The delay (in milliseconds) to apply when a user is rate-limited by Instagram's Messaging
const INSTAGRAM_MESSAGING_DELAY = process.env.INSTAGRAM_MESSAGING_DELAY || 5000

// Platform name for Instagram. Used for rate checking/setting rate limits
const PLATFORM_NAME = 'INSTAGRAM'

// The base of the the URL for Facebook's Graph API
const FACEBOOK_BASE_API_URL =
  process.env.FACEBOOK_BASE_API_URL || 'https://graph.facebook.com/'

// TODO: Once we are able to test the workflow, we can test if we are still able to send
// Quick Reply messages on the newer versions of Facebook's Graph API, contrary to their
// documentation

// Some Graph API features require using older versions of the Graph API while others
// make use of the newer version.
//
// For example, when it comes to messaging, most normal messages (text, images, etc.) are sent
// using v11.0 of Facebook's Graph API, while Quick Reply messages are sent using v8.0 of the API
//
// https://developers.facebook.com/docs/messenger-platform/instagram/features/send-message
// https://developers.facebook.com/docs/messenger-platform/instagram/features/quick-replies
const OLD_FACEBOOK_API_VERSION = 'v8.0'
const FACEBOOK_API_VERSION = process.env.FACEBOOK_API_VERSION

const OLD_FACEBOOK_API_URL = R.concat(
  FACEBOOK_BASE_API_URL,
  OLD_FACEBOOK_API_VERSION
)
const FACEBOOK_API_URL = R.concat(FACEBOOK_BASE_API_URL, FACEBOOK_API_VERSION)

// The endpoint to use on Facebook's Graph API for sending messages
const MESSAGING_ENDPOINT = '/me/messages'

// The HTTP method to use for sending messages to Facebook's Graph API
const MESSAGING_HTTP_METHOD = 'POST'

// The status code which Facebook's Graph API returns when we have hit the messaging rate limit
const MESSAGING_RATE_LIMIT_STATUS_CODE = 613

// The value of a message's `messaging_type` property for Quick Reply messages being sent out
const QUICK_REPLY_MESSAGING_TYPE = 'RESPONSE'

// Required fields for all SEND_INSTAGRAM_MESSAGE actions
const SEND_INSTAGRAM_MESSAGE_REQUIRED_FIELDS = ['userId', 'message']
const SEND_INSTAGRAM_COMMENT_REPLY_REQUIRED_FIELDS = ['userId', 'message']

// |=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|
// |                                          ~* Helper Functions *~                                         |
// |=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|

/**
 * Returns the number of retries remaining for an Instagram Messaging action.
 *
 * Defaults to the maximum number of retries if action does not specify retries remaining
 *
 * @param {SendInstagramMessageAction} action Instagram Messaging action
 * @returns {number}
 */
const getRemainingMsgRetries = R.propOr(
  INSTAGRAM_MESSAGING_RETRY_LIMIT,
  'retryRemaining'
)

/**
 * Checks if the given response object indicates that the user has been rate limited by Instagram's messaging
 *
 * @param {object} response the response object returned by callEndpoint()
 * @returns {boolean}
 */
const hasBeenRateLimitedForMessaging = R.pipe(
  R.propOr(null, 'body'),
  utils.tryParseJson,
  R.pathEq(['error', 'code'], MESSAGING_RATE_LIMIT_STATUS_CODE)
)

R.pathEq(['body', 'error', 'code'], MESSAGING_RATE_LIMIT_STATUS_CODE)

/**
 * Checks whether or not the given response object indicates that Instagram is rate limiting the user it
 * returned for
 *
 * @param {object} response the response object returned by callEndpoint()
 * @returns {boolean}
 */
const hasBeenRateLimited = R.anyPass([hasBeenRateLimitedForMessaging])

/**
 * Indicates whether or not the given Instagram request payload is a Quick Reply message
 *
 * @param {InstagramPayload} payload the payload to send to Instagram
 * @returns {boolean}
 */
const isQuickReplyMessage = R.propEq(
  'messaging_type',
  QUICK_REPLY_MESSAGING_TYPE
)

/**
 * Indicates whether or not the old API version should be used to sent a given payload
 *
 * @param {InstagramPayload} payload the payload to send to Instagram
 * @returns {boolean}
 */
const shouldUseOldApiVersion = R.anyPass([isQuickReplyMessage])

/**
 * Returns the Facebook Graph API URL to use for Instagram requests based on whether it
 * should use the new or old version of the API
 *
 * @param {InstagramPayload} payload the payload to send to Instagram
 * @returns {string}
 */
const getFacebookApiUrl = R.ifElse(
  shouldUseOldApiVersion,
  R.always(OLD_FACEBOOK_API_URL),
  R.always(FACEBOOK_API_URL)
)

/**
 * Returns the URL to use for sending the given Instagram Message to Instagram
 *
 * @param {InstagramMessagingPayload} instagramMessage the message payload to send to Instagram
 * @returns {string}
 */
const getMessagingUrl = R.pipe(
  getFacebookApiUrl,
  R.concat(R.__, MESSAGING_ENDPOINT)
)

/**
 * Returns the DB options object to use for checking if a user is rate limited
 * by Instagram for a given endpoint and HTTP method
 *
 * @param {string} userId the id of the user who owns the experience
 * @param {string} method the HTTP method of the endpoint being rate-limited for the user
 * @param {string} endpoint the endpoint being rate-limited for the user
 * @returns {object} db options object
 */
const getUserRateLimitDbOptions = (userId, method, endpoint) => ({
  userId,
  platform: PLATFORM_NAME,
  method,
  endpoint
})

/**
 * Returns the request options to use with callEndpoint to send the
 * given message to Instagram
 *
 * For more information on the different structures of Instagram messages see:
 * https://developers.facebook.com/docs/messenger-platform/instagram/features/send-message
 *
 * @param {SendInstagramMessageAction} action Instagram Messaging action
 * @param {object} crypt bluerobot crypt-keeper
 * @param {string} pageAccessToken Page access token tied to the user and not action
 * @returns {object} the request options to use in the request to Instagram
 */
function getMessagingRequestOptions (action, crypt, pageAccessToken) {
  const { message } = action

  const decryptedAccessToken = action.accessToken
    ? crypt.decrypt(action.accessToken)
    : pageAccessToken
  const url = getMessagingUrl(message)

  return {
    url,
    method: MESSAGING_HTTP_METHOD,
    query: {
      access_token: decryptedAccessToken
    },
    body: message,
    timeout: Number(process.env.META_API_TIMEOUT) || 20000,
    retriesRemaining: getRemainingMsgRetries(action),
    responseType: 'json'
  }
}

/**
 * Returns the request options to use with callEndpoint to send the given reply to Instagram
 *
 * For more information on the different structures of Instagram messages see:
 * https://developers.facebook.com/docs/messenger-platform/instagram/features/send-message
 *
 * @param {SendInstagramMessageAction} action Instagram comment reply action
 * @param {string} pageAccessToken Page access token tied to the user and not action
 * @returns {object} the request options to use in the request to Instagram
 */
function getCommentReplyRequestOptions (action, pageAccessToken) {
  const {
    message: {
      recipient: { comment_id: commentId },
      message: { text: message }
    }
  } = action
  const graphAPIUrl = process.env.FACEBOOK_API_URL
  const url = `${graphAPIUrl}/${commentId}/replies`

  return {
    url,
    method: MESSAGING_HTTP_METHOD,
    query: {
      access_token: pageAccessToken
    },
    body: { message },
    retriesRemaining: getRemainingMsgRetries(action)
  }
}

/**
 * Returns an epoch timestamp which represents the datetime when the given user
 * will no longer be getting rate limited on the given endpoint. Will return 0
 * if the user is not currently rate-limited
 *
 * @param {object} db db module
 * @param {string} userId the id of the user who owns the experience
 * @param {string} method the HTTP method of the endpoint being rate-limited for the user
 * @param {string} endpoint the endpoint being rate-limited for the user
 * @returns {number} epoch timestamp for when the user will no longer be rate limited
 */
async function getRateLimitResetTimestamp (db, userId, method, endpoint) {
  const dbOptions = getUserRateLimitDbOptions(userId, method, endpoint)

  const resetTimestamp = await db.getUserRateLimit(dbOptions)

  return resetTimestamp
}

/**
 * Returns an epoch timestamp which represents the datetime when the given user
 * will no longer be getting rate limited for Instagram Messaging. Will return 0
 * if the user is not currently rate-limited
 *
 * @param {string} userId the id of the user who owns the experience
 * @param {object} db db module
 * @returns {number} epoch timestamp for when the user will no longer be rate limited
 */
async function getMessagingRateLimitResetTimestamp (userId, db) {
  const resetTimestamp = await getRateLimitResetTimestamp(
    db,
    userId,
    MESSAGING_HTTP_METHOD,
    MESSAGING_ENDPOINT
  )

  return resetTimestamp
}

/**
 * Indicates whether or not a user is rate limited by checking if the given rate limit reset
 * epoch timestamp greater than 0. Any timestamp greater than 0 indicates that the user is
 * currently being rate-limited
 *
 * @param {number} rateLimitResetTimestamp timestamp representing when the rate limit will be reset
 * @returns {boolean}
 */
const isCurrentlyRateLimited = R.gt(R.__, 0)

/**
 * Returns a response to return to action-processor to delay the action until the rate limit resets
 *
 * @param {InstagramAction} action the action to delay
 * @param {number} rateLimitResetTimestamp timestamp representing when the rate limit will reset
 * @returns {utils.DelayedAction} action with delay attached
 */
const getDelayedAction = (action, rateLimitResetTimestamp) =>
  utils.delayAction({
    action,
    limitResetAt: rateLimitResetTimestamp
  })

/**
 * Adds a record to the DB that indicates that the given user has been rate-limited by Instagram on the
 * given endpoint for a duration of time indicates by the given delay.
 *
 * Returns promise that resolves with the given action with a delay attached
 *
 * @param {InstagramAction} action the Instagram action which triggered the rate limit
 * @param {number} delay the number of milliseconds to delay by
 * @param {string} method the HTTP method used in the rate-limited request
 * @param {string} endpoint the endpoint used for the rate-limited request
 * @param {string} userId the id of the user that has been rate-limited
 * @returns {Promise<utils.DelayedAction>} promise that resolves with the given action with delay attached
 */
const setInstagramRateLimit = (action, delay, method, endpoint, userId) =>
  utils.setRateLimit({
    action,
    platform: PLATFORM_NAME,
    headers: utils.getRateLimitHeaders(delay),
    method,
    endpoint,
    userId
  })

/**
 * Adds a record to the DB that indicates that the given user has been rate-limited by Instagram Messaging
 *
 * Returns promise that resolves with the given action with a delay attached
 *
 * @param {SendInstagramMessageAction} action the Instagram Messaging action which trigger the rate limit
 * @param {string} userId the id of the user that has been rate-limited
 * @returns {Promise<utils.DelayedAction>} promise that resolves with the given action with delay attached
 */
const setInstagramMessagingRateLimit = (action, userId) =>
  setInstagramRateLimit(
    action,
    INSTAGRAM_MESSAGING_DELAY,
    MESSAGING_HTTP_METHOD,
    MESSAGING_ENDPOINT,
    userId
  )

/**
 * Indicates whether or not the given field is missing from the given object
 *
 * @param {object} testObject the object to test
 * @param {string} fieldName the name of the field
 * @returns {boolean}
 */
const isMissingField = R.complement(R.flip(R.has))

/**
 * Throws an error for an action which is missing a required field
 *
 * @param {string} fieldName the name of the missing field
 */
const throwActionMissingFieldError = fieldName => {
  throw new Error(`Action is missing required field: '${fieldName}`)
}

/**
 * Throws an error if the given action does not have a field which corresponds with the given fieldName
 *
 * @param {InstagramAction} action the action to test for missing fields
 * @param {string} fieldName the fieldName to check for
 */
const throwErrorIfFieldIsMissing = (action, fieldName) => {
  if (isMissingField(action, fieldName)) throwActionMissingFieldError(fieldName)
}

/**
 * Throws an error if the given action is missing one of the given required fields
 *
 * @param {InstagramAction} action instagram action
 * @param {Array<string>} requiredFields required fields
 * @returns {void}
 */
const throwErrorIfActionIsInvalid = (action, requiredFields) =>
  R.forEach(R.curry(throwErrorIfFieldIsMissing)(action), requiredFields)

// |=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|
// |                                            ~* Main Functions *~                                         |
// |=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|=|

/**
 * Sends a given message to Instagram via Facebooks Graph API
 *
 * @param {SendInstagramMessageAction} action the incoming SEND_INSTAGRAM_MESSAGE action
 * @param {object=} deps Dependencies
 * @param {object=} deps.endpoints endpoints module
 * @param {object=} deps.crypt crypt-keeper module
 * @param {object=} deps.db db module
 * @returns {Promise<object>} promise that resolves with the response
 */
async function sendInstagramMessage (
  action,
  // istanbul ignore next
  {
    endpoints = require('./endpoints'),
    crypt = require('@bluerobot/crypt-keeper'),
    db = require('./db')
  } = {}
) {
  logger.debug(action, 'Received SEND_INSTAGRAM_MESSAGE action')

  throwErrorIfActionIsInvalid(action, SEND_INSTAGRAM_MESSAGE_REQUIRED_FIELDS)

  const { userId, message } = action

  // If the user is currently flagged as being rate-limited in our DB, delay the action
  // until the datetime we expect the user to no longer be rate-limited
  const rateLimitResetTimestamp = await getMessagingRateLimitResetTimestamp(
    userId,
    db
  )

  if (isCurrentlyRateLimited(rateLimitResetTimestamp)) {
    logger.debug(
      { userId, message },
      'User is currently being rate-limited for Instagram Messaging. Delaying action.'
    )
    metrics.increment(
      'actions.process.send_instagram_message.currently_rate_limited'
    )

    return getDelayedAction(action, rateLimitResetTimestamp)
  }

  let pageAccessToken
  if (!action.accessToken) {
    pageAccessToken = await R.pipe(
      db.getMetaPageAccessToken,
      R.andThen(
        R.pipe(R.head, R.head, R.propOr('', 'page_access_token'), crypt.decrypt)
      )
    )(action.userId)
  }

  // Build messaging request and send it to Instagram
  const requestOptions = getMessagingRequestOptions(
    action,
    crypt,
    pageAccessToken
  )

  logger.debug({ userId, message }, 'Sending message to Instagram')

  const response = await endpoints.callEndpoint(requestOptions)

  const { widgetId = '' } = action
  const { body: resBody } = response
  logger.debug({ response }, 'Instagram message success response')

  if (resBody && !resBody.error) {
    const responseBody = JSON.parse(resBody)
    await db.cacheMetaMessageResponse(
      responseBody.message_id,
      responseBody.recipient_id,
      widgetId,
      'instagram'
    )
  }

  const sanitizedRequestOptions = {
    ...requestOptions,
    query: {
      ...requestOptions.query,
      access_token: '***'
    }
  }

  cache.cacheMetaRequest(
    'instagram',
    widgetId,
    sanitizedRequestOptions,
    response.status,
    response.body
  )

  // If the response indicates that the user has been rate limited, flag the user as such and return
  // the action with a delay attached
  if (hasBeenRateLimited(response)) {
    logger.warn(
      { userId, message },
      'User has been rate-limited for Instagram Messaging. Delaying action.'
    )
    metrics.increment(
      'actions.process.send_instagram_message.newly_rate_limited'
    )

    return setInstagramMessagingRateLimit(action, userId)
  }

  logger.debug({ userId, message }, 'Message sent to Instagram successfully')
  metrics.increment('actions.process.send_instagram_message.success')

  return response
}

/**
 * Sends a comment reply to Instagram via Facebooks Graph API
 *
 * @param {SendInstagramMessageAction} action the incoming SEND_INSTAGRAM_COMMENT_REPLY action
 * @param {object=} deps Dependencies
 * @param {object=} deps.endpoints endpoints module
 * @param {object=} deps.crypt crypt-keeper module
 * @param {object=} deps.db db module
 * @returns {Promise<object>} promise that resolves with the response
 */
async function sendInstagramCommentReply (
  action,
  // istanbul ignore next
  {
    endpoints = require('./endpoints'),
    crypt = require('@bluerobot/crypt-keeper'),
    db = require('./db')
  } = {}
) {
  logger.info(action, 'Received SEND_INSTAGRAM_COMMENT_REPLY action')

  throwErrorIfActionIsInvalid(
    action,
    SEND_INSTAGRAM_COMMENT_REPLY_REQUIRED_FIELDS
  )

  const { userId, message, commentId, widgetId } = action

  // If the user is currently flagged as being rate-limited in our DB, delay the action
  // until the datetime we expect the user to no longer be rate-limited
  const rateLimitResetTimestamp = await getMessagingRateLimitResetTimestamp(
    userId,
    db
  )

  if (isCurrentlyRateLimited(rateLimitResetTimestamp)) {
    logger.debug(
      { userId, message },
      'User is currently being rate-limited for Instagram Messaging. Delaying action.'
    )
    metrics.increment(
      'actions.process.send_instagram_comment_reply.currently_rate_limited'
    )

    return getDelayedAction(action, rateLimitResetTimestamp)
  }

  const pageAccessToken = await R.pipe(
    db.getMetaPageAccessToken,
    R.andThen(
      R.pipe(R.head, R.head, R.propOr('', 'page_access_token'), crypt.decrypt)
    )
  )(action.userId)

  // Build messaging request and send it to Instagram
  const requestOptions = getCommentReplyRequestOptions(action, pageAccessToken)

  logger.info({ userId, message }, 'Replying to Instagram comment')

  const response = await endpoints.callEndpoint(requestOptions)
  logger.debug({ response }, 'Instagram comment reply success response')

  if (hasBeenRateLimited(response)) {
    logger.warn(
      { userId, message },
      'User has been rate-limited for Instagram Messaging. Delaying action.'
    )
    metrics.increment(
      'actions.process.send_instagram_message.newly_rate_limited'
    )

    return setInstagramMessagingRateLimit(action, userId, db)
  }

  const { body: resBody } = response
  logger.debug({ response }, 'Instagram message success response')

  if (resBody && !resBody.error) {
    const responseBody = JSON.parse(resBody)
    await db.cacheMetaCommentResponse(
      responseBody.message_id,
      responseBody.recipient_id,
      commentId,
      widgetId,
      'instagram'
    )
  }

  logger.info({ userId, message }, 'Comment reply to Instagram successfully')
  metrics.increment('actions.process.send_instagram_comment_reply.success')

  return response
}

module.exports = {
  sendInstagramCommentReply,
  sendInstagramMessage,
  MESSAGING_RATE_LIMIT_STATUS_CODE,
  MESSAGING_ENDPOINT
}
