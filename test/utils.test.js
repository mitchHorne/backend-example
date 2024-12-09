/* eslint-disable no-template-curly-in-string */
const { expect, assert } = require('chai')
const utils = require('../app/utils')
const simple = require('simple-mock')

const db = require('../app/db')

const time = new Date('00:00:00 13 October 2020')
const tk = require('timekeeper')
const { logger } = require('@bluerobot/monitoring')

tk.freeze(time)

describe('utils', () => {
  describe('isExpired', () => {
    const present = 1512739800000 // 2017-12-08 15:30
    const past = 1512653400000 // 2017-12-07 15:30
    const future = 1512826200000 // 2017-12-09 15:30

    it('should return true if action has expired', () => {
      const action = {
        expiration: past
      }

      const actual = utils.isExpired(action, { now: present })
      expect(actual).to.equal(true)
    })

    it('should return false if action has not expired', () => {
      const action = {
        expiration: future
      }

      const actual = utils.isExpired(action, { now: present })
      expect(actual).to.equal(false)
    })

    it('should return false if expiration is null', () => {
      const action = { expiration: null }

      const actual = utils.isExpired(action, { now: present })
      expect(actual).to.equal(false)
    })

    it('should return false if expiration is undefined', () => {
      const action = {}

      const actual = utils.isExpired(action, { now: present })
      expect(actual).to.equal(false)
    })
  })

  describe('sanitizeAction', () => {
    const action = {
      type: 'SEND_TWEET',
      twitterAccessTokens: { token: 'token', secret: 'secret' },
      apiKey: 'some-api-key',
      text: 'Hey there, @bear!'
    }

    it('should remove default keys', () => {
      expect(utils.sanitizeAction(action)).to.deep.equal({
        type: 'SEND_TWEET',
        text: 'Hey there, @bear!'
      })
    })

    it('should remove provided keys', () => {
      const keys = ['twitterAccessTokens', 'text']
      expect(utils.sanitizeAction(action, keys)).to.deep.equal({
        type: 'SEND_TWEET',
        apiKey: 'some-api-key'
      })
    })
  })

  describe('isConnectionError', () => {
    const host = '10.91.253.219:80'

    it('should return true on ECONNREFUSED error', () => {
      const error = new Error(
        `RequestError: Error: connect ECONNREFUSED ${host}`
      )
      expect(utils.isConnectionError(error)).to.equal(true)
    })

    it('should return true on socket hang up error', () => {
      const error = new Error('RequestError: Error: socket hang up')
      expect(utils.isConnectionError(error)).to.equal(true)
    })

    it('should return true on ECONNRESET error', () => {
      const error = new Error('RequestError: Error: read ECONNRESET')
      expect(utils.isConnectionError(error)).to.equal(true)
    })

    it('should return true on EHOSTUNREACH error', () => {
      const error = new Error(
        `RequestError: Error: connect EHOSTUNREACH ${host}`
      )
      expect(utils.isConnectionError(error)).to.equal(true)
    })

    it('should return true on ETIMEDOUT error', () => {
      const error = new Error(`Error: connect ETIMEDOUT ${host}`)
      expect(utils.isConnectionError(error)).to.equal(true)
    })

    it('should return false on any other error', () => {
      const error = new Error('This is any other error')
      expect(utils.isConnectionError(error)).to.equal(false)
    })
  })

  describe('isMediaUploadingError', () => {
    it("should return true if message starts contains both 423 and 'is uploading'", () => {
      const error = {
        statusCode: 423,
        message: 'Random HTTP Error message',
        response: {
          statusCode: 423,
          body: "Media id '41cf0b37-e0b3-11e8-8d71-0242c0a83003' is uploading\""
        }
      }
      expect(utils.isMediaUploadingError(error)).to.equal(true)
    })

    it('should return false when error is undefined', () => {
      expect(utils.isMediaUploadingError()).to.equal(false)
    })

    it('should return false when statusCode is undefined', () => {
      expect(utils.isMediaUploadingError({})).to.equal(false)
    })

    it('should return false when the statusCode is not 423', () => {
      const error = {
        statusCode: 500,
        message: 'Random HTTP Error message',
        response: {
          statusCode: 500,
          body: 'Internal server error'
        }
      }
      expect(utils.isMediaUploadingError(error)).to.equal(false)
    })
  })

  describe('delayAction', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should return 0 when limitedResetAt is not provided.', () => {
      const action = {}
      const limitResetAt = 0

      return expect(
        utils.delayAction({ action, limitResetAt })
      ).to.have.property('delay', 0)
    })

    it('should return 0 when calculated value is negative', () => {
      const action = {}
      simple.mock(process.env, 'TWITTER_RATE_LIMIT_DELAY', 0)
      const limitResetAt = time.valueOf() / 1000 - 1000

      expect(
        utils.delayAction({
          action,
          limitResetAt
        })
      ).to.have.property('delay', 0)
    })

    it('should return correctly calculated delay without env var set', () => {
      const action = {}
      const limitResetAt = time.valueOf() / 1000 + 10

      expect(
        utils.delayAction({
          action,
          limitResetAt
        })
      ).to.have.property('delay', 12000)
    })

    it('should return correctly calculated delay with env var set', () => {
      const action = {}
      simple.mock(process.env, 'ACTION_RATE_LIMIT_DELAY', 5)
      const limitResetAt = time.valueOf() / 1000 + 10 // 10 seconds ahead

      expect(
        utils.delayAction({
          action,
          limitResetAt
        })
      ).to.have.property('delay', 15000)
    })

    it('should convert limitedResetAt to a number if it is a string', () => {
      const action = {}
      simple.mock(process.env, 'ACTION_RATE_LIMIT_DELAY', 5)
      const limitResetAt = time.valueOf() / 1000 + 10 // 10 seconds ahead

      expect(
        utils.delayAction({
          action,
          limitResetAt: limitResetAt.toString()
        })
      ).to.have.property('delay', 15000)
    })
  })

  describe('setRateLimit', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should reject when no headers are found', () => {
      const options = {
        action: 'call_action',
        platform: 'Twitter',
        method: 'post',
        endpoint: 'fake/endpoint',
        userId: 'user_id'
      }
      return utils.setRateLimit(options).catch(error => {
        assert.equal(
          error.message,
          'No headers in the rate limited Twitter response'
        )
      })
    })

    it('should reject when x-rate-limit-reset field is found in headers', () => {
      const options = {
        action: 'call_action',
        platform: 'Twitter',
        method: 'post',
        headers: {},
        endpoint: 'fake/endpoint',
        userId: 'user_id'
      }
      return utils.setRateLimit(options).catch(error => {
        assert.equal(
          error.message,
          'No x-rate-limit-reset field found in headers of the rate limited Twitter response'
        )
      })
    })

    it('should delayAction on success', () => {
      const options = {
        action: 'call_action',
        headers: { 'x-rate-limit-reset': time / 1000 + 10 },
        method: 'post',
        endpoint: 'fake/endpoint',
        userId: 'user_id'
      }
      simple.mock(db, 'upsertRateLimit').resolveWith()

      return utils.setRateLimit(options).then(() => {})
    })

    it('should reject on db error', () => {
      const err = new Error('oops')
      simple.mock(db, 'upsertRateLimit').rejectWith(err)
      const options = {
        action: 'call_action',
        headers: { 'x-rate-limit-reset': 10 },
        method: 'post',
        endpoint: 'fake/endpoint',
        userId: 'user_id'
      }
      return utils.setRateLimit(options).catch(error => {
        assert.equal(error, err)
      })
    })
  })

  const actionType = 'LOOKUP_API'
  const exchangeName = 'blue_robot'
  const routingKey = `actions.build.1`

  describe('Inner Action Handlers', () => {
    const buffer = simple.mock(() => 'Buffered_content')
    const publish = simple.mock()
    const channel = { publish }

    beforeEach(() => {
      buffer.reset()
      publish.reset()
    })

    const { checkAndHandleSuccessActions, checkAndHandleFailureActions } = utils
    it('should publish a plain messaging failure action to the channel', () => {
      const action = { widgetId: '1', failure: [{ text: 'text' }] }
      const payload = { actionType, buffer, channel, exchangeName }

      const expectedBufferArgs = {
        actions: [{ text: 'text' }]
      }
      const expectedPublishArgs = [exchangeName, routingKey, 'Buffered_content']

      checkAndHandleFailureActions(action, payload)

      expect(publish.called).equal(true)
      expect(buffer.lastCall.args[0]).to.deep.equal(expectedBufferArgs)
      expect(publish.lastCall.args).to.deep.equal(expectedPublishArgs)
    })

    it('should publish a plain messaging success action to the channel', () => {
      const action = { widgetId: '1', success: [{ text: 'text' }] }
      const payload = {
        actionType,
        buffer,
        channel,
        exchangeName,
        result: { body: '{"name": "test name"}' }
      }

      const expectedBufferArgs = {
        actions: [{ text: 'text' }],
        context: { name: 'test name' }
      }
      const expectedPublishArgs = [exchangeName, routingKey, 'Buffered_content']

      checkAndHandleSuccessActions(action, payload)

      expect(publish.called).equal(true)
      expect(buffer.lastCall.args[0]).to.deep.equal(expectedBufferArgs)
      expect(publish.lastCall.args).to.deep.equal(expectedPublishArgs)
    })

    it('log a warning if JSON parse fails', () => {
      simple.mock(logger, 'debug')

      const action = { widgetId: '1', success: [{ text: 'text' }] }
      const payload = {
        actionType,
        buffer,
        channel,
        exchangeName,
        result: { body: { name: 'Already parsed Jason' } }
      }

      checkAndHandleSuccessActions(action, payload)

      expect(logger.debug.called).equal(true)
      expect(logger.debug.calls[0].args[1]).to.deep.equal(
        'Could not parse result body - setting context to empty'
      )
    })

    it('should throw and log errors if processing inner success or failure actions fails', () => {
      simple.mock(logger, 'debug')
      simple.mock(logger, 'error')

      const action = {
        widgetId: '1',
        success: [{ garbageAction: 'garbage' }],
        failure: [{ garbageAction: 'garbage' }]
      }
      const payload = {
        actionType,
        buffer,
        channel,
        exchangeName,
        result: { body: '{ "babyJediName": "Luke" }' }
      }

      checkAndHandleSuccessActions(action, payload)
      checkAndHandleFailureActions(action, payload)

      expect(publish.called).equal(false)
      expect(logger.error.called).equal(true)
      expect(logger.debug.calls.length).equal(4)
    })

    it('should publish an inner SEND_INSTAGRAM_MESSAGE action', () => {
      const actionWithSuccess = {
        widgetId: '1',
        success: [
          {
            accessToken: 'encrypted-access-token',
            message: {
              message: {
                text: 'To Tatooine. To his family, send \\${babyJediName}.'
              },
              recipient: {
                id: '3649069441862905'
              }
            },
            platform: 'instagram',
            type: 'SEND_INSTAGRAM_MESSAGE'
          }
        ]
      }

      const payload = {
        actionType,
        buffer,
        channel,
        exchangeName,
        result: { body: '{ "babyJediName": "Luke" }' }
      }

      checkAndHandleSuccessActions(actionWithSuccess, payload)

      const expectedBufferArgs = {
        actions: [
          {
            accessToken: 'encrypted-access-token',
            message: {
              message: {
                text: 'To Tatooine. To his family, send ${babyJediName}.'
              },
              recipient: {
                id: '3649069441862905'
              }
            },
            platform: 'instagram',
            type: 'SEND_INSTAGRAM_MESSAGE'
          }
        ],
        context: {
          babyJediName: 'Luke'
        },
        instagramActivity: {
          messageEvent: {
            sender: {
              id: '3649069441862905'
            },
            recipient: {
              id: 'LOOKUP_API'
            },
            type: 'text'
          }
        }
      }
      const expectedPublishArgs = [exchangeName, routingKey, 'Buffered_content']

      expect(publish.called).equal(true)
      expect(buffer.lastCall.args[0]).to.deep.equal(expectedBufferArgs)
      expect(publish.lastCall.args).to.deep.equal(expectedPublishArgs)
    })

    it('should publish an inner SEND_WHATSAPP_MESSAGE action', () => {
      const actionWithSuccess = {
        widgetId: '1',
        success: [
          {
            type: 'SEND_WHATSAPP_MESSAGE',
            message: {
              recipient_type: 'individual',
              text: {
                body:
                  'An old friend has learned the path to immortality. One who has returned from the netherworld of the Force... Your old master \\${context.deadJedi}.'
              },
              to: '27796937345',
              type: 'text'
            },
            apiKey: 'super-secret-key',
            platform: 'whatsapp'
          }
        ]
      }

      const payload = {
        actionType,
        buffer,
        channel,
        exchangeName,
        result: { body: '{ "deadJedi": "Qui-Gon Jinn" }' }
      }

      checkAndHandleSuccessActions(actionWithSuccess, payload)

      const expectedBufferArgs = {
        actions: [
          {
            type: 'SEND_WHATSAPP_MESSAGE',
            message: {
              recipient_type: 'individual',
              text: {
                body:
                  'An old friend has learned the path to immortality. One who has returned from the netherworld of the Force... Your old master ${context.deadJedi}.'
              },
              to: '27796937345',
              type: 'text'
            },
            apiKey: 'super-secret-key',
            platform: 'whatsapp'
          }
        ],
        context: {
          deadJedi: 'Qui-Gon Jinn'
        },
        whatsappMessage: {}
      }
      const expectedPublishArgs = [exchangeName, routingKey, 'Buffered_content']

      expect(publish.called).equal(true)
      expect(buffer.lastCall.args[0]).to.deep.equal(expectedBufferArgs)
      expect(publish.lastCall.args).to.deep.equal(expectedPublishArgs)
    })

    // it('should publish an inner SEND_FACEBOOK_MESSAGE plain text action', () => {
    //   const actionWithSuccess = {
    //     widgetId: '1',
    //     success: [
    //       {
    //         type: 'SEND_FACEBOOK_MESSAGE',
    //         message: {
    //           message: {
    //             text: 'I will take \\${context.babyJedi} and watch over her'
    //           },
    //           recipient: {
    //             id: '4137552649681107'
    //           },
    //           messaging_type: 'RESPONSE'
    //         },
    //         apiKey: 'super-secret-key'
    //       }
    //     ]
    //   }

    //   const payload = {
    //     actionType,
    //     buffer,
    //     channel,
    //     exchangeName,
    //     result: { body: '{ "babyJedi": "Leia" }' }
    //   }

    //   checkAndHandleSuccessActions(actionWithSuccess, payload)

    //   const expectedBufferArgs = {
    //     actions: [
    //       {
    //         type: 'SEND_FACEBOOK_MESSAGE',
    //         message: {
    //           message: {
    //             text: 'I will take ${context.babyJedi} and watch over her'
    //           },
    //           recipient: {
    //             id: '4137552649681107'
    //           },
    //           messaging_type: 'RESPONSE'
    //         },
    //         apiKey: 'super-secret-key'
    //       }
    //     ],
    //     context: {
    //       babyJedi: 'Leia'
    //     },
    //     facebookMessage: {},
    //     facebookActivity: { type: null }
    //   }
    //   const expectedPublishArgs = [exchangeName, routingKey, 'Buffered_content']

    //   expect(publish.called).equal(true)
    //   expect(buffer.lastCall.args[0]).to.deep.equal(expectedBufferArgs)
    //   expect(publish.lastCall.args).to.deep.equal(expectedPublishArgs)
    // })

    // it('should publish an inner SEND_FACEBOOK_MESSAGE non plain text action', () => {
    //   const actionWithSuccess = {
    //     widgetId: '1',
    //     success: [
    //       {
    //         type: 'SEND_FACEBOOK_MESSAGE',
    //         message: {
    //           message: {
    //             attachment: {
    //               type: 'template',
    //               payload: {
    //                 elements: [
    //                   {
    //                     title: 'The template heading',
    //                     subtitle: 'you opted in',
    //                     image_url:
    //                       'https://static.wikia.nocookie.net/southpark/images/a/af/Chickenpox9.png',
    //                     default_action: {
    //                       url: 'https://www.bluerobot.com',
    //                       type: 'web_url',
    //                       webview_height_ratio: 'tall'
    //                     }
    //                   }
    //                 ],
    //                 template_type: 'generic'
    //               }
    //             }
    //           },
    //           recipient: {
    //             id: '${senderId}'
    //           }
    //         }
    //       }
    //     ]
    //   }

    //   const payload = {
    //     actionType,
    //     buffer,
    //     channel,
    //     exchangeName,
    //     result: { body: {} }
    //   }

    //   checkAndHandleSuccessActions(actionWithSuccess, payload)

    //   const expectedBufferArgs = {
    //     actions: [
    //       {
    //         type: 'SEND_FACEBOOK_MESSAGE',
    //         message: {
    //           message: {
    //             attachment: {
    //               type: 'template',
    //               payload: {
    //                 elements: [
    //                   {
    //                     title: 'The template heading',
    //                     subtitle: 'you opted in',
    //                     image_url:
    //                       'https://static.wikia.nocookie.net/southpark/images/a/af/Chickenpox9.png',
    //                     default_action: {
    //                       url: 'https://www.bluerobot.com',
    //                       type: 'web_url',
    //                       webview_height_ratio: 'tall'
    //                     }
    //                   }
    //                 ],
    //                 template_type: 'generic'
    //               }
    //             }
    //           },
    //           recipient: {
    //             id: '${senderId}'
    //           }
    //         }
    //       }
    //     ],
    //     context: {},
    //     facebookMessage: {},
    //     facebookActivity: { type: null }
    //   }
    //   const expectedPublishArgs = [exchangeName, routingKey, 'Buffered_content']

    //   expect(publish.called).equal(true)
    //   expect(buffer.lastCall.args[0]).to.deep.equal(expectedBufferArgs)
    //   expect(publish.lastCall.args).to.deep.equal(expectedPublishArgs)
    // })

    it('should publish an inner SEND_DARK_TWEET action', () => {
      const actionWithSuccess = {
        widgetId: '1',
        success: [
          {
            type: 'SEND_DARK_TWEET',
            text: 'Ayyy, you started the speedthread! \\${someMergeField}'
          }
        ]
      }

      const payload = {
        actionType,
        buffer,
        channel,
        exchangeName,
        result: { body: { context: {}, twitterActivity: {} } }
      }

      checkAndHandleSuccessActions(actionWithSuccess, payload)

      const expectedBufferArgs = {
        actions: [
          {
            type: 'SEND_DARK_TWEET',
            text: 'Ayyy, you started the speedthread! ${someMergeField}'
          }
        ],
        context: {},
        twitterActivity: {},
        type: 'favorite_event'
      }
      const expectedPublishArgs = [exchangeName, routingKey, 'Buffered_content']

      expect(publish.called).equal(true)
      expect(buffer.lastCall.args[0]).to.deep.equal(expectedBufferArgs)
      expect(publish.lastCall.args).to.deep.equal(expectedPublishArgs)
    })
  })

  describe('tryParseJson', () => {
    it('should parse JSON string as JSON', () => {
      const json = {
        test: 'tester'
      }

      const jsonString = JSON.stringify(json)
      const actual = utils.tryParseJson(jsonString)
      const expected = json

      expect(actual).to.deep.equal(expected)
    })

    it('should return JSON if already parsed', () => {
      const json = {
        test: 'tester'
      }

      const actual = utils.tryParseJson(json)
      const expected = json

      expect(actual).to.deep.equal(expected)
    })

    it('should return null if given undefined', () => {
      const actual = utils.tryParseJson(undefined)
      const expected = null

      assert.equal(actual, expected)
    })

    it('should return null if given invalid JSON string', () => {
      const invalidJsonString = 'not a real JSON string OwO'

      const actual = utils.tryParseJson(invalidJsonString)
      const expected = null

      assert.equal(actual, expected)
    })
  })
})
