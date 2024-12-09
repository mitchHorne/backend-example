const R = require('ramda')
const { logger, metrics } = require('@bluerobot/monitoring')
const exchangeName = process.env.AMQP_EXCHANGE || 'bluerobot'
const defaultRetries = Number(process.env.DEFAULT_RETRIES) || 100
const { from } = require('rxjs')
const { map, concatMap, toArray } = require('rxjs/operators')
const delay = require('delay')
const db = require('./db')
const email = require('./email')
const endpoints = require('./endpoints')
const twitter = require('./twitter')
const utils = require('./utils')
const lookup = require('./lookup')
const instagram = require('./instagram')
const facebook = require('./facebook')
const TwitterV2 = require('@bluerobot/twitter')

const dashbotUrl = 'https://tracker.dashbot.io/track'
const chatbaseUrl = 'https://chatbase.com/api/message'
const DEFAULT_WHATSAPP_DELAY =
  Number(process.env.DEFAULT_WHATSAPP_DELAY) || 3000 // 3 Seconds

const whatsAppDelayStatuses = [
  429, // request rate-limit
  503 // request rate-limit
]

/**
 * @typedef SendTweetAction
 * @property {string} widgetId Widget ID
 * @property {string} token Twitter access token
 * @property {string} secret Twitter access secret
 * @property {string} text Tweet body
 * @property {string[]} media Media IDs
 * @property {string} userId Twitter user ID
 * @property {string} statusId Tweet status ID to reply to
 * @property {string} attachmentUrl Attachment URL
 * @property {string} cardUri Card URI
 */

/**
 * Call Twitter to send a Tweet.
 *
 * @param {SendTweetAction} action Send Tweet action
 * @returns {Promise} Resolves when Tweet send completes
 */
function sendTweet (action) {
  const dbOptions = {
    userId: action.userId,
    platform: 'TWITTER',
    method: 'POST',
    endpoint: 'statuses/update'
  }
  return db.getUserRateLimit(dbOptions).then(result => {
    if (result > 0) {
      return utils.delayAction({
        action,
        limitResetAt: result
      })
    }

    const { type, twitterAccessTokens, ...tweet } = action

    const options = {
      token: twitterAccessTokens.token,
      secret: twitterAccessTokens.secret,
      ...tweet
    }

    return twitter.sendTweet(options)
  })
}

/**
 * @typedef SendDmAction
 * @property {string} widgetId Widget ID
 * @property {string} token Twitter access token
 * @property {string} secret Twitter access secret
 * @property {string} text Tweet body
 * @property {string[]} media Media IDs
 * @property {string} recipientId Direct message recipient ID
 * @property {object[]} quickReply Quick reply options
 * @property {object[]} ctas Call to action buttons
 * @property {string} userId Twitter user ID
 * @property {string} customProfileId Direct message custom profile ID
 */

/**
 * Call Twitter to send a direct message
 *
 * @param {SendDmAction} action Send DM action
 * @returns {Promise} Resolves when DM send completes
 */
function sendDm (action) {
  const dbOptions = {
    userId: action.userId,
    platform: 'TWITTER',
    method: 'POST',
    endpoint: 'direct_messages/events/new'
  }
  return db.getUserRateLimit(dbOptions).then(result => {
    if (result > 0) {
      return utils.delayAction({
        action,
        limitResetAt: result
      })
    }

    const { type, twitterAccessTokens, ...tweet } = action

    const options = {
      token: twitterAccessTokens.token,
      secret: twitterAccessTokens.secret,
      ...tweet
    }

    return twitter.sendDm(options)
  })
}

/**
 * Call Twitter to send reply.
 *
 * @param {SendTweetAction} action Send Tweet action
 * @returns {Promise} Resolves when Tweet send completes
 */
function sendReply (action) {
  const dbOptions = {
    userId: action.userId,
    platform: 'TWITTER',
    method: 'POST',
    endpoint: 'statuses/update'
  }
  return db.getUserRateLimit(dbOptions).then(result => {
    if (result > 0) {
      return utils.delayAction({
        action,
        limitResetAt: result
      })
    }

    const { type, twitterAccessTokens, replyToStatusId, ...tweet } = action

    const options = {
      token: twitterAccessTokens.token,
      secret: twitterAccessTokens.secret,
      statusId: replyToStatusId,
      ...tweet
    }

    return twitter.sendReply(options)
  })
}

/**
 * @typedef Recipients
 * @property {string} to Comma delimited list of recipients to put in the to field
 * @property {string} cc Comma delimited list of recipients to put in the cc field
 * @property {string} bcc Comma delimited list of recipients to put in the bcc field
 */

/**
 * @typedef SendEmailAction
 * @property {Recipients} recipients Recipients details
 * @property {string} subject Subject of the email
 * @property {string} body Body of the email in plain text
 * @property {string[]} media List of media URLs
 */

/**
 * Constructs the request and calls the SendGrid API to send an email.
 *
 * @param {SendEmailAction} action Send email action
 * @returns {Promise} Resolves with SendGrid API response
 */
