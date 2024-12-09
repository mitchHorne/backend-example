/* eslint-disable no-template-curly-in-string */
const R = require('ramda')
const endpoints = require('./endpoints')
const utils = require('./utils')
const db = require('./db')
const cache = require('./cache')
const { logger } = require('@bluerobot/monitoring')
const crypt = require('@bluerobot/crypt-keeper')
const { handleMetaApiResponse } = require('./errors/facebook-errors')
const request = require('@bluerobot/request')
const universalBaseVideo =
  'https://res.cloudinary.com/dzres3un2/video/upload/so_8.8,eo_9.35,co_rgb:FFFFFFBF,w_1080,h_1080,c_fill,g_center,x_0,y_0,a_0,l_${cloudImageId}/so_9.35,eo_9.45,co_rgb:FFFFFFBF,w_1059,h_1059,c_fill,g_center,x_3,y_-9,a_0,l_${cloudImageId}/so_9.45,eo_9.55,co_rgb:FFFFFFBF,w_1038,h_1038,c_fill,g_center,x_6,y_-18,a_0,l_${cloudImageId}/so_9.55,eo_9.65,co_rgb:FFFFFFBF,w_1017,h_1017,c_fill,g_center,x_9,y_-28,a_0,l_${cloudImageId}/so_9.65,eo_9.75,co_rgb:FFFFFFBF,w_996,h_996,c_fill,g_center,x_12,y_-37,a_0,l_${cloudImageId}/so_9.7,eo_9.85,co_rgb:FFFFFFBF,w_975,h_975,c_fill,g_center,x_15,y_-47,a_0,l_${cloudImageId}/so_9.85,eo_9.95,co_rgb:FFFFFFBF,w_954,h_954,c_fill,g_center,x_19,y_-56,a_0,l_${cloudImageId}/so_9.95,eo_10.05,co_rgb:FFFFFFBF,w_933,h_933,c_fill,g_center,x_22,y_-66,a_0,l_${cloudImageId}/so_10.05,eo_10.15,co_rgb:FFFFFFBF,w_912,h_912,c_fill,g_center,x_25,y_-75,a_0,l_${cloudImageId}/so_10.15,eo_10.25,co_rgb:FFFFFFBF,w_891,h_891,c_fill,g_center,x_28,y_-85,a_0,l_${cloudImageId}/so_10.25,eo_10.35,co_rgb:FFFFFFBF,w_870,h_870,c_fill,g_center,x_31,y_-94,a_0,l_${cloudImageId}/so_10.35,eo_10.45,co_rgb:FFFFFFBF,w_849,h_849,c_fill,g_center,x_35,y_-104,a_0,l_${cloudImageId}/so_10.45,eo_10.55,co_rgb:FFFFFFBF,w_828,h_828,c_fill,g_center,x_38,y_-113,a_0,l_${cloudImageId}/so_10.55,eo_10.65,co_rgb:FFFFFFBF,w_807,h_807,c_fill,g_center,x_41,y_-123,a_0,l_${cloudImageId}/so_10.65,eo_10.75,co_rgb:FFFFFFBF,w_786,h_786,c_fill,g_center,x_44,y_-132,a_0,l_${cloudImageId}/so_10.75,eo_10.85,co_rgb:FFFFFFBF,w_765,h_765,c_fill,g_center,x_47,y_-142,a_0,l_${cloudImageId}/so_10.85,eo_10.95,co_rgb:FFFFFFBF,w_744,h_744,c_fill,g_center,x_51,y_-151,a_0,l_${cloudImageId}/so_10.95,eo_11.05,co_rgb:FFFFFFBF,w_723,h_723,c_fill,g_center,x_54,y_-160,a_0,l_${cloudImageId}/so_11.05,eo_11.15,co_rgb:FFFFFFBF,w_702,h_702,c_fill,g_center,x_57,y_-170,a_0,l_${cloudImageId}/so_11.15,eo_11.25,co_rgb:FFFFFFBF,w_681,h_681,c_fill,g_center,x_60,y_-179,a_0,l_${cloudImageId}/so_11.25,eo_11.35,co_rgb:FFFFFFBF,w_660,h_660,c_fill,g_center,x_63,y_-189,a_0,l_${cloudImageId}/so_11.35,eo_11.45,co_rgb:FFFFFFBF,w_639,h_639,c_fill,g_center,x_67,y_-198,a_0,l_${cloudImageId}/so_11.45,eo_11.55,co_rgb:FFFFFFBF,w_618,h_618,c_fill,g_center,x_70,y_-208,a_0,l_${cloudImageId}/so_11.55,eo_11.65,co_rgb:FFFFFFBF,w_597,h_597,c_fill,g_center,x_73,y_-217,a_0,l_${cloudImageId}/so_11.65,eo_11.75,co_rgb:FFFFFFBF,w_576,h_576,c_fill,g_center,x_76,y_-227,a_0,l_${cloudImageId}/so_11.75,eo_11.85,co_rgb:FFFFFFBF,w_555,h_555,c_fill,g_center,x_79,y_-236,a_0,l_${cloudImageId}/so_11.65,eo_11.95,co_rgb:FFFFFFBF,w_534,h_534,c_fill,g_center,x_82,y_-246,a_0,l_${cloudImageId}/so_11.85,eo_12.05,co_rgb:FFFFFFBF,w_513,h_513,c_fill,g_center,x_86,y_-255,a_0,l_${cloudImageId}/so_12.05,eo_12.15,co_rgb:FFFFFFBF,w_492,h_492,c_fill,g_center,x_89,y_-265,a_0,l_${cloudImageId}/so_12.15,eo_12.25,co_rgb:FFFFFFBF,w_471,h_471,c_fill,g_center,x_92,y_-274,a_0,l_${cloudImageId}/so_12.25,eo_12.35,co_rgb:FFFFFFBF,w_450,h_450,c_fill,g_center,x_95,y_-284,a_0,l_${cloudImageId}/so_12.35,eo_12.45,co_rgb:FFFFFFBF,w_429,h_429,c_fill,g_center,x_98,y_-293,a_0,l_${cloudImageId}/so_12.45,eo_12.55,co_rgb:FFFFFFBF,w_408,h_408,c_fill,g_center,x_102,y_-302,a_0,l_${cloudImageId}/so_12.55,eo_12.65,co_rgb:FFFFFFBF,w_387,h_387,c_fill,g_center,x_105,y_-312,a_0,l_${cloudImageId}/so_12.65,eo_12.75,co_rgb:FFFFFFBF,w_366,h_366,c_fill,g_center,x_108,y_-321,a_0,l_${cloudImageId}/so_12.75,eo_12.85,co_rgb:FFFFFFBF,w_345,h_345,c_fill,g_center,x_111,y_-331,a_0,l_${cloudImageId}/so_12.85,eo_12.95,co_rgb:FFFFFFBF,w_324,h_324,c_fill,g_center,x_114,y_-340,a_0,l_${cloudImageId}/so_12.95,eo_13.05,co_rgb:FFFFFFBF,w_303,h_303,c_fill,g_center,x_118,y_-350,a_0,l_${cloudImageId}/so_13.05,eo_13.15,co_rgb:FFFFFFBF,w_282,h_282,c_fill,g_center,x_121,y_-359,a_0,l_${cloudImageId}/so_13.15,eo_13.25,co_rgb:FFFFFFBF,w_261,h_261,c_fill,g_center,x_124,y_-369,a_0,l_${cloudImageId}/so_13.25,eo_13.35,co_rgb:FFFFFFBF,w_240,h_240,c_fill,g_center,x_127,y_-378,a_0,l_${cloudImageId}/so_13.35,eo_13.45,co_rgb:FFFFFFBF,w_219,h_219,c_fill,g_center,x_130,y_-388,a_0,l_${cloudImageId}/so_13.45,eo_13.55,co_rgb:FFFFFFBF,w_198,h_198,c_fill,g_center,x_134,y_-397,a_0,l_${cloudImageId}/so_13.55,eo_13.65,co_rgb:FFFFFFBF,w_177,h_177,c_fill,g_center,x_137,y_-407,a_0,l_${cloudImageId}/so_13.65,eo_13.75,co_rgb:FFFFFFBF,w_156,h_156,c_fill,g_center,x_140,y_-416,a_0,l_${cloudImageId}/so_13.75,eo_13.85,co_rgb:FFFFFFBF,w_135,h_135,c_fill,g_center,x_143,y_-426,a_0,l_${cloudImageId}/so_13.85,eo_13.95,co_rgb:FFFFFFBF,w_114,h_114,c_fill,g_center,x_146,y_-435,a_0,l_${cloudImageId}/v1720608647/U2_Full_Video_Zoom_Out_Timings_Extended_1_voksfh.mp4'

