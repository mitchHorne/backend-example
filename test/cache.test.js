const { expect } = require('chai')
const simple = require('simple-mock')
const { logger } = require('@bluerobot/monitoring')

const endpoints = require('../app/endpoints')
const { cacheMetaRequest, cacheMetaBlastMessage } = require('../app/cache')

describe('cache', () => {
  beforeEach(() => {
    simple.mock(endpoints, 'callEndpoint').resolveWith()
    simple.mock(logger, 'debug')
    simple.mock(logger, 'warn')
  })

  afterEach(() => {
    simple.restore()
  })
  describe('cacheMetaRequest', () => {
    it('should cache Meta API request (facebook)', async () => {
      const cacheUrl = (process.env.FACEBOOK_SUBSCRIPTION_URL =
        'http://subscriptions')

      const metaPlatform = 'facebook'
      const widgetId = 'widgetId'
      const metaRequestBody = {}
      const metaResponseCode = 'metaResponseCode'
      const metaResponseBody = 'metaResponseBody'
      const options = {
        method: 'POST',
        url: `${cacheUrl}/cache/request/${widgetId}`,
        body: {
          payload: metaRequestBody,
          facebookResponseCode: metaResponseCode,
          facebookResponseBody: metaResponseBody
        }
      }

      await cacheMetaRequest(
        metaPlatform,
        widgetId,
        metaRequestBody,
        metaResponseCode,
        metaResponseBody
      )

      expect(endpoints.callEndpoint.callCount).to.equal(1)
      expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([options])
    })

    it('should cache Meta API request (instagram)', async () => {
      const cacheUrl = (process.env.INSTAGRAM_SUBSCRIPTION_URL =
        'http://subscriptions')

      const metaPlatform = 'instagram'
      const widgetId = 'widgetId'
      const metaRequestBody = {}
      const metaResponseCode = 'metaResponseCode'
      const metaResponseBody = 'metaResponseBody'
      const options = {
        method: 'POST',
        url: `${cacheUrl}/cache/request/${widgetId}`,
        body: {
          payload: metaRequestBody,
          metaResponseCode,
          metaResponseBody
        }
      }

      await cacheMetaRequest(
        metaPlatform,
        widgetId,
        metaRequestBody,
        metaResponseCode,
        metaResponseBody
      )

      expect(endpoints.callEndpoint.callCount).to.equal(1)
      expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([options])
    })

    it('should log a warning if widgetId is missing', async () => {
      const metaPlatform = 'facebook'
      const widgetId = undefined
      const metaRequestBody = {}
      const metaResponseCode = 'metaResponseCode'
      const metaResponseBody = 'metaResponseBody'

      await cacheMetaRequest(
        metaPlatform,
        widgetId,
        metaRequestBody,
        metaResponseCode,
        metaResponseBody
      )

      expect(endpoints.callEndpoint.callCount).to.equal(0)
      expect(logger.warn.callCount).to.equal(1)
      expect(logger.warn.lastCall.args).to.deep.equal([
        { metaPlatform, metaRequestBody, metaResponseCode, metaResponseBody },
        'Failed to cache Meta API request: missing widgetId'
      ])
    })

    it('should not cache Meta API request (invalid platform)', async () => {
      const metaPlatform = 'invalidPlatform'
      const widgetId = 'widgetId'
      const metaRequestBody = {}
      const metaResponseCode = 'metaResponseCode'
      const metaResponseBody = 'metaResponseBody'

      await cacheMetaRequest(
        metaPlatform,
        widgetId,
        metaRequestBody,
        metaResponseCode,
        metaResponseBody
      )

      expect(endpoints.callEndpoint.callCount).to.equal(0)
      expect(logger.warn.callCount).to.equal(1)
      expect(logger.warn.lastCall.args).to.deep.equal([
        { metaPlatform },
        'Invalid Meta API platform'
      ])
    })

    it('should catch and log a warning if cache API request fails', async () => {
      const cacheUrl = (process.env.FACEBOOK_SUBSCRIPTION_URL =
        'http://subscriptions')

      const error = new Error('cache API request failed')
      simple.mock(endpoints, 'callEndpoint').throwWith(error)

      const metaPlatform = 'facebook'
      const widgetId = 'widgetId'
      const metaRequestBody = {}
      const metaResponseCode = 'metaResponseCode'
      const metaResponseBody = 'metaResponseBody'
      const options = {
        method: 'POST',
        url: `${cacheUrl}/cache/request/${widgetId}`,
        body: {
          payload: metaRequestBody,
          facebookResponseCode: metaResponseCode,
          facebookResponseBody: metaResponseBody
        }
      }

      endpoints.callEndpoint.throwWith(error)

      await cacheMetaRequest(
        metaPlatform,
        widgetId,
        metaRequestBody,
        metaResponseCode,
        metaResponseBody
      )

      expect(endpoints.callEndpoint.callCount).to.equal(1)
      expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([options])
      expect(logger.warn.callCount).to.equal(1)
      expect(logger.warn.lastCall.args).to.deep.equal([
        `Failed to cache Meta API request: ${error}`
      ])
    })
  })

  describe('cacheMetaBlastMessage', () => {
    it('should cache Meta API blast message (facebook)', async () => {
      const cacheUrl = (process.env.FACEBOOK_SUBSCRIPTION_URL =
        'http://subscriptions')

      const metaPlatform = 'facebook'
      const widgetId = 'widgetId'
      const blastId = 'unique-blast-id'
      const metaResponseCode = 'metaResponseCode'
      const metaResponseBody = {
        message_id: 'unique-fb-message-id'
      }
      const participantId = 'participantId'
      const messageObject = {
        message: {
          recipient: {
            comment_id: 'unique-fb-comment-id'
          },
          message: {
            text: 'Hello user!'
          },
          messaging_type: 'RESPONSE'
        }
      }

      const options = {
        method: 'POST',
        url: `${cacheUrl}/cache/blast/${widgetId}`,
        body: {
          blastId,
          deleteParticipant: false,
          facebookResponseBody: metaResponseBody,
          facebookResponseCode: metaResponseCode,
          message: messageObject,
          participantId
        }
      }

      await cacheMetaBlastMessage(
        metaPlatform,
        messageObject,
        widgetId,
        blastId,
        participantId,
        metaResponseCode,
        metaResponseBody
      )

      expect(endpoints.callEndpoint.callCount).to.equal(1)
      expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([options])
    })

    it('should not cache Meta API blast message (invalid platform)', async () => {
      const metaPlatform = 'invalidPlatform'
      const widgetId = 'widgetId'
      const metaResponseCode = 'metaResponseCode'
      const metaResponseBody = {
        message_id: 'unique-fb-message-id'
      }
      const participantId = 'participantId'
      const messageObject = {
        message: {
          recipient: {
            comment_id: 'unique-fb-comment-id'
          },
          message: {
            text: 'Hello user!'
          },
          messaging_type: 'RESPONSE'
        }
      }

      await cacheMetaBlastMessage(
        metaPlatform,
        messageObject,
        widgetId,
        participantId,
        metaResponseCode,
        metaResponseBody
      )

      expect(endpoints.callEndpoint.callCount).to.equal(0)
      expect(logger.warn.callCount).to.equal(1)
      expect(logger.warn.lastCall.args).to.deep.equal([
        { metaPlatform },
        `Blast caching not supported for platform ${metaPlatform}`
      ])
    })

    it('should catch and log a warning if blast cache API request fails', async () => {
      const cacheUrl = (process.env.FACEBOOK_SUBSCRIPTION_URL =
        'http://subscriptions')

      const error = new Error('cache API request failed')
      simple.mock(endpoints, 'callEndpoint').throwWith(error)

      const metaPlatform = 'facebook'
      const widgetId = 'widgetId'
      const blastId = 'unique-blast-id'
      const metaResponseCode = 'metaResponseCode'
      const metaResponseBody = {
        message_id: 'unique-fb-message-id'
      }
      const participantId = 'participantId'
      const messageObject = {
        message: {
          recipient: {
            comment_id: 'unique-fb-comment-id'
          },
          message: {
            text: 'Hello user!'
          },
          messaging_type: 'RESPONSE'
        }
      }

      const options = {
        method: 'POST',
        url: `${cacheUrl}/cache/blast/${widgetId}`,
        body: {
          blastId,
          deleteParticipant: false,
          facebookResponseBody: metaResponseBody,
          facebookResponseCode: metaResponseCode,
          message: messageObject,
          participantId
        }
      }

      endpoints.callEndpoint.throwWith(error)

      await cacheMetaBlastMessage(
        metaPlatform,
        messageObject,
        widgetId,
        blastId,
        participantId,
        metaResponseCode,
        metaResponseBody
      )

      expect(endpoints.callEndpoint.callCount).to.equal(1)
      expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([options])
      expect(logger.warn.callCount).to.equal(1)
      expect(logger.warn.lastCall.args).to.deep.equal([
        `Error caching Facebook Blast message request: ${error}`
      ])
    })
  })
})
