const R = require('ramda')
const { logger } = require('@bluerobot/monitoring')
const media = require('./media')
const utils = require('./utils')
const db = require('./db')
const crypto = require('crypto')
const { setRateLimit } = require('./utils')
const Twitter = require('@bluerobot/twitter')

const TWITTER_DAILY_LIMIT_DELAY =
  Number(process.env.TWITTER_DAILY_LIMIT_DELAY) || 1 * 60 * 60 * 1000 // default 1 hour

const { getRetryStatuses } = require('./endpoints')

const twitterErrorCodes = {
  RATE_LIMIT: 88, // too many requests
  DAILY_LIMIT: 185 // user is over daiy status update limit
}
const httpErrorCodes = {
  ENHANCE_CALM: 420, // Twitter's bespoke HTTP code for rate-limiting (https://developer.twitter.com/ja/docs/basics/response-codes)
  RATE_LIMIT: 429,
  UNAUTHORIZED: 401, // bad token data
  FORBIDDEN: 403 // request access not allowed
}
const timeoutCodes = ['ETIMEDOUT', 'ESOCKETTIMEDOUT']

const DEFAULT_RETRIES = Number(process.env.DEFAULT_RETRIES) || 100
const defaultRetries = R.defaultTo(DEFAULT_RETRIES)

/**
 * Compares response error code with Twitter Daily Limit error code
 *
 * @example `findDailyLimitError( [{ code: 184 }] ) // returns true`
 * @param {{code: string}[]} errors the response errors to check
 * @returns {boolean} true or false
 */
const findDailyLimitError = R.find(
  R.propEq('code', twitterErrorCodes.DAILY_LIMIT)
)

/**
 * Confirms if response contains daily limit
 *
 * @example dailyLimitReached({ errors: [{ code: 184 }] }) // returns true
 * @param {{ errors: Array.<{code: string}> }} errors the errors to check
 * @returns {boolean} - true or false
 */
const dailyLimitReached = R.pipe(R.prop('errors'), findDailyLimitError)

/**
 * Return the media id from two supported DM media formats
 *
 * @param {object} actionMedia - A String or an Object with a prop called 'id'
 * @returns {string} - actionMedia.id if exists, else actionMedia
 */
const getDmMedia = actionMedia => R.pathOr(actionMedia, ['id'])(actionMedia)

const removeUndefinedValues = R.filter(R.identity)

// Now + backoffDelay in millis, converted to UNIX time
const calculateBackoffDelay = backoffDelay =>
  (new Date().getTime() + backoffDelay) / 1000

const isDMEndpoint = endpoint => endpoint === 'direct_messages/events/new'

const getTweetBackoffUnixTime = () => {
  const TWITTER_420_TWEET_BACKOFF_DELAY =
    Number(process.env.TWITTER_420_TWEET_BACKOFF_DELAY) || 10 * 60 * 1000 // default 10 minutes

  return calculateBackoffDelay(TWITTER_420_TWEET_BACKOFF_DELAY)
}

const getDMBackoffUnixTime = () => {
  const TWITTER_420_DM_BACKOFF_DELAY =
    Number(process.env.TWITTER_420_DM_BACKOFF_DELAY) || 1 * 60 * 1000 // default 1 minute

  return calculateBackoffDelay(TWITTER_420_DM_BACKOFF_DELAY)
}

const isEnhanceCalmError = R.pipe(
  R.pathOr(0, ['response', 'statusCode']),
  R.equals(httpErrorCodes.ENHANCE_CALM)
)

/**
 * Handle retries and rate limit responses for Twitter API errors
 *
 * @param {Error} error the error thrown while calling Twitter
 * @param {object} options the options to use for logging and retrying
 * @param {object} options.action the action that was being executed
 * @param {string} options.endpoint the endpoint called
 * @param {string} options.method the HTTP method used
 * @param {object} options.params the endpoint parameters
 * @returns {object} an object defining how to continue processing
 */