const FACEBOOK_API_URL = process.env.FACEBOOK_API_URL
const facebookDelayStatuses = utils.getFbDelayStatuses()

const defaultFacebookActionLimit = R.defaultTo(
  process.env.FACEBOOK_ACTION_RETRY_LIMIT || 100
)

const DEFAULT_FACEBOOK_DELAY = 60 * 60 * 1000 // 1 hour

/**
 *
 * @param {object} action action from amqp
 * @returns {Promise<object>} response after calling send message endpoint on Facebook
 */
async function sendFacebookMessage (action) {
  const isConsentMessage = R.pathEq(
    ['message', 'message', 'attachment', 'payload', 'template_type'],
    'notification_messages'
  )(action)

  if (isConsentMessage) {
    const { widgetId, participantId } = action
    if (await checkOptedIn(widgetId, participantId)) {
      logger.debug({ action }, 'User already opted in')
      return {
        status: 409,
        body: 'User already opted in'
      }
    }
  }
  const { userId } = action

  const dbOptions = {
    userId: userId,
    platform: 'FACEBOOK',
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

  const retryRemaining = defaultFacebookActionLimit(action.retryRemaining)

  const pageAccessToken = await R.pipe(
    db.getMetaPageAccessToken,
    R.andThen(
      R.pipe(R.head, R.head, R.propOr('', 'page_access_token'), crypt.decrypt)
    )
  )(userId)

  const { message, participantId, widgetId } = action

  const requestOptions = {
    method: 'POST',
    url: `${FACEBOOK_API_URL}/me/messages?access_token=${pageAccessToken}`,
    body: message,
    retryStatuses: facebookDelayStatuses.join(','),
    retryRemaining,
    responseType: 'json'
  }

  const response = await R.tryCatch(
    reqOptions => endpoints.callEndpoint(reqOptions),
    error => {
      return handleMetaApiResponse(error, action)
    }
  )(requestOptions)

  const { metaResponseBody: errResBody } = response
  const { body: resBody } = response
  logger.debug({ response }, 'Facebook message success response')

  if (!errResBody && resBody) {
    const response = JSON.parse(resBody)
    await db.cacheMetaMessageResponse(
      response.message_id,
      response.recipient_id,
      widgetId,
      'facebook'
    )
  }

  const redactedTokenParams = {
    ...requestOptions,
    searchParams: {
      ...requestOptions.searchParams,
      access_token: crypt.encrypt(pageAccessToken)
    }
  }

  const isOneTimeNotification = R.hasPath([
    'message',
    'recipient',
    'one_time_notif_token'
  ])(action)

  const isRecurringNotification = R.hasPath([
    'message',
    'recipient',
    'notification_messages_token'
  ])(action)

  if (isOneTimeNotification || isRecurringNotification) {
    const deleteParticipant =
      !!isOneTimeNotification || !!response.deleteParticipant
    const metaResponseCode = R.propOr(0, 'status')(response)
    const metaResponseBody = R.propOr({}, 'body')(response)

    const blastId = R.pathOr(null, ['blastId'], action)
    cache.cacheMetaBlastMessage(
      'facebook',
      message,
      widgetId,
      blastId,
      participantId,
      metaResponseCode,
      metaResponseBody,
      deleteParticipant
    )
  } else {
    cache.cacheMetaRequest(
      'facebook',
      widgetId,
      redactedTokenParams,
      response.metaResponseCode,
      response.metaResponseBody
    )
  }

  if (response.error && !response.isHandled) {
    // istanbul ignore next
    throw response.error.name === 'HTTPError'
      ? { ...response.error, response: response.error.response }
      : response
  } else {
    // Note: this is either a success or a handled error (see handleMetaApiResponse for details on handled errors)
    return response
  }
}

/**
 * @param {object} action action from amqp
 * @returns {Promise<object>} response after calling send comment endpoint on Facebook
 */
async function sendFacebookComment (action) {
  const dbOptions = {
    userId: action.userId,
    platform: 'FACEBOOK',
    method: 'POST',
    endpoint: 'comments'
  }

  const { commentId } = action

  const result = await db.getUserRateLimit(dbOptions)

  if (result > 0) {
    return utils.delayAction({
      action,
      limitResetAt: result
    })
  }

  const { message, objectId, widgetId = '' } = action
  const retryRemaining = defaultFacebookActionLimit(action.retryRemaining)
  const pageAccessToken = await R.pipe(
    db.getMetaPageAccessToken,
    R.andThen(
      R.pipe(R.head, R.head, R.propOr('', 'page_access_token'), crypt.decrypt)
    )
  )(action.userId)

  const requestOptions = {
    method: 'POST',
    url: `${FACEBOOK_API_URL}/${objectId}/comments?access_token=${pageAccessToken}`,
    body: message,
    retryStatuses: facebookDelayStatuses.join(','),
    retryRemaining
  }

  const response = await endpoints.callEndpoint(requestOptions)
  logger.debug({ response }, 'Facebook comment reply success response')

  const isRateLimited = facebookDelayStatuses.includes(
    R.path(['body', 'error', 'code'], response)
  )

  if (isRateLimited) {
    return setRateLimit(response, action, 'comments')
  }

  const metaResponseCode = R.propOr(0, 'status')(response)
  const metaResponseBody = R.propOr({}, 'body')(response)
  const redactedTokenUrl = R.replace(
    `${pageAccessToken}`,
    crypt.encrypt(pageAccessToken),
    R.path(['url'], requestOptions)
  )

  if (metaResponseCode === 200) {
    const fbResponse = JSON.parse(metaResponseBody)
    await db.cacheMetaCommentResponse(
      fbResponse.message_id,
      fbResponse.recipient_id,
      commentId,
      widgetId,
      'facebook'
    )
  }

  cache.cacheMetaRequest(
    'facebook',
    widgetId,
    { ...requestOptions, url: redactedTokenUrl },
    metaResponseCode,
    metaResponseBody
  )

  return response
}

/**
 * Checks if the Facebook user is opted in to the widget.
 *
 * @param {string} widgetId - Widget ID
 * @param {string} userpsid - User psid
 * @returns {Promise} Resolves with true if the user is opted in, false otherwise
 */
async function checkOptedIn (widgetId, userpsid) {
  const [participants] = await db.getFbParticipants(widgetId, userpsid)
  return participants.length > 0
}

/**
 * Call Facebook Subscription service to opt in the Facebook user.
 *
 * @param {object} action  One time opt in action
 * @param {object=} deps Dependencies
 * @param {string=} deps.subscriptionsUrl URL to the facebook subscription service
 * @returns {Promise} Resolves with subscription service response
 */
function fbOptInOneTime (
  action,
  // istanbul ignore next
  {
    subscriptionsUrl = `${process.env.FACEBOOK_SUBSCRIPTION_URL}/participants`
  } = {}
) {
  const { widgetId, userId, userPsid, username, token, responseType } = action

  const body = JSON.stringify({
    userPsid,
    username,
    token,
    responseType
  })

  const options = {
    widgetId,
    userId, // widget owner ID
    method: 'POST',
    url: `${subscriptionsUrl}/${widgetId}`,
    body
  }

  return endpoints.callEndpoint(options)
}

const handleNoContentResponse = response => {
  if (response.status === 204) {
    return {
      status: 204,
      body: 'No Content'
    }
  }

  return response
}

/**
 * Call Facebook Subscription service to opt in the Facebook user.
 *
 * @param {object} action  Opt out action
 * @param {object=} deps Dependencies
 * @param {string=} deps.subscriptionsUrl URL to the facebook subscription service
 * @returns {Promise} Resolves with subscription service response
 */
function fbOptOut (
  action,
  // istanbul ignore next
  {
    subscriptionsUrl = `${process.env.FACEBOOK_SUBSCRIPTION_URL}/participants`
  } = {}
) {
  const { widgetId, userId, userPsid } = action

  const options = {
    widgetId,
    userId, // widget owner ID
    method: 'DELETE',
    url: `${subscriptionsUrl}/${widgetId}/optout/${userPsid}`
  }

  return endpoints.callEndpoint(options).then(handleNoContentResponse)
}

/**
 * Call Facebook Subscription service to opt in the Facebook user.
 *
 * @param {object} action  Recurring opt in action
 * @param {object=} deps Dependencies
 * @param {string=} deps.subscriptionsUrl URL to the facebook subscription service
 * @returns {Promise} Resolves with subscription service response
 */
async function fbOptInRecurring (
  action,
  // istanbul ignore next
  {
    subscriptionsUrl = `${process.env.FACEBOOK_SUBSCRIPTION_URL}/participants`
  } = {}
) {
  const {
    widgetId,
    userId,
    userPsid,
    username,
    token,
    responseType,
    tokenExpiryTimestamp
  } = action

  const body = JSON.stringify({
    userPsid,
    username,
    token,
    responseType,
    tokenExpiryTimestamp
  })

  const options = {
    widgetId,
    userId, // widget owner ID
    method: 'POST',
    url: `${subscriptionsUrl}/${widgetId}`,
    body
  }

  /* WHY DID MICHAEL DO THIS?????!!!!!!!

  After spending close to 16 hours writing an elegant solution to have custom profile pictures in videos and sending them in
  templates as attachments, when testing on the clients account we got the dreaded "This user may have deleted the attachment" error
  which Meta had apparently fixed 6 months ago.  Due to this being a 100k deal, this is the least intrusive way to get this in with 
  the hope of not losing the deal entirely.  This MUST be deleted when this experience ends.
  Please forgive me.

  */
  if (widgetId === '313966a9-a1c7-11ef-94b8-42010a400014') {
    try {
      const pageAccessToken = await R.pipe(
        db.getMetaPageAccessToken,
        R.andThen(
          R.pipe(
            R.head,
            R.head,
            R.propOr('', 'page_access_token'),
            crypt.decrypt
          )
        )
      )(userId)

      const requestOptions = {
        url: `${FACEBOOK_API_URL}/${userPsid}?fields=first_name,last_name,picture.width(480).height(480)&access_token=${pageAccessToken}`,
        responseType: 'json',
        resolveBodyOnly: true
      }

      const response = await request(requestOptions)
      const userProfilePicture = R.pathOr(
        null,
        ['picture', 'data', 'url'],
        response
      )
      if (!userProfilePicture) {
        logger.error(
          { response },
          'Failed to fetch user profile picture from Facebook'
        )
      }

      const imageIdOptions = {
        url: `${process.env.MEDIA_MANIPULATION_URL}/cloudinary/image/upload`,
        method: 'POST',
        json: {
          originalMediaUrl: userProfilePicture,
          publicId: userPsid
        },
        responseType: 'json',
        resolveBodyOnly: true
      }

      const { publicId } = await request(imageIdOptions)
      const customUserVideo = universalBaseVideo.replace(
        /\${cloudImageId}/g,
        publicId
      )

      const sendInstantReminderOptions = {
        url: 'https://graph.facebook.com/v19.0/me/messages',
        method: 'POST',
        searchParams: {
          recipient: JSON.stringify({
            notification_messages_token: token
          }),
          message: JSON.stringify({
            attachment: {
              type: 'video',
              payload: {
                url: customUserVideo,
                is_reusable: true
              }
            }
          }),
          access_token: pageAccessToken
        }
      }

      const sendInstantReminderResponse = await request(
        sendInstantReminderOptions
      )
      logger.info({ sendInstantReminderResponse }, 'Sent instant reminder')
    } catch (e) {
      logger.error({ e }, 'Failed to send instant reminder')
    }
  }
  return endpoints.callEndpoint(options).then(handleNoContentResponse)
}

/**
 * Call the Kraken to release a Facebook Blast 🐙
 *
 * @param {object} action  SEND_FACEBOOK_BLAST action
 * @param {object=} deps Dependencies
 * @param {string=} deps.krakenUrl the Kraken URL
 * @returns {Promise} Resolves with subscription service response
 */
function sendFacebookBlast (
  action,
  // istanbul ignore next
  { krakenUrl = `${process.env.KRAKEN_URL}/release-facebook` } = {}
) {
  const {
    widgetId,
    userId,
    message: { message },
    frequency
  } = action

  const body = JSON.stringify({ message, frequency })
  const options = {
    widgetId,
    userId, // widget owner ID
    method: 'POST',
    url: `${krakenUrl}/${widgetId}`,
    body
  }

  return endpoints.callEndpoint(options)
}

/* helper functions */

/**
 * Calls common set rate limit action from utils to populate database with wait time
 *
 * @param {object} response response containing rate limit codes
 * @param {object} action action which was attempted to process
 * @param {string} endpoint endpoint type
 * @returns {Promise<object>} result of calling set rate limit
 */
function setRateLimit (response, action, endpoint) {
  logger.info(
    { response },
    `Facebook rate limit ${response.status} error received`
  )

  return utils.setRateLimit({
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

module.exports = {
  sendFacebookMessage,
  sendFacebookComment,
  fbOptInOneTime,
  fbOptOut,
  fbOptInRecurring,
  sendFacebookBlast,
  checkOptedIn
}