function sendEmail (action) {
  const mailOptions = {
    to: action.recipients.to, // list of receivers seperated by commas
    cc: action.recipients.cc,
    bcc: action.recipients.bcc,
    subject: action.subject,
    text: action.body, // plaintext body
    // html: '<b>Hello world 🐴</b>', // html body
    attachments: action.media
  }

  return email.send(mailOptions)
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
 * @returns {Promise<object>} Resolves with request response
 */
function callEndpoint (action) {
  const options = {
    userId: action.userId,
    method: action.method,
    url: action.url,
    headers: action.headers, // remember to specify content-type if passing json
    body: action.body,
    timeout: action.timeout,
    retryStatuses: action.retryStatuses,
    auth: action.auth,
    query: action.query,
    form: action.form,
    retryRemaining: action.retryRemaining || defaultRetries
  }
  return endpoints.callEndpoint(options)
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
 * Retrieve value for identifier field from external API
 *
 * @param {LookupApiAction} action Lookup Api action
 * @returns {Promise<LookupApiResponse>} Resolves with the lookup API response
 */
function lookupApi (action) {
  const { url, id, username, password } = action

  const options = {
    url,
    id,
    username,
    password
  }

  return lookup.getLookupData(options)
}

/**
 * Insert into data set table.
 *
 * @param {object} action Dataset insert action
 * @param {string} action.dataset Table to insert into
 * @param {object} action.data Data to insert
 * @returns {Promise<object>} Resolves with mysql response
 */
function datasetInsert (action) {
  const options = {
    dataset: action.dataset,
    data: action.data
  }

  return db.insert(options)
}

/**
 * Update data set table.
 *
 * @param {object} action Dataset update action
 * @param {string} action.dataset Table to insert into
 * @param {string} action.column Column to update
 * @param {*} action.value Value to set
 * @param {string} action.searchColumn Where clause column
 * @param {*} action.searchKey Where clause value
 * @returns {Promise<object>} Resolves with mysql response
 */
function datasetUpdate (action) {
  const options = {
    dataset: action.dataset,
    column: action.column,
    value: action.value,
    searchColumn: action.searchColumn,
    searchKey: action.searchKey,
    insertIfNotExist: action.insertIfNotExist
  }

  return db.update(options)
}

/**
 * Call Twitter to send Dark Tweet.
 *
 * @param {SendTweetAction} action Send Tweet action
 * @returns {Promise} Resolves when Tweet send completes
 */
function sendDarkTweet (action) {
  const dbOptions = {
    userId: action.userId,
    platform: 'TWITTER',
    method: 'POST',
    endpoint: 'statuses/update'
  }
  return db.getUserRateLimit(dbOptions).then(result => {
    if (result > 0) {
      return utils.delayAction({
        action,
        limitResetAt: result
      })
    }

    const { type, twitterAccessTokens, ...tweet } = action

    const options = {
      token: twitterAccessTokens.token,
      secret: twitterAccessTokens.secret,
      ...tweet
    }

    return twitter.sendDarkTweet(options)
  })
}

/**
 * Call Twitter to send Dark Reply.
 *
 * @param {SendTweetAction} action Send Tweet action
 * @returns {Promise} Resolves when Tweet send completes
 */
function sendDarkReply (action) {
  const dbOptions = {
    userId: action.userId,
    platform: 'TWITTER',
    method: 'POST',
    endpoint: 'statuses/update'
  }
  return db.getUserRateLimit(dbOptions).then(result => {
    if (result > 0) {
      return utils.delayAction({
        action,
        limitResetAt: result
      })
    }

    const { type, replyToStatusId, twitterAccessTokens, ...tweet } = action

    const options = {
      token: twitterAccessTokens.token,
      secret: twitterAccessTokens.secret,
      statusId: replyToStatusId,
      ...tweet
    }

    return twitter.sendDarkReply(options)
  })
}

/**
 * Calls Twitter API V2 to hide a users reply to a brands post
 *
 * @param {object} action Send Tweet action
 * @returns {Promise} Resolves when Tweet send completes
 */
function hideTwitterReply (action) {
  const {
    twitterAccessTokens: { token: accessToken, secret: accessSecret },
    replyFromUserId,
    handle,
    tweetId,
    eventText,
    replyCreatedAt,
    widgetId
  } = action
  const { TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET } = process.env

  const twitterV2 = TwitterV2.createTwitterClient({
    consumerKey: TWITTER_CONSUMER_KEY,
    consumerSecret: TWITTER_CONSUMER_SECRET,
    accessToken,
    accessSecret
  })

  const endpoint = `tweets/${tweetId}/hidden`
  const body = { hidden: true }

  return twitterV2.put({ endpoint, body }).then(() => {
    return db.storeHiddenTweet({
      widgetId,
      userId: replyFromUserId,
      userHandle: handle,
      tweetId,
      eventText,
      createdAt: replyCreatedAt,
      replyText: eventText
    })
  })
}

/**
 * Handle a speed thread start action.
 *
 * @param {object} action Speed thread start action
 * @param {string} action.type Action type - presumably 'SPEED_THREAD_START'
 * @param {string} action.widgetId Widget ID
 * @param {string} action.userId User ID
 * @param {string} action.userHandle User handle
 * @param {string} action.timestamp Timestamp of first interaction
 * @param {string} action.optinId ID from twitter as evidence of user opt-in
 * @param {number} action.timeout Timeout value in seconds
 * @returns {Promise} Resolves when speed thread start completes
 */
async function speedThreadStart ({
  type: actionType,
  widgetId,
  userId,
  userHandle,
  timestamp: firstInteractionTime,
  optinId,
  timeout = null
}) {
  logger.child({
    action: { widgetId, userId, userHandle, firstInteractionTime }
  })

  try {
    const queryResult = await db.getSpeedThreadParticipant({
      widgetId,
      userId
    })

    if (queryResult.length > 0) {
      const hasFinished = R.propOr(false, 'last_interaction_time')
      const errorMessage = hasFinished(queryResult[0])
        ? `User ID ${userId} has already finished the speed thread for widget ${widgetId}`
        : `User ID ${userId} is already participating in speed thread widget ${widgetId}`

      logger.warn(errorMessage)
      return { success: false, message: errorMessage }
    }

    await db.startSpeedThreadParticipant({
      widgetId,
      userId,
      userHandle,
      firstInteractionTime,
      optinId,
      timeout
    })

    return { success: true }
  } catch (err) {
    logger.error({ err }, 'Error starting speed thread participant')
    metrics.increment(`action.process.${actionType}.error`)
    metrics.increment(
      `action.process.${actionType}.error`,
      `widgetId:${widgetId}`
    )
    return { success: false, message: err.message }
  }
}

/**
 * Handle a speed thread end action.
 * This action is triggered when a user reaches the end of the speed thread experience.
 *
 * @param {object} action Speed thread end action
 * @param {string} action.type Action type - presumably `SPEED_THREAD_STOP`
 * @param {string} action.widgetId Widget ID
 * @param {string} action.userId Participant Twitter User ID
 * @param {string} action.timestamp Timestamp of when user reached end of the speed thread experience
 * @returns {Promise<object>} Resolves with time elapsed in milliseconds
 */
async function speedThreadStop ({
  type: actionType,
  widgetId,
  userId,
  timestamp: finalInteractionTime
}) {
  logger.child({
    action: { widgetId, userId, finalInteractionTime }
  })
  try {
    const participants = await db.getSpeedThreadParticipant({
      widgetId,
      userId
    })

    if (participants.length === 0) {
      const errorMessage = `User ID ${userId} has not started speed thread for widget ${widgetId}`
      logger.warn(errorMessage)
      return { success: false, message: errorMessage }
    }

    const hasFinished = R.propOr(false, 'last_interaction_time')
    if (hasFinished(participants[0])) {
      const errorMessage = `Failed to update speed thread participant: User ID ${userId} has already finished for widget ${widgetId}`
      logger.warn(errorMessage)
      return { success: false, message: errorMessage }
    }

    await db.stopSpeedThreadParticipant({
      widgetId,
      userId,
      finalInteractionTime
    })

    const timeElapsedInMs = await db.getInteractionDurationForParticipant({
      widgetId,
      userId,
      finalInteractionTime
    })

    const body = JSON.stringify({ timeElapsedInMs })
    return { body } // double stringify to escape quotes
  } catch (err) {
    logger.child(err)
    const errorMessage =
      'Failed to update speed thread participant with finish timestamp'
    logger.error(errorMessage)
    metrics.increment(
      `action.process.${actionType}.error`,
      `widgetId:${widgetId}`
    )
    return { success: false, message: errorMessage }
  }
}

/**
 * Store a timed thread activity.
 * This action is triggered when a user interacts with a timed speed thread.
 *
 * @param {object} action Timed thread activity action
 * @param {string} action.type Action type - presumably `ADD_TIMED_THREAD_ACTIVITY`
 * @param {string} action.widgetId Widget ID
 * @param {string} action.userId Participant Twitter User ID
 * @param {string} action.userHandle Participant Twitter handle
 * @param {string} action.timestamp Timestamp of interaction
 * @param {string} action.tweetId Tweet ID of interaction
 * @returns {Promise<object>} Returns an object with success status, and retry message if applicable
 */
async function addTimedThreadActivity ({
  type,
  userId,
  userHandle,
  timestamp,
  tweetId,
  widgetId
}) {
  logger.child({ widgetId, userId, userHandle, timestamp, tweetId })
  logger.debug(`Handling action ${type} for widget ${widgetId}`)

  try {
    await db.addTimedThreadActivity({
      widgetId,
      userId,
      userHandle,
      timestamp,
      tweetId
    })

    return { success: true }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      logger.debug('Duplicate timed thread activity entry. Ignoring...')
      metrics.increment(
        `action.process.${type}.duplicate`,
        `widgetId:${widgetId}`
      )
      return { success: true }
    }
    logger.child({
      action: { widgetId, userId, userHandle, timestamp, tweetId },
      err
    })
    const errorMessage = 'Failed to add timed thread activity'
    logger.error(errorMessage)
    metrics.increment(`action.process.${type}.error`, `widgetId:${widgetId}`)
    return {
      success: false,
      message: errorMessage,
      retry: true,
      retryRemaining: 3
    }
  }
}

/**
 * Calls the Kraken to send a blast.
 *
 * @param {object} action Send blast action
 * @param {object=} deps Dependencies
 * @param {string=} deps.krakenUrl The URL to the kraken service
 * @returns {Promise} Resolves with response from Kraken
 */
function sendBlast (
  action,
  // istanbul ignore next
  { krakenUrl = `${process.env.KRAKEN_URL}/release` } = {}
) {
  const { userId } = action
  const headers = {
    'Content-Type': 'application/json'
  }
  const body = JSON.stringify({ ...action, type: undefined })
  const options = {
    userId,
    method: 'POST',
    url: krakenUrl,
    headers,
    body,
    timeout: 60 * 1000 // 60 seconds
  }

  return endpoints.callEndpoint(options)
}

/**
 * Re-route the action to another queue.  This function can be seen as a proxy
 * where the Amqp message does not need to be modified in any way, only sent to
 * another queue
 *
 * @param {string} routingKeyPrefix To be prepended to the routing key.
 * @param {object} action Send blast batch action
 * @param {object} channel AMQP channel
 */
function reRouteAction (routingKeyPrefix, action, channel) {
  const { widgetId, type } = action
  const routingKey = `${routingKeyPrefix}.${widgetId}`

  logger.debug(
    `Re-routing '${type}' action to '${routingKey}' for widget Id '${widgetId}'`
  )

  channel.publish(exchangeName, routingKey, Buffer.from(JSON.stringify(action)))
}

/**
 * Publish Send Blast Batch action to AMQP
 *
 * @param {object} action Send blast batch action
 * @param {object} channel AMQP channel
 */
function sendBlastBatch (action, channel) {
  reRouteAction('actions.blastbatch', action, channel)
}

/**
 * Call subscription service to opt in user.
 *
 * @param {object} action Opt in action
 * @param {object=} deps Dependencies
 * @param {string=} deps.subscriptionsUrl URL to the subscriptions service
 * @returns {Promise} Resolves with subscription service response
 */
function optIn (
  action,
  // istanbul ignore next
  { subscriptionsUrl = `${process.env.SUBSCRIPTIONS_URL}/participants` } = {}
) {
  const { widgetId, userId, handle, responseType, optinId } = action
  const body = JSON.stringify({
    widgetId,
    userId,
    handle,
    responseType,
    optinId
  })
  const options = {
    widgetId,
    userId,
    method: 'POST',
    url: `${subscriptionsUrl}/${widgetId}`,
    body
  }

  return endpoints.callEndpoint(options)
}

/**
 * Call subscription service to opt out user.
 *
 * @param {object} action Opt out action
 * @param {object=} deps Dependencies
 * @param {string=} deps.subscriptionsUrl URL to the subscriptions service
 * @returns {Promise} Resolves with subscription service response
 */
function optOut (
  action,
  // istanbul ignore next
  { subscriptionsUrl = `${process.env.SUBSCRIPTIONS_URL}/participants` } = {}
) {
  const { widgetId, userId } = action

  const options = {
    widgetId,
    userId,
    method: 'DELETE',
    url: `${subscriptionsUrl}/${widgetId}/${userId}`
  }

  return endpoints.callEndpoint(options)
}

/**
 * Process a sequence of actions.
 *
 * @param {object} options Configuration options
 * @param {object[]} options.actions Actions to process in sequence (order maintained)
 * @param {string} options.userId Twitter user ID
 * @returns {Promise} Resolves once all actions in sequence processed
 */
function sequence (
  // istanbul ignore next
  { actions, userId } = {}
) {
  if (!Array.isArray(actions)) {
    throw new Error('Sequence requires a valid array of actions')
  }

  const hasNestedSequence = R.find(R.propEq('type', 'SEQUENCE'))
  if (hasNestedSequence(actions)) {
    throw new Error('Sequence cannot contain a sequence of actions')
  }

  return from(actions)
    .pipe(
      map(R.mergeRight({ userId })),
      concatMap(actionProcessor.processAction),
      toArray()
    )
    .toPromise()
}

/**
 * @typedef IndicateTypingAction
 * @property {string} token Twitter access token
 * @property {string} secret Twitter access secret
 * @property {string} recipientId Direct message recipient ID
 * @property {string} userId Twitter user ID
 */

/**
 * Call Twitter to send typing indicator.
 *
 * @param {IndicateTypingAction} action Indicate typing action
 * @returns {Promise} Resolves when Twitter notified of typing
 */
function indicateTyping (action) {
  const dbOptions = {
    userId: action.userId,
    platform: 'TWITTER',
    method: 'POST',
    endpoint: 'direct_messages/indicate_typing'
  }
  return db.getUserRateLimit(dbOptions).then(result => {
    if (result > 0) {
      return utils.delayAction({
        action,
        limitResetAt: result
      })
    }

    const { twitterAccessTokens, recipientId, userId } = action

    const options = {
      ...twitterAccessTokens,
      recipientId,
      userId
    }

    return twitter.indicateTyping(options)
  })
}

/**
 * @typedef TwitterAccessTokens
 * @property {string} token Twitter access token
 * @property {string} secret Twitter access secret
 */

/**
 * @typedef RequestFeedbackAction
 * @property {string} userId Twitter user ID
 * @property {TwitterAccessTokens} twitterAccessTokens Twitter access token and secret
 */

/**
 * Call Twitter to request feedback.
 *
 * @param {RequestFeedbackAction} action Request feedback action
 * @returns {Promise} Resolves when feedback requested
 */
function requestFeedback (action) {
  const dbOptions = {
    userId: action.userId,
    platform: 'TWITTER',
    method: 'POST',
    endpoint: 'feedback/create'
  }
  return db.getUserRateLimit(dbOptions).then(result => {
    if (result > 0) {
      return utils.delayAction({
        action,
        limitResetAt: result
      })
    }

    return twitter.requestFeedback(action)
  })
}

/**
 * Publish overlay action to image manipulation service.
 *
 * @param {object} action Overlay action
 * @param {object} channel AMQP channel
 */
function overlay (action, channel) {
  const {
    overlayMediaId,
    profileImageUrl,
    text,
    twitterAccessTokens,
    userId,
    type,
    widgetId
  } = action

  const nextActionType = 'SEND_DARK_TWEET'

  const imageManipulationPayload = {
    pipeline: {
      imageUrl: profileImageUrl,
      responseType: 'MEDIA_ID',
      tasks: [
        {
          type,
          imageMediaId: overlayMediaId
        }
      ]
    },
    action: {
      type: nextActionType,
      widgetId,
      text,
      twitterAccessTokens,
      media: []
    }
  }

  channel.publish(
    exchangeName,
    `image.manipulation.${nextActionType}.${userId}`,
    Buffer.from(JSON.stringify(imageManipulationPayload)),
    {
      priority: 1
    }
  )
}

/**
 * Publish photo mosaic action to photo mosaic service.
 *
 * @param {object} action Overlay action
 * @param {object} channel AMQP channel
 * @deprecated Will be removed in a future release in favour of photoMosaic2
 */
function photoMosaic1 (action, channel) {
  const { widgetId } = action
  const { campaignId, type, ...mosaicAction } = action

  if (!campaignId) {
    logger.warn(
      `No mosaic campaign id specified for widget id ${widgetId}, discarding message...`
    )

    metrics.increment('actions.process.discarded')
    return
  }

  channel.publish(
    exchangeName,
    `actions.mosaic.${type}.${campaignId}`,
    Buffer.from(JSON.stringify(mosaicAction)),
    {
      priority: 1
    }
  )
}

/**
 * Publish photo mosaic action to photo mosaic service.
 *
 * @param {object} action Photo mosaic action object
 * @param {string} action.source Social media platform of the opt-in/out action
 * @param {string[]} action.imageUrls List of image urls
 * @param {string} action.identifier Platform specific user ID of the user who opted in/out
 * @param {string} action.ownerId Blue Robot User ID that owns the widget to which this action belongs
 * @param {string} action.id Campaign id of the photomosaic
 * @param {string} action.type The action type (either OPT IN or OPT OUT action)
 * @param {string[]} action.searchTerms List of search terms to be used to find the images
 * @param {object[]} action.actions List of actions to perform after the mosaic is generated
 * @param {object} channel AMQP channel
 */
function photoMosaic2 (action, channel) {
  logger.debug({ action }, 'action to be checked for missing properties')
  const missingProperties = R.pipe(
    R.pickAll(['source', 'identifier', 'ownerId', 'id', 'type', 'searchTerms']),
    R.pickBy(R.isNil),
    R.keys
  )(action)

  if (missingProperties.length) {
    logger.error(
      `Missing properties for photo mosaic action(s): ${missingProperties}. Discarding...`
    )
    metrics.increment('actions.process.photomosaic.discarded')
    return
  }

  const { type, id, ...mosaicAction } = action

  if (type === 'MOSAIC_OPT_IN' && R.isEmpty(mosaicAction.imageUrls)) {
    logger.error(
      'Missing required non-empty imageUrls parameter for photo mosaic opt in'
    )
    metrics.increment('actions.process.photomosaic.discarded')
    return
  }

  channel.publish(
    exchangeName,
    `actions.mosaic2.${type}.${id}`,
    Buffer.from(JSON.stringify(mosaicAction)),
    {
      priority: 1
    }
  )
}

/**
 * Publish photo mosaic action to photo mosaic service.
 * This function is a wrapper for the photoMosaic1 and photoMosaic2 functions,
 * until the photoMosaic1 function is removed.
 * At that point, photoMosaic2 will be renamed to photoMosaic, and this function
 * will be removed.
 *
 * The hard-coded campaignId and widgetId checks are to ensure that the
 * photoMosaic1 function is only called for the campaigns that are currently
 * using it.
 *
 * @param {object} action Overlay action
 * @param {object} channel AMQP channel
 */
function photoMosaic (action, channel) {
  const PHOTO_MOSAIC_VERSION = process.env.PHOTO_MOSAIC_VERSION || '2'
  if (
    PHOTO_MOSAIC_VERSION === '1' ||
    action?.campaignId === '3e6d8cbf-4330-11ee-99c9-42010a84005a' ||
    action?.widgetId === '3da2e3c3-4330-11ee-943f-42010a8400e5'
  ) {
    photoMosaic1(action, channel)
  } else if (PHOTO_MOSAIC_VERSION === '2') {
    photoMosaic2(action, channel)
  }
}

/**
 * @typedef {object} DeleteTweetAction
 * @property {string} tweetId - the id of the tweet to delete
 * @property {string} userId - the user that sent the tweet
 * @property {{ token: string, secret: string }} twitterAccessTokens - the credentials of the user that sent the tweet
 */

/**
 * Execute a "DELETE_TWEET" action
 *
 * @param {DeleteTweetAction} action Delete Tweet action
 * @returns {Promise} Resolves when processing completes
 */
async function deleteTweet (action) {
  const dbOptions = {
    userId: action.userId,
    platform: 'TWITTER',
    method: 'POST',
    endpoint: 'statuses/destroy'
  }

  const result = await db.getUserRateLimit(dbOptions)

  if (result > 0) {
    return utils.delayAction({
      action,
      limitResetAt: result
    })
  }

  const { twitterAccessTokens, tweetId, userId } = action

  const options = {
    token: twitterAccessTokens.token,
    secret: twitterAccessTokens.secret,
    tweetId,
    userId
  }

  await twitter.deleteTweet(options)

  await db.deleteTweet(tweetId)
}

/**
 * The action as the action-builder builds it
 *
 * @typedef {object} DashbotTrackAction
 * @property {"DASHBOT_TRACK"} type action type
 * @property {string} text DM text
 * @property {string} userId sender id
 * @property {string} platform twitter/facebook
 * @property {string} platformJson eventJson as received from platform
 * @property {string} apiKey dashbot api key
 */

/**
 * Sets up the DASHBOT_TRACK request and calls the endpoint
 *
 * @param {DashbotTrackAction} action the DashbotTrackAction
 * @returns {Promise<object>} returns a promise that resolves with the response
 */
function dashbotTrack (action) {
  const {
    platform,
    apiKey,
    text,
    userId,
    platformJson,
    retryRemaining
  } = action
  const body = { text, userId, platformJson }

  const options = {
    userId,
    method: 'POST',
    url: dashbotUrl,
    body,
    retryRemaining: retryRemaining || defaultRetries,
    query: {
      type: 'incoming',
      v: process.env.DASHBOT_API_VERSION,
      platform: platform,
      apiKey: apiKey
    }
  }
  return endpoints.callEndpoint(options)
}

/**
 * @typedef {object} ChatbaseTrackAction
 * @property {"CHATBASE_TRACK"} type action type
 * @property {string} message DM text
 * @property {string} userId sender id
 * @property {string} timestamp time at which message was sent
 * @property {string} intent the matched dialogflow intent name
 * @property {string} platform twitter/facebook
 * @property {string} apiKey chatbase api key
 */

/**
 * Sets up the CHATBASE_TRACK request and calls the endpoint for more info check https://chatbase.com/documentation/generic
 *
 * @param {ChatbaseTrackAction} action the ChatbaseTrackAction
 * @returns {Promise<object>} returns a promise that resolves with the response
 */
function chatbaseTrack (action) {
  const {
    apiKey,
    userId,
    timestamp,
    retryRemaining,
    ...remainingParams
  } = action

  const body = {
    ...remainingParams,
    api_key: apiKey,
    user_id: userId,
    time_stamp: timestamp,
    type: 'user'
  }

  const options = {
    userId,
    method: 'POST',
    url: chatbaseUrl,
    body,
    retryRemaining: retryRemaining || defaultRetries
  }
  return endpoints.callEndpoint(options)
}

/**
 *
 * @typedef {object} GoogleAnalyticsTrackEventAction
 * @property {"GOOGLE_ANALYTICS_TRACK_EVENT"} type action type
 * @property {string} url 'https://www.google-analytics.com/collect'
 * @property {object} query the search paramaters object
 * @property {string} query.v version of the api
 * @property {"event"} query.t type of metric being tracked
 * @property {string} query.uid user id, in this case the widget id
 * @property {string} query.tid tracking id ex: UA-45678932-2
 * @property {string} query.ec category
 * @property {string} query.ea action
 * @property {string} query.el label
 */

/**
 * Sets up the GOOGLE_ANALYTICS_TRACK_EVENT request and calls the endpoint for more info check https://developers.google.com/analytics/devguides/collection/protocol/v1/devguide
 *
 * @param {GoogleAnalyticsTrackEventAction} action the GoogleAnalyticsTrackEventAction
 * @returns {Promise<object>} returns a promise that resolves with the response
 */
function googleAnalyticsTrackEvent (action) {
  const { type, ...actionWithoutType } = action

  const options = {
    ...actionWithoutType,
    retryRemaining: action.retryRemaining || defaultRetries
  }
  return endpoints.callEndpoint(options)
}

/**
 * @typedef {object} GoogleSheetAppendAction as received from the widget
 * @property {string} widgetId The BR widget ID
 * @property {string} spreadsheetId ID of the spreadsheet to append to
 * @property {number} sheetId ID of the sheet to append to
 * @property {string[]} row array of values to be added as a new row
 * @property {"GOOGLE_SHEET_APPEND"} type can only be GOOGLE_SHEET_APPEND
 */

/**
 * Publish Google Sheet Append action to AMQP
 *
 * @param {GoogleSheetAppendAction} action Google Sheet Append action
 * @param {object} channel AMQP channel
 */
function googleSheetAppend (action, channel) {
  reRouteAction('googlesheets.append', action, channel)
}

/**
 * @typedef {object} WhatsappMessage
 * @property {string} to destination number
 * @property {'individual' | 'group'} recipient_type recipient type
 * @property {object} text text message
 * @property {string} text.body actual string to send
 * @property {'text'} type type of message
 */

/**
 * @typedef {object} SendWhatsappMessageAction
 * @property {string} apiKey encrypted 360dialog api key
 * @property {WhatsappMessage} message message
 */

/**
 * @param {SendWhatsappMessageAction} action Whatsapp send message action
 * @param {object=} deps dependencies
 * @returns {Promise<object>} returns a promise that resolves with the response
 */
async function sendWhatsappMessage (
  action,
  // istanbul ignore next
  { crypt = require('@bluerobot/crypt-keeper') } = {}
) {
  const dbOptions = {
    userId: action.userId,
    platform: 'WHATSAPP',
    method: 'POST',
    endpoint: 'messages'
  }

  const result = await db.getUserRateLimit(dbOptions)

  if (result > 0) {
    return utils.delayAction({
      action,
      limitResetAt: result
    })
  }

  const { apiKey, message } = action

  const defaultWhatsappActionLimit = R.defaultTo(
    process.env.WHATSAPP_ACTION_RETRY_LIMIT || 100
  )

  const retryRemaining = defaultWhatsappActionLimit(action.retryRemaining)

  const headers = {
    'D360-Api-Key': crypt.decrypt(apiKey)
  }

  const requestOptions = {
    method: 'POST',
    url: process.env.D360_API_URL,
    body: message,
    headers,
    retryStatuses: whatsAppDelayStatuses.join(','),
    retryRemaining
  }

  const response = await endpoints.callEndpoint(requestOptions)

  const isRateLimited = whatsAppDelayStatuses.includes(response.status)

  if (isRateLimited) {
    logger.info(
      { response },
      `WhatsApp rate limit ${response.status} error received`
    )

    return utils.setRateLimit({
      action,
      platform: 'WHATSAPP',
      headers: {
        'x-rate-limit-reset': Math.round(
          (Date.now() + DEFAULT_WHATSAPP_DELAY) / 1000
        )
      },
      method: 'POST',
      endpoint: 'messages',
      userId: action.userId
    })
  }

  return response
}

/**
 * Sends a message to a user on Instagram's Messenger
 *
 * @param {instagram.SendInstagramMessageAction} action the instagram action
 * @returns {Promise<object>} promise that resolves with the response
 */
async function sendInstagramMessage (action) {
  return instagram.sendInstagramMessage(action)
}

/**
 * Sends a comment reply Instagram's Messenger
 *
 * @param {instagram.SendInstagramMessageAction} action the instagram action
 * @returns {Promise<object>} promise that resolves with the response
 */
async function sendInstagramCommentReply (action) {
  return instagram.sendInstagramCommentReply(action)
}

/**
 * Sends a message to a user on Facebook Messenger in response to a comment or post
 *
 * @param {object} action the SEND_FACEBOOK_MESSAGE action
 * @returns {Promise<object>} promise that resolves with the response
 */
async function sendFacebookMessage (action) {
  return facebook.sendFacebookMessage(action)
}

/**
 * Calls FB subscription service with opt in payload
 *
 * @param {object} action the SEND_FACEBOOK_COMMENT action
 * @returns {Promise<object>} promise that resolves with the response
 */
async function sendFacebookComment (action) {
  return facebook.sendFacebookComment(action)
}

/**
 * Opts a user into a one-time Facebook reminder/notification
 *
 * @param {object} action the FB_OPT_IN_ONE_TIME action
 * @returns {Promise<object>} promise that resolves with the response
 */
async function fbOptInOneTime (action) {
  const { widgetId, userPsid } = action
  if (await facebook.checkOptedIn(widgetId, userPsid)) {
    logger.info({ action }, 'User already opted in')
    return { status: 200, body: 'User already opted in' }
  }
  return facebook.fbOptInOneTime(action)
}

/**
 * Opts a user out of  a one-time or recurring Facebook reminder/notification
 *
 * @param {object} action the FB_OPT_OUT_ONE_TIME action
 * @returns {Promise<object>} promise that resolves with the response
 */
async function fbOptOut (action) {
  return facebook.fbOptOut(action)
}

/**
 * Opts a user into a recurring Facebook reminder/notification
 *
 * @param {object} action the FB_OPT_IN_RECURRING action
 * @returns {Promise<object>} promise that resolves with the response
 */
async function fbOptInRecurring (action) {
  return facebook.fbOptInRecurring(action)
}

/**
 * Calls Kraken with blast payload
 *
 * @param {object} action the SEND_FACEBOOK_BLAST action
 * @returns {Promise<object>} promise that resolves with the response
 */
async function sendFacebookBlast (action) {
  return facebook.sendFacebookBlast(action)
}

/**
 * Calls the coupon service to unlock coupons
 *
 * @param {object} action - action received from builder
 * @returns {number} status of call to coupon
 */
async function unlockCoupons (action) {
  return endpoints.unlockCoupons(action)
}

/**
 * Calls the coupon service to unlock coupons
 *
 * @param {object} action - action received from builder
 * @returns {number} status of call to coupon
 */
async function trackInteraction (action) {
  const { widgetId } = action
  try {
    await db.trackInteraction(widgetId, action)
    return { success: true }
  } catch (err) {
    logger.error({ err }, 'Error tracking interaction')
    return { success: false }
  }
}

const actionProcessor = {
  processAction,
  sendTweet,
  sendDm,
  sendReply,
  sendEmail,
  callEndpoint,
  datasetInsert,
  datasetUpdate,
  sendDarkTweet,
  sendDarkReply,
  hideTwitterReply,
  speedThreadStart,
  speedThreadStop,
  addTimedThreadActivity,
  sendBlast,
  sendBlastBatch,
  optIn,
  optOut,
  sequence,
  indicateTyping,
  requestFeedback,
  overlay,
  photoMosaic,
  deleteTweet,
  dashbotTrack,
  chatbaseTrack,
  reRouteAction,
  googleSheetAppend,
  googleAnalyticsTrackEvent,
  sendWhatsappMessage,
  sendInstagramMessage,
  sendInstagramCommentReply,
  sendFacebookMessage,
  sendFacebookComment,
  fbOptInOneTime,
  fbOptOut,
  fbOptInRecurring,
  sendFacebookBlast,
  lookupApi,
  unlockCoupons,
  trackInteraction
}

/**
 * Process action based on type.
 *
 * @param {object} action Action to process
 * @param {string} action.type Action type
 * @param {number} action.delay Time in milliseconds to delay action processing
 * @param {object} channel AMQP channel
 * @returns {Promise} Resolves when action has been processed
 */
async function processAction (action, channel, { delayParam = delay } = {}) {
  if (action.delay) {
    logger.debug('Delaying action by %d ms', action.delay)
    await delayParam(action.delay)
  }

  switch (action.type) {
    case 'SEND_TWEET':
      return actionProcessor.sendTweet(action)
    case 'SEND_DM':
      return actionProcessor.sendDm(action)
    case 'SEND_REPLY':
      return actionProcessor.sendReply(action)
    case 'SEND_EMAIL':
      return actionProcessor.sendEmail(action)
    case 'CALL_ENDPOINT':
      return actionProcessor.callEndpoint(action)
    case 'DATASET_INSERT':
      return actionProcessor.datasetInsert(action)
    case 'DATASET_UPDATE':
      return actionProcessor.datasetUpdate(action)
    case 'SEND_DARK_TWEET':
      return actionProcessor.sendDarkTweet(action)
    case 'SEND_DARK_REPLY':
      return actionProcessor.sendDarkReply(action)
    case 'SPEED_THREAD_START':
      return actionProcessor.speedThreadStart(action)
    case 'SPEED_THREAD_STOP':
      return actionProcessor.speedThreadStop(action)
    case 'ADD_TIMED_THREAD_ACTIVITY':
      return actionProcessor.addTimedThreadActivity(action)
    case 'SEND_BLAST':
      return actionProcessor.sendBlast(action)
    case 'SEND_BLAST_BATCH':
      return actionProcessor.sendBlastBatch(action, channel)
    case 'OPT_IN':
      return actionProcessor.optIn(action)
    case 'OPT_OUT':
      return actionProcessor.optOut(action)
    case 'SEQUENCE':
      return actionProcessor.sequence(action)
    case 'INDICATE_TYPING':
      return actionProcessor.indicateTyping(action)
    case 'SEND_FEEDBACK_REQUEST':
      return actionProcessor.requestFeedback(action)
    case 'OVERLAY_IMAGE':
    case 'OVERLAY_GIF':
      return actionProcessor.overlay(action, channel)
    case 'MOSAIC_OPT_IN':
    case 'MOSAIC_OPT_OUT':
      return actionProcessor.photoMosaic(action, channel)
    case 'DELETE_TWEET':
      return actionProcessor.deleteTweet(action)
    case 'DASHBOT_TRACK':
      return actionProcessor.dashbotTrack(action)
    case 'CHATBASE_TRACK':
      return actionProcessor.chatbaseTrack(action)
    case 'GOOGLE_ANALYTICS_TRACK_EVENT':
      return actionProcessor.googleAnalyticsTrackEvent(action)
    case 'GOOGLE_SHEET_APPEND':
      return actionProcessor.googleSheetAppend(action, channel)
    case 'SEND_WHATSAPP_MESSAGE':
      return actionProcessor.sendWhatsappMessage(action)
    case 'SEND_INSTAGRAM_MESSAGE':
      return actionProcessor.sendInstagramMessage(action)
    case 'SEND_INSTAGRAM_COMMENT_REPLY':
      return actionProcessor.sendInstagramCommentReply(action)
    case 'LOOKUP_API':
      return actionProcessor.lookupApi(action)
    case 'SEND_FACEBOOK_MESSAGE':
      return actionProcessor.sendFacebookMessage(action)
    case 'SEND_FACEBOOK_COMMENT':
      return actionProcessor.sendFacebookComment(action)
    case 'FB_OPT_IN_ONE_TIME':
      return actionProcessor.fbOptInOneTime(action)
    case 'FB_OPT_OUT_ONE_TIME':
      return actionProcessor.fbOptOut(action)
    case 'FB_OPT_IN_RECURRING':
      return actionProcessor.fbOptInRecurring(action)
    case 'FB_OPT_OUT_RECURRING':
      return actionProcessor.fbOptOut(action)
    case 'SEND_FACEBOOK_BLAST':
      return actionProcessor.sendFacebookBlast(action)
    case 'UNLOCK_COUPONS':
      return actionProcessor.unlockCoupons(action)
    case 'HIDE_TWITTER_REPLY':
      return actionProcessor.hideTwitterReply(action)
    case 'TRACK_INTERACTION':
      return actionProcessor.trackInteraction(action)
    default:
      throw new Error(`Action not recognized: ${action.type}`)
  }
}

module.exports = actionProcessor