function handleTwitterError (error, { action, method, endpoint, params }) {
  const headers = error.response ? error.response.headers : {}

  const log = logger.child({
    method,
    endpoint,
    params,
    error
  })
  const twitterApiErrorsPath = ['response', 'body', 'detail']
  const isTwitterApiError = R.hasPath(twitterApiErrorsPath)
  const getTwitterApiErrors = R.path(['response', 'body'])

  if (isEnhanceCalmError(error)) {
    log.warn(
      {
        err: error,
        action: utils.sanitizeAction(action, ['token', 'secret']),
        method,
        endpoint
      },
      `Twitter rate limit 420 error received. ${error.message}`
    )

    const defaultLimitResetAt = R.ifElse(
      isDMEndpoint,
      getDMBackoffUnixTime,
      getTweetBackoffUnixTime
    )(endpoint)

    return setRateLimit({
      platform: 'TWITTER',
      action,
      headers,
      method,
      endpoint,
      userId: action.userId,
      defaultLimitResetAt
    })
  }

  if (isTwitterApiError(error)) {
    const { status: code, detail: message } = getTwitterApiErrors(error)

    if (code === twitterErrorCodes.RATE_LIMIT) {
      log.warn('Twitter rate limit error received.')

      return setRateLimit({
        platform: 'TWITTER',
        action,
        headers,
        method,
        endpoint,
        userId: action.userId
      })
    }

    if (code === twitterErrorCodes.DAILY_LIMIT) {
      log.warn('Twitter daily limit error received.')

      return {
        action,
        delay: TWITTER_DAILY_LIMIT_DELAY
      }
    }

    error.message = message

    throw error
  } else {
    if (timeoutCodes.includes(error.code)) {
      log.warn('Timeout error received.')

      return {
        status: error.code,
        body: error.message,
        retry: true,
        retryRemaining: defaultRetries(action.retryRemaining)
      }
    }

    const status = error.statusCode
    const retryStatuses = getRetryStatuses(action)
    const retry = retryStatuses.includes(status)

    if (retry) {
      return {
        status,
        body: error,
        retry: true,
        retryRemaining: defaultRetries(action.retryRemaining)
      }
    }

    throw error
  }
}

/**
 * Handles retries and rate limits for Media Service errors
 *
 * @param {Error} err the error thrown while calling the media service
 * @param {object} options the options used for logging and retrying
 * @param {object} options.action the action that triggered the call
 * @param {string} options.method the method used
 * @param {string} options.endpoint the endpoint called
 * @param {string} options.userId the userId of the actor
 * @param {string[]} options.gcsMediaIds the media ids referenced in the action
 * @returns {object} an object describing how to continue processing
 */
function handleMediaError (
  err,
  { action, method, endpoint, userId, gcsMediaIds }
) {
  const { response } = err
  if (response) {
    const status = response.statusCode
    const body = response.body

    const log = logger.child({
      userId,
      gcsMediaIds,
      err,
      endpoint: 'media.getTwitterMediaIds',
      response
    })

    if (status === httpErrorCodes.RATE_LIMIT) {
      log.warn(`Media service rate limit error received: ${err.message}`)

      return setRateLimit({
        action,
        headers: response.headers,
        method,
        endpoint,
        userId
      })
    }

    if (status === httpErrorCodes.FORBIDDEN && dailyLimitReached(body)) {
      log.warn(
        `Media service daily limit reached error received: ${err.message}`
      )

      return {
        action,
        delay: TWITTER_DAILY_LIMIT_DELAY
      }
    }
  }

  if (utils.isConnectionError(err)) {
    logger.warn(
      {
        err,
        action: utils.sanitizeAction(action, ['token', 'secret'])
      },
      `Error connecting to media service: ${err.message}`
    )
    return {
      retry: true,
      retryRemaining: 1000, // this is to not have the logs print "retry: NAN", and not to clash with the call endpoint retry counting
      error: err.message
    }
  }

  if (utils.isMediaUploadingError(err)) {
    logger.debug(
      {
        err,
        action: utils.sanitizeAction(action, ['token', 'secret'])
      },
      `Error obtaining media: ${err.message}`
    )
    return {
      retry: true,
      retryRemaining: 1000, // this is to not have the logs print "retry: NAN", and not to clash with the call endpoint retry counting
      error: err.message
    }
  }

  throw new Error('Error obtaining media: ' + err.message)
}

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

const createTweetContentHash = tweetContent =>
  crypto.createHash('sha256').update(JSON.stringify(tweetContent)).digest('hex')

const checkDuplicateTweet = (potentialDuplicates, tweetContentHash) =>
  potentialDuplicates.some(
    tweetObject => tweetObject.tweetContentHash === tweetContentHash
  )

