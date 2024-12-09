const { assert, expect } = require('chai')
const simple = require('simple-mock')

const { logger } = require('@bluerobot/monitoring')
const instagram = require('../app/instagram')

const utils = require('../app/utils')
const crypt = require('@bluerobot/crypt-keeper')
const endpoints = require('../app/endpoints')
const db = require('../app/db')
const cache = require('../app/cache')

const mockLoggerFunctions = () => {
  simple.mock(logger, 'debug')
  simple.mock(logger, 'info')
  simple.mock(logger, 'warn')
  simple.mock(logger, 'error')
}

describe('instagram', () => {
  beforeEach(() => {
    simple.mock(cache, 'cacheMetaRequest').resolveWith()
  })
  afterEach(() => {
    simple.restore()
  })

  describe('messaging', () => {
    const type = 'SEND_INSTAGRAM_MESSAGE'
    const userId = '1234567890'
    const accessToken = 'some-token-thing'
    const decryptedAccessToken = 'some-decrypted-token-thing'

    /** @type {instagram.InstagramMessagingRecipient} */
    const recipient = {
      id: '1234567890'
    }

    /** @type {instagram.InstagramTextMessage} */
    const instagramTextMessage = {
      text: 'political figure bomb tuesday shhhhhhh'
    }

    /** @type {instagram.InstagramTextMessagePayload} */
    const instagramTextMessagePayload = {
      recipient,
      instagramTextMessage
    }

    const quickReplyOption1Payload = {
      optionSelected: 1
    }

    /** @type {instagram.InstagramQuickReplyOption} */
    const quickReplyOption1 = {
      content_type: 'text',
      payload: quickReplyOption1Payload,
      title: 'Option 1'
    }

    const quickReplyOption2Payload = {
      optionSelected: 1
    }

    /** @type {instagram.InstagramQuickReplyOption} */
    const quickReplyOption2 = {
      content_type: 'text',
      payload: quickReplyOption2Payload,
      title: 'Option 2'
    }

    /** @type {Array<instagram.InstagramQuickReplyOption>} */
    const quickReplyOptions = [quickReplyOption1, quickReplyOption2]

    /** @type {instagram.InstagramQuickReplyMessage} */
    const instagramQuickReplyMessage = {
      text: 'Please select an option',
      quick_replies: quickReplyOptions
    }

    /** @type {instagram.InstagramQuickReplyMessagePayload} */
    const instagramQuickReplyMessagePayload = {
      recipient,
      messaging_type: 'RESPONSE',
      message: instagramQuickReplyMessage
    }

    /** @type {instagram.SendInstagramMessageAction} */
    const validSendInstagramMessageActionText = {
      type,
      accessToken,
      message: instagramTextMessagePayload,
      userId
    }

    /** @type {instagram.SendInstagramMessageAction} */
    const validSendInstagramMessageActionQuickReply = {
      type,
      accessToken,
      message: instagramQuickReplyMessagePayload,
      userId
    }

    /** @type {utils.DelayedAction} */
    const delayedSendInstagramMessageActionText = {
      action: validSendInstagramMessageActionText,
      delay: 12345
    }

    afterEach(() => {
      simple.restore()
    })

    describe('missing fields', () => {
      const SendInstagramMessageActionWithoutUserId = {
        type,
        accessToken,
        message: instagramTextMessagePayload
      }

      const SendInstagramMessageActionWithoutMessagePayload = {
        type,
        accessToken,
        userId
      }

      const actionsMissingFields = [
        ['userId', SendInstagramMessageActionWithoutUserId],
        ['message', SendInstagramMessageActionWithoutMessagePayload]
      ]

      afterEach(() => {
        simple.restore()
      })

      actionsMissingFields.forEach(([fieldName, actionMissingField]) => {
        it(`should throw an error when missing required '${fieldName}' field`, () => {
          assert.isRejected(
            instagram.sendInstagramMessage(actionMissingField, {
              endpoints,
              crypt,
              db
            }),
            `Action is missing required field: '${fieldName}`
          )
        })
      })
    })

    describe('rate limiting', () => {
      beforeEach(mockLoggerFunctions)

      afterEach(() => {
        simple.restore()
      })

      it('should delay action if user is currently flagged as being rate limited in db', () => {
        const rateLimitResetTimestamp = 9999999999999

        simple.mock(db, 'getUserRateLimit').resolveWith(rateLimitResetTimestamp)
        simple
          .mock(utils, 'delayAction')
          .returnWith(delayedSendInstagramMessageActionText)

        return instagram
          .sendInstagramMessage(validSendInstagramMessageActionText, {
            endpoints,
            crypt,
            db
          })
          .then(() => {
            const loggerActual = logger.debug.lastCall.args
            const loggerExpected = [
              {
                userId,
                message: instagramTextMessagePayload
              },
              'User is currently being rate-limited for Instagram Messaging. Delaying action.'
            ]

            assert(utils.delayAction.called)
            expect(loggerActual).to.deep.equal(loggerExpected)
          })
      })

      it('should delay action and set rate limit for user if Instagram returns rate limit status', () => {
        const rateLimitedInstagramResponse = {
          body: JSON.stringify({
            error: {
              code: instagram.MESSAGING_RATE_LIMIT_STATUS_CODE
            }
          })
        }

        simple.mock(db, 'getUserRateLimit').resolveWith(0)
        simple
          .mock(endpoints, 'callEndpoint')
          .resolveWith(rateLimitedInstagramResponse)
        simple.mock(db, 'cacheMetaMessageResponse').resolveWith()
        simple
          .mock(utils, 'setRateLimit')
          .resolveWith(delayedSendInstagramMessageActionText)
        simple.mock(crypt, 'decrypt').returnWith(decryptedAccessToken)

        return instagram
          .sendInstagramMessage(validSendInstagramMessageActionText, {
            endpoints,
            crypt,
            db
          })
          .then(() => {
            const loggerActual = logger.warn.lastCall.args
            const loggerExpected = [
              {
                userId,
                message: instagramTextMessagePayload
              },
              'User has been rate-limited for Instagram Messaging. Delaying action.'
            ]

            assert(utils.setRateLimit.called)
            expect(loggerActual).to.deep.equal(loggerExpected)
          })
      })
    })

    describe('successful sending', () => {
      beforeEach(mockLoggerFunctions)

      afterEach(() => {
        simple.restore()
      })

      it(`should send quick reply message successfully when not rate limited`, async () => {
        const messageAction = validSendInstagramMessageActionQuickReply
        const facebookApiVersion = 'v8.0'
        simple.mock(db, 'getUserRateLimit').resolveWith(0)
        simple.mock(endpoints, 'callEndpoint').resolveWith({
          body: JSON.stringify({
            message_id: '1234',
            recipient_id: '1234',
            some: 'response',
            data: {
              some: 'data'
            }
          }),
          status: 200
        })
        simple.mock(db, 'cacheMetaMessageResponse').resolveWith()
        simple.mock(crypt, 'decrypt').returnWith(decryptedAccessToken)

        await instagram.sendInstagramMessage(messageAction, {
          endpoints,
          crypt,
          db
        })
        const loggerActual = logger.debug.lastCall.args
        const loggerExpected = [
          {
            userId,
            message: messageAction.message
          },
          'Message sent to Instagram successfully'
        ]

        expect(loggerActual).to.deep.equal(loggerExpected)
        expect(endpoints.callEndpoint.callCount).to.equal(1)
        expect(endpoints.callEndpoint.firstCall.args).to.deep.equal([
          {
            method: 'POST',
            query: {
              access_token: decryptedAccessToken
            },
            body: {
              recipient: {
                id: userId
              },
              message: instagramQuickReplyMessage,
              messaging_type: 'RESPONSE'
            },
            retriesRemaining: 10,
            timeout: Number(process.env.META_API_TIMEOUT),
            url: `https://graph.facebook.com/${facebookApiVersion}/me/messages`,
            responseType: 'json'
          }
        ])

        expect(db.cacheMetaMessageResponse.called).to.equal(true)
        expect(cache.cacheMetaRequest.callCount).to.equal(1)
      })

      it(`should send text message successfully when not rate limited`, async () => {
        const messageAction = {
          ...validSendInstagramMessageActionText,
          widgetId: 'widgetId'
        }
        simple.mock(db, 'getUserRateLimit').resolveWith(0)
        simple.mock(endpoints, 'callEndpoint').resolveWith({
          body: JSON.stringify({
            message_id: '1234',
            recipient_id: '4321',
            some: 'response',
            data: {
              some: 'data'
            }
          }),
          status: 200
        })
        simple.mock(db, 'cacheMetaMessageResponse').resolveWith()
        simple.mock(crypt, 'decrypt').returnWith(decryptedAccessToken)

        await instagram.sendInstagramMessage(messageAction, {
          endpoints,
          crypt,
          db
        })
        const loggerActual = logger.debug.lastCall.args
        const loggerExpected = [
          {
            userId,
            message: messageAction.message
          },
          'Message sent to Instagram successfully'
        ]

        expect(loggerActual).to.deep.equal(loggerExpected)
        expect(endpoints.callEndpoint.callCount).to.equal(1)
        expect(endpoints.callEndpoint.firstCall.args).to.deep.equal([
          {
            method: 'POST',
            query: {
              access_token: decryptedAccessToken
            },
            body: {
              recipient: {
                id: userId
              },
              instagramTextMessage
            },
            retriesRemaining: 10,
            timeout: Number(process.env.META_API_TIMEOUT),
            url: `https://graph.facebook.com/${process.env.FACEBOOK_API_VERSION}/me/messages`,
            responseType: 'json'
          }
        ])
        expect(db.cacheMetaMessageResponse.called).to.equal(true)

        expect(cache.cacheMetaRequest.callCount).to.equal(1)

        expect(cache.cacheMetaRequest.lastCall.args).to.deep.equal([
          'instagram',
          'widgetId',
          {
            body: {
              instagramTextMessage,
              recipient: {
                id: userId
              }
            },
            url: `https://graph.facebook.com/${process.env.FACEBOOK_API_VERSION}/me/messages`,
            method: 'POST',
            query: {
              access_token: '***'
            },
            retriesRemaining: 10,
            timeout: Number(process.env.META_API_TIMEOUT),
            responseType: 'json'
          },
          200,
          JSON.stringify({
            message_id: '1234',
            recipient_id: '4321',
            some: 'response',
            data: {
              some: 'data'
            }
          })
        ])
      })

      it('should get the access token from the db when not passed in', () => {
        const SendInstagramMessageActionWithoutAccessToken = {
          message: 'Awesome message payload',
          userId: 1234,
          type: 'SEND_INSTAGRAM_MESSAGE'
        }

        simple.mock(db, 'getUserRateLimit').resolveWith(0)
        simple
          .mock(db, 'getMetaPageAccessToken')
          .resolveWith([[{ page_access_token: 'Awesome tokenness' }]])
        simple.mock(db, 'cacheMetaMessageResponse').resolveWith()
        simple.mock(endpoints, 'callEndpoint').resolveWith({
          body: JSON.stringify({ message_id: '1234', recipient_id: '4321' })
        })
        simple.mock(crypt, 'decrypt').returnWith(decryptedAccessToken)

        return instagram
          .sendInstagramMessage(SendInstagramMessageActionWithoutAccessToken, {
            endpoints,
            crypt,
            db
          })
          .then(() => {
            const loggerActual = logger.debug.lastCall.args
            const loggerExpected = [
              {
                userId: 1234,
                message: SendInstagramMessageActionWithoutAccessToken.message
              },
              'Message sent to Instagram successfully'
            ]

            expect(db.getMetaPageAccessToken.called).to.equal(true)
            expect(loggerActual).to.deep.equal(loggerExpected)
          })
          .catch(err => {
            throw err
          })
      })
    })
  })

  describe('sendInstagramCommentReply', () => {
    const commentId = '1234567890'
    const text = 'Awesome comment reply'
    const accessToken = 'Awesome access token'
    const action = {
      commentId: 'comment_1234',
      message: {
        recipient: { comment_id: commentId },
        message: { text }
      },
      userId: '1234567890',
      widgetId: 'widget_1234'
    }

    const db = {
      getUserRateLimit: simple.mock().resolveWith({}),
      getMetaPageAccessToken: simple
        .mock()
        .resolveWith([[{ page_access_token: accessToken }]])
    }
    const crypt = {
      decrypt: simple.mock().returnWith('decryptedToken')
    }
    const responseBody = {
      message_id: '1234',
      recipient_id: '4321'
    }
    const endpoints = {
      callEndpoint: simple
        .mock()
        .resolveWith({ body: JSON.stringify(responseBody) })
    }

    beforeEach(mockLoggerFunctions)

    afterEach(() => {
      simple.restore()
    })

    it('should throw an error if userId is missing', async () => {
      const newAction = {
        message: {
          recipient: { comment_id: commentId },
          message: { text }
        }
      }

      const expectedError = "Action is missing required field: 'userId"

      try {
        await instagram.sendInstagramCommentReply(newAction, {})
      } catch (actualError) {
        expect(actualError.message).to.equal(expectedError)
      }
    })

    it('should throw an error if message is missing', async () => {
      const newAction = { userId: '1234567890' }

      const expectedError = "Action is missing required field: 'message"

      try {
        await instagram.sendInstagramCommentReply(newAction, {})
      } catch (actualError) {
        expect(actualError.message).to.equal(expectedError)
      }
    })

    it('should delay the action if the user is ratelimited', async () => {
      const rateLimitDb = {
        ...db,
        getUserRateLimit: simple.mock().resolveWith(1)
      }

      const expectedDebugLog = [
        {
          userId: '1234567890',
          message: {
            recipient: {
              comment_id: '1234567890'
            },
            message: {
              text: 'Awesome comment reply'
            }
          }
        },
        'User is currently being rate-limited for Instagram Messaging. Delaying action.'
      ]

      await instagram.sendInstagramCommentReply(action, {
        db: rateLimitDb,
        crypt,
        endpoints
      })

      expect(logger.debug.lastCall.args).to.deep.equal(expectedDebugLog)
    })

    it('should call endpoints to send an if comment reply', async () => {
      simple.mock(db, 'cacheMetaCommentResponse')
      const expectedInfoLog = [
        { userId: '1234567890', message: action.message },
        'Comment reply to Instagram successfully'
      ]

      await instagram.sendInstagramCommentReply(action, {
        db,
        crypt,
        endpoints
      })

      expect(logger.info.lastCall.args).to.deep.equal(expectedInfoLog)
      expect(db.cacheMetaCommentResponse.called).to.equal(true)
      expect(db.cacheMetaCommentResponse.lastCall.args).to.deep.equal([
        '1234',
        '4321',
        'comment_1234',
        'widget_1234',
        'instagram'
      ])
    })

    it('should call endpoints to send an if comment reply', async () => {
      simple.mock(db, 'cacheMetaCommentResponse')

      const expectedInfoLog = [
        { userId: '1234567890', message: action.message },
        'Comment reply to Instagram successfully'
      ]

      await instagram.sendInstagramCommentReply(action, {
        db,
        crypt,
        endpoints
      })

      expect(logger.info.lastCall.args).to.deep.equal(expectedInfoLog)
      expect(db.cacheMetaCommentResponse.called).to.equal(true)
      expect(db.cacheMetaCommentResponse.lastCall.args).to.deep.equal([
        '1234',
        '4321',
        'comment_1234',
        'widget_1234',
        'instagram'
      ])
    })

    it('should ratelimit the user if the response indicated rate limiting', async () => {
      simple.mock(utils, 'setRateLimit').resolveWith('Delayed action')

      const rateLimitEndpoint = {
        ...endpoints,
        callEndpoint: simple
          .mock()
          .resolveWith({ body: { error: { code: 613 } } })
      }

      const expectedWarnLog = [
        { userId: '1234567890', message: action.message },
        'User has been rate-limited for Instagram Messaging. Delaying action.'
      ]

      await instagram.sendInstagramCommentReply(action, {
        db,
        crypt,
        endpoints: rateLimitEndpoint
      })

      expect(logger.warn.lastCall.args).to.deep.equal(expectedWarnLog)
    })
  })
})
