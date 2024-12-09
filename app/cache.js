const { logger } = require('@bluerobot/monitoring')
const { equals, always, cond, T, isNil, isEmpty } = require('ramda')

const endpoints = require('./endpoints')

const FACEBOOK_SUBSCRIPTION_URL = process.env.FACEBOOK_SUBSCRIPTION_URL
const INSTAGRAM_SUBSCRIPTION_URL = process.env.INSTAGRAM_SUBSCRIPTION_URL

/**
 * Caches Meta API request
 *
 * @param {string} metaPlatform Meta API platform
 * @param {string} widgetId ID of the related widget
 * @param {object} metaRequestBody Meta API request body
 * @param {object} metaResponseCode Meta API response status code
 * @param {object} metaResponseBody Meta API response body
 */
async function cacheMetaRequest (
  metaPlatform,
  widgetId,
  metaRequestBody,
  metaResponseCode,
  metaResponseBody
) {
  if (isNil(widgetId) || isEmpty(widgetId)) {
    logger.warn(
      { metaPlatform, metaRequestBody, metaResponseCode, metaResponseBody },
      'Failed to cache Meta API request: missing widgetId'
    )
    return
  }
  const acceptedPlatforms = ['facebook', 'instagram']
  if (!acceptedPlatforms.includes(metaPlatform)) {
    logger.warn({ metaPlatform }, 'Invalid Meta API platform')
    return
  }

  logger.debug(
    {
      metaPlatform,
      widgetId,
      metaRequestBody,
      metaResponseCode,
      metaResponseBody
    },
    'Received Meta API request for caching...'
  )
  const cacheUrl = cond([
    [equals('facebook'), always(FACEBOOK_SUBSCRIPTION_URL)],
    [equals('instagram'), always(INSTAGRAM_SUBSCRIPTION_URL)]
  ])(metaPlatform)

  const body = cond([
    [
      equals('facebook'),
      always({
        payload: metaRequestBody,
        facebookResponseCode: metaResponseCode,
        facebookResponseBody: metaResponseBody
      })
    ],
    [
      T,
      always({
        payload: metaRequestBody,
        metaResponseCode,
        metaResponseBody
      })
    ]
  ])(metaPlatform)

  const options = {
    method: 'POST',
    url: `${cacheUrl}/cache/request/${widgetId}`,
    body
  }

  logger.debug({ options, metaPlatform }, 'Calling cache endpoint...')

  try {
    await endpoints.callEndpoint(options)
    logger.debug(
      {
        widgetId
      },
      `Successfully cached Meta API request`
    )
  } catch (error) {
    logger.warn(`Failed to cache Meta API request: ${error}`)
  }
}

/**
 * Calls endpoint for caching the direct message request sent to Facebook
 *
 * @param {string} metaPlatform Meta API platform
 * @param {object} message message object
 * @param {string} widgetId unique widget id
 * @param {string} blastId unique blast id that this message belongs to
 * @param {string} participantId facebook participant ID in database
 * @param {number} metaResponseCode response code from Meta API call
 * @param {object} metaResponseBody response from Meta API call
 * @param {boolean=} deleteParticipant flag to delete the participant from database
 */
async function cacheMetaBlastMessage (
  metaPlatform,
  message,
  widgetId,
  blastId,
  participantId,
  metaResponseCode,
  metaResponseBody,
  deleteParticipant = false
) {
  const acceptedPlatforms = ['facebook']
  if (!acceptedPlatforms.includes(metaPlatform)) {
    logger.warn(
      { metaPlatform },
      `Blast caching not supported for platform ${metaPlatform}`
    )
    return
  }

  const baseUrl = cond([
    [equals('facebook'), always(FACEBOOK_SUBSCRIPTION_URL)],
    [equals('instagram'), always(INSTAGRAM_SUBSCRIPTION_URL)]
  ])(metaPlatform)
  const cacheMessageRequestOptions = {
    method: 'POST',
    url: `${baseUrl}/cache/blast/${widgetId}`,
    body: {
      blastId,
      message,
      participantId,
      deleteParticipant,
      facebookResponseCode: metaResponseCode,
      facebookResponseBody: metaResponseBody
    }
  }
  try {
    logger.debug(
      { ...cacheMessageRequestOptions },
      `Caching ${metaPlatform} Blast message request...`
    )
    await endpoints.callEndpoint(cacheMessageRequestOptions)
    logger.debug('Successfully cached Facebook Blast message request')
  } catch (error) {
    logger.warn(`Error caching Facebook Blast message request: ${error}`)
  }
}

module.exports = {
  cacheMetaRequest,
  cacheMetaBlastMessage
}