/**
 * Call Twitter to send a Tweet.
 *
 * @param {SendTweetAction} action Send Tweet action
 * @param {boolean} nullcast Is this a Dark Tweet?
 * @param {boolean} isReply Is this a reply to another Tweet?
 * @returns {Promise} Resolves when Tweet send completes
 */
async function sendTweet (action, nullcast, isReply = false) {
  logger.debug(
    {
      action: R.omit(['token', 'secret'], action),
      nullcast,
      isReply
    },
    'Executing sendTweet function...'
  )

  const {
    widgetId,
    token,
    secret,
    text,
    media: gcsMediaIds,
    userId, // the brands Twitter ID
    statusId,
    attachmentUrl,
    cardUri,
    recipientId,
    recipientHandle,
    ownerHandle
  } = action

  const method = 'POST'
  const endpoint = 'tweets'
  const actionHasNoGcsMedia = R.pipe(R.prop('media'), R.or(R.isNil, R.isEmpty))

  let twitterMediaIds
  try {
    twitterMediaIds = actionHasNoGcsMedia(action)
      ? []
      : await media.getTwitterMediaIds({
          gcsMediaIds,
          userId,
          destination: 'tweet'
        })
  } catch (err) {
    return handleMediaError(err, {
      action,
      method,
      endpoint,
      userId,
      gcsMediaIds
    })
  }

  const randomResponseMediaIds = R.propOr([], 'tweetMediaIds')(action)
  const responseHash = R.propOr(null, 'hashedResponse')(action)
  twitterMediaIds = R.concat(twitterMediaIds, randomResponseMediaIds)

  const twitter = Twitter.createTwitterClient({
    consumerKey: process.env.TWITTER_CONSUMER_KEY,
    consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
    accessToken: token,
    accessSecret: secret
  })

  const getMedia = () =>
    twitterMediaIds && twitterMediaIds.length > 0
      ? { media_ids: twitterMediaIds }
      : undefined

  const getQuoteTweetId = () =>
    attachmentUrl ? R.pipe(R.split('/'), R.last)(attachmentUrl) : undefined

  const getCardUri = () =>
    cardUri ? R.pipe(R.split('/'), R.last)(cardUri) : undefined

  // we are replying from Brand's account
  // we don't want to mention the Brand in the reply
  const getReply = () =>
    isReply && statusId
      ? {
          in_reply_to_tweet_id: statusId,
          exclude_reply_user_ids: [userId]
        }
      : undefined

  const tweetToSend = removeUndefinedValues({
    text,
    media: getMedia(),
    nullcast,
    quote_tweet_id: getQuoteTweetId(),
    card_uri: getCardUri(),
    reply: getReply()
  })

  const tweetContentHash = createTweetContentHash({
    widgetId,
    text,
    media,
    userId
  })

  try {
    const [potentialDuplicates] = await db.getTweetDuplicates(
      widgetId,
      recipientHandle
    )
    const isDuplicate = checkDuplicateTweet(
      potentialDuplicates,
      tweetContentHash
    )

    if (isDuplicate) {
      logger.warn(
        `Skipping duplicate tweet, widgetID: ${widgetId} for handle: ${recipientHandle}`
      )
      return { status: httpErrorCodes.OK }
    }

    const response = await twitter.post({ endpoint, body: tweetToSend })
    const tweet = response.data

    const { id: tweetId } = tweet
    const createdAt = Date.now()

    db.storeTweet({
      widgetId,
      tweetId,
      senderId: userId,
      senderHandle: ownerHandle,
      mentionedUserId: recipientId,
      mentionedHandle: recipientHandle,
      createdAt,
      tweet,
      responseHash,
      tweetContentHash
    }).catch(err => {
      logger.warn(
        {
          err,
          tweet,
          action: R.omit(['token', 'secret'], action),
          nullcast,
          isReply
        },
        `Error storing Tweet: ${err.message}`
      )
    })

    if (action.isRandomResponse) {
      await db.updatePoolRecipients({
        poolId: action.randomResponsePoolId,
        mentionedUserId: recipientId
      })
    }

    if (action.isMosaicConsent) {
      await db.addParticipant({
        widgetId,
        userId: recipientId,
        handle: recipientHandle,
        responseType: 'SEND_DARK_TWEET',
        optinId: tweetId,
        consentResponseTweetId: tweetId,
        status: 'pending_explicit_consent'
      })
    }

    return {
      tweetId,
      replyId: isReply ? tweet.in_reply_to_status_id_str : undefined
    }
  } catch (error) {
    return handleTwitterError(error, {
      action,
      method,
      endpoint,
      params: tweetToSend
    })
  }
}

/**
 * @typedef SendDmAction
 * @property {string} widgetId Widget ID
 * @property {string} token Twitter access token
 * @property {string} secret Twitter access secret
 * @property {string} text Tweet body
 * @property {string[]} media GCS Media IDs
 * @property {string} recipientId Direct message recipient ID
 * @property {string} userId Twitter user ID
 */

/**
 * Call Twitter to send a direct message
 *
 * @param {SendDmAction} action Send DM action
 * @returns {Promise} Resolves when DM send completes
 */
async function sendDm (action) {
  const {
    token,
    secret,
    text,
    media: actionMedia,
    recipientId,
    userId
  } = action

  const gcsMediaId = getDmMedia(actionMedia)

  const twitter = Twitter.createTwitterClient({
    consumerKey: process.env.TWITTER_CONSUMER_KEY,
    consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
    accessToken: token,
    accessSecret: secret
  })

  const method = 'POST'
  const endpoint = `dm_conversations/with/${recipientId}/messages`

  const dmToSend = { text }

  if (gcsMediaId) {
    try {
      const twitterMediaId = await media.getTwitterMediaId({
        gcsMediaId,
        userId,
        destination: 'dm'
      })

      dmToSend.attachments = [{ media_id: twitterMediaId }]
    } catch (err) {
      return handleMediaError(err, {
        action,
        method,
        endpoint,
        userId,
        gcsMediaIds: [gcsMediaId]
      })
    }
  }

  try {
    const response = await twitter.post({ endpoint, body: dmToSend })

    return { body: response.body }
  } catch (e) {
    return handleTwitterError(e, {
      action,
      method,
      endpoint,
      params: dmToSend
    })
  }
}

/**
 * Call Twitter to send reply.
 *
 * @param {SendTweetAction} action Send Tweet action
 * @param {boolean} nullcast Is this a Dark Tweet?
 * @returns {Promise} Resolves when Tweet send completes
 */
function sendReply (action, nullcast) {
  return sendTweet(action, nullcast, true)
}

/**
 * Call Twitter to send Dark Tweet.
 *
 * @param {SendTweetAction} action Send Tweet action
 * @returns {Promise} Resolves when Tweet send completes
 */
function sendDarkTweet (action) {
  return sendTweet(action, true)
}

/**
 * Call Twitter to send Dark Reply.
 *
 * @param {SendTweetAction} action Send Tweet action
 * @returns {Promise} Resolves when Tweet send completes
 */
function sendDarkReply (action) {
  return sendReply(action, true)
}

/**
 * @typedef TwitterAccessTokens
 * @property {string} token Twitter access token
 * @property {string} secret Twitter access secret
 */

/**
 * @typedef DeleteTweetAction
 * @property {string} token Twitter access token
 * @property {string} secret Twitter access secret
 * @property {string} tweetId ID of the Tweet to delete
 * @property {string} userId ID of the user to delete the Tweet as
 * @property {number} retryRemaining Number of retries remaining
 */

/**
 * Call Twitter's /statuses/destroy endpoint to delete a tweet
 *
 * @param {DeleteTweetAction} action Configuration options
 * @returns {Promise} Resolves when Tweet deleted
 */
async function deleteTweet (action) {
  const { token, secret, tweetId } = action

  const twitter = Twitter.createTwitterClient({
    consumerKey: process.env.TWITTER_CONSUMER_KEY,
    consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
    accessToken: token,
    accessSecret: secret
  })

  const endpoint = `tweets/${tweetId}`

  try {
    await twitter.delete({ endpoint })

    return { tweetId }
  } catch (e) {
    return handleTwitterError(e, {
      action,
      method: 'DELETE',
      endpoint,
      params: { id: tweetId }
    })
  }
}

module.exports = {
  sendTweet,
  sendDm,
  sendReply,
  sendDarkReply,
  sendDarkTweet,
  deleteTweet
}
