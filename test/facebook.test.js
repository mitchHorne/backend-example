/* eslint-disable no-template-curly-in-string */
const { expect } = require('chai')
const simple = require('simple-mock')

const db = require('../app/db')
const utils = require('../app/utils')
const endpoints = require('../app/endpoints')
const facebook = require('../app/facebook')
const crypt = require('@bluerobot/crypt-keeper')
const { logger } = require('@bluerobot/monitoring')
const cache = require('../app/cache')

const actionProcessor = require('../app/action-processor')
describe('facebook', () => {
  beforeEach(() => {
    simple.mock(cache, 'cacheMetaRequest').resolveWith()
    simple.mock(cache, 'cacheMetaBlastMessage').resolveWith()
  })

  afterEach(() => {
    simple.restore()
  })

  describe('SEND_FACEBOOK_MESSAGE', () => {
    beforeEach(() => {
      simple.mock(db, 'upsertRateLimit').resolveWith()
      simple.mock(db, 'getUserRateLimit').resolveWith([])
      simple
        .mock(db, 'getMetaPageAccessToken')
        .resolveWith([[{ page_access_token: 'encrypted-page-access-token' }]])
      simple.mock(crypt, 'decrypt').returnWith('decrypted-page-access-token')
      simple.mock(logger, 'debug')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'info')
      simple.mock(logger, 'error')
    })

    afterEach(() => {
      simple.restore()
    })

    const action = {
      type: 'SEND_FACEBOOK_MESSAGE',
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

    const consentAction = {
      widgetId: 'widget-id-1',
      participantId: 'participant-id-1',
      type: 'SEND_FACEBOOK_MESSAGE',
      message: {
        message: {
          attachment: {
            type: 'template',
            payload: {
              title: "We'll remind you!",
              payload: 'username:${senderName}',
              image_url: 'https://i.postimg.cc/26Vx2Y3T.jpg',
              template_type: 'notification_messages',
              notification_messages_reoptin: 'ENABLED',
              notification_messages_timezone: 'Africa/Johannesburg',
              notification_messages_frequency: 'DAILY'
            }
          }
        },
        recipient: {
          id: '5411149681107'
        }
      }
    }

    it('should call endpoint with the correct options', async () => {
      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 200,
        body: JSON.stringify({
          recipient_id: 'a-recipient-id-1',
          message_id: 'facebook-message-id-1'
        })
      })
      simple.mock(crypt, 'encrypt').returnWith('encrypted-payload')

      simple.mock(db, 'getFbParticipants', () => Promise.resolve([[]]))
      simple.mock(db, 'cacheMetaMessageResponse').resolveWith()

      const expected = {
        method: 'POST',
        url: `${process.env.FACEBOOK_API_URL}/me/messages?access_token=decrypted-page-access-token`,
        body: action.message,
        retryRemaining: 100,
        retryStatuses: '4,17,32',
        responseType: 'json'
      }

      await actionProcessor.sendFacebookMessage({
        ...action,
        widgetId: 'widget-id-1'
      })

      expect(crypt.decrypt.lastCall.args).to.deep.equal([
        'encrypted-page-access-token'
      ])

      expect(endpoints.callEndpoint.callCount).to.equal(1)
      expect(endpoints.callEndpoint.firstCall.args).to.deep.equal([expected])
      expect(cache.cacheMetaRequest.callCount).to.equal(1)
    })

    it('should not send a consent request if the relevant participant is already opted in', async () => {
      simple.mock(db, 'getFbParticipants', () => Promise.resolve([['12345']]))

      const response = await actionProcessor.sendFacebookMessage(consentAction)

      expect(logger.debug.lastCall.args).to.deep.equal([
        {
          action: {
            widgetId: 'widget-id-1',
            participantId: 'participant-id-1',
            type: 'SEND_FACEBOOK_MESSAGE',
            message: {
              message: {
                attachment: {
                  type: 'template',
                  payload: {
                    title: "We'll remind you!",
                    payload: 'username:${senderName}',
                    image_url: 'https://i.postimg.cc/26Vx2Y3T.jpg',
                    template_type: 'notification_messages',
                    notification_messages_reoptin: 'ENABLED',
                    notification_messages_timezone: 'Africa/Johannesburg',
                    notification_messages_frequency: 'DAILY'
                  }
                }
              },
              recipient: {
                id: '5411149681107'
              }
            }
          }
        },
        'User already opted in'
      ])

      expect(response).to.deep.equal({
        body: 'User already opted in',
        status: 409
      })
    })

    it('should send a consent request if the relevant participant is not yet opted in', async () => {
      simple.mock(db, 'getFbParticipants', () => Promise.resolve([[]]))
      simple.mock(db, 'cacheMetaMessageResponse').resolveWith()
      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 200,
        body: JSON.stringify({
          recipient_id: 'a-recipient-id-1',
          message_id: 'facebook-message-id-1'
        })
      })

      const response = await actionProcessor.sendFacebookMessage(consentAction)

      expect(response).to.deep.equal({
        status: 200,
        body: JSON.stringify({
          recipient_id: 'a-recipient-id-1',
          message_id: 'facebook-message-id-1'
        })
      })
    })

    it('should return an error if the endpoint call fails and still call cache service', async () => {
      simple.mock(endpoints, 'callEndpoint').throwWith({
        statusCode: 400,
        error: {
          response: {
            body: {
              error: {
                message: 'Bad request',
                code: 'some fb error code'
              }
            }
          }
        }
      })
      simple.mock(crypt, 'encrypt').returnWith('encrypted-payload')

      const expected = {
        method: 'POST',
        url: `${process.env.FACEBOOK_API_URL}/me/messages?access_token=decrypted-page-access-token`,
        body: action.message,
        retryRemaining: 100,
        retryStatuses: '4,17,32',
        responseType: 'json'
      }

      let errorCaught = false
      await actionProcessor
        .sendFacebookMessage({
          ...action,
          widgetId: 'widget-id-1',
          participantId: 'participant-id-1'
        })
        .catch(() => {
          errorCaught = true
          expect(endpoints.callEndpoint.callCount).to.equal(1)
          expect(endpoints.callEndpoint.firstCall.args).to.deep.equal([
            expected
          ])
        })
      expect(errorCaught).to.equal(true)

      expect(crypt.decrypt.lastCall.args).to.deep.equal([
        'encrypted-page-access-token'
      ])
      expect(endpoints.callEndpoint.firstCall.args).to.deep.equal([expected])
      expect(cache.cacheMetaRequest.callCount).to.equal(1)
    })

    it('should call `cacheMetaBlastMessage` with One-Time Notification message', async () => {
      const action = {
        type: 'SEND_FACEBOOK_MESSAGE',
        widgetId: 'unique-widget-id',
        blastId: 'unique-blast-id',
        participantId: 'unique-participant-id',
        message: {
          recipient: {
            one_time_notif_token: 'unique-fb-one-time-notif-token'
          },
          message: {
            text: 'One time notification'
          }
        }
      }
      const responseObject = {
        status: 200,
        body: JSON.stringify({
          message_id: '1234',
          recipient_id: '4321'
        })
      }
      simple.mock(endpoints, 'callEndpoint').resolveWith(responseObject)
      simple.mock(db, 'cacheMetaMessageResponse').resolveWith()

      await facebook.sendFacebookMessage(action)

      expect(db.cacheMetaMessageResponse.called).to.equal(true)
      expect(cache.cacheMetaBlastMessage.callCount).to.equal(1)
      expect(cache.cacheMetaBlastMessage.lastCall.args).to.deep.equal([
        'facebook',
        action.message,
        action.widgetId,
        action.blastId,
        action.participantId,
        responseObject.status,
        responseObject.body,
        true // deleteParticipant
      ])
    })

    it('should call `cacheMetaBlastMessage` with Recurring Notification message', async () => {
      const action = {
        type: 'SEND_FACEBOOK_MESSAGE',
        widgetId: 'unique-widget-id',
        blastId: 'unique-blast-id',
        participantId: 'unique-participant-id',
        message: {
          recipient: {
            notification_messages_token: 'unique-fb-recurring-notif-token'
          },
          message: {
            text: 'Recurring notification'
          }
        }
      }
      const responseObject = {
        status: 200,
        body: JSON.stringify({
          message_id: '1234',
          recipient_id: '4321'
        })
      }

      simple.mock(endpoints, 'callEndpoint').resolveWith(responseObject)
      simple.mock(db, 'cacheMetaMessageResponse').resolveWith()

      await actionProcessor.sendFacebookMessage(action)

      expect(cache.cacheMetaBlastMessage.callCount).to.equal(1)
      expect(cache.cacheMetaBlastMessage.lastCall.args).to.deep.equal([
        'facebook',
        action.message,
        action.widgetId,
        action.blastId,
        action.participantId,
        responseObject.status,
        responseObject.body,
        false // deleteParticipant
      ])

      expect(db.cacheMetaMessageResponse.called).to.equal(true)
      expect(db.cacheMetaMessageResponse.lastCall.args).to.deep.equal([
        '1234',
        '4321',
        'unique-widget-id',
        'facebook'
      ])
    })

    it('should set rate limit if endpoint returns 4', async () => {
      simple.mock(endpoints, 'callEndpoint').throwWith({
        statusCode: 400,
        response: {
          body: {
            error: {
              code: 4,
              message: 'Application request limit reached'
            }
          }
        }
      })

      simple.mock(utils, 'setRateLimit')

      const expected = {
        action: {
          message: {
            recipient: {
              comment_id: 'unique-fb-comment-id'
            },
            message: {
              text: 'Hello user!'
            },
            messaging_type: 'RESPONSE'
          },
          type: 'SEND_FACEBOOK_MESSAGE'
        },
        endpoint: 'messages',
        headers: {
          'x-rate-limit-reset': 1602550800
        },
        method: 'POST',
        platform: 'FACEBOOK',
        userId: undefined
      }

      await actionProcessor.sendFacebookMessage(action)

      expect(utils.setRateLimit.lastCall.args).to.deep.equal([expected])
    })

    it('should set rate limit if endpoint returns 17', async () => {
      simple.mock(endpoints, 'callEndpoint').throwWith({
        status: 400,
        response: {
          body: {
            error: {
              code: 17,
              message: 'User request limit reached'
            }
          }
        }
      })

      simple.mock(utils, 'setRateLimit')

      const expected = {
        action: {
          message: {
            recipient: {
              comment_id: 'unique-fb-comment-id'
            },
            message: {
              text: 'Hello user!'
            },
            messaging_type: 'RESPONSE'
          },
          type: 'SEND_FACEBOOK_MESSAGE'
        },
        endpoint: 'messages',
        headers: {
          'x-rate-limit-reset': 1602550800
        },
        method: 'POST',
        platform: 'FACEBOOK',
        userId: undefined
      }

      await actionProcessor.sendFacebookMessage(action).catch(() => {})

      expect(utils.setRateLimit.lastCall.args).to.deep.equal([expected])
    })

    it('should set rate limit if endpoint returns 32', async () => {
      simple.mock(endpoints, 'callEndpoint').throwWith({
        status: 400,
        response: {
          body: {
            error: {
              code: 32,
              message: 'Page request limit reached'
            }
          }
        }
      })

      simple.mock(utils, 'setRateLimit').resolveWith()

      const expected = {
        action: {
          message: {
            recipient: {
              comment_id: 'unique-fb-comment-id'
            },
            message: {
              text: 'Hello user!'
            },
            messaging_type: 'RESPONSE'
          },
          type: 'SEND_FACEBOOK_MESSAGE'
        },
        endpoint: 'messages',
        headers: {
          'x-rate-limit-reset': 1602550800
        },
        method: 'POST',
        platform: 'FACEBOOK',
        userId: undefined
      }

      await actionProcessor.sendFacebookMessage(action)

      expect(utils.setRateLimit.lastCall.args).to.deep.equal([expected])
    })

    it('should log an info log if status is 613', async () => {
      const mockResponse = {
        statusCode: 400,
        response: {
          body: {
            error: {
              message: 'Calls to this api have exceeded the rate limit.',
              type: 'OAuthException',
              code: 613,
              error_data: {
                blame_field_specs: [['']]
              },
              error_subcode: 1893016,
              is_transient: false,
              error_user_title: 'Duplicate Opt In Message',
              error_user_msg:
                'Scope of service exceeded: You may not send multiple opt-in requests with the same topic to a user',
              fbtrace_id: 'Ab_MPVNxHuHd_OLb-aoN3Dt'
            }
          }
        }
      }
      simple.mock(endpoints, 'callEndpoint').throwWith(mockResponse)

      await actionProcessor.sendFacebookMessage({
        ...action,
        widgetId: 'unique-widget-id',
        participantId: 'unique-participant-id'
      })

      expect(logger.info.lastCall.args).to.deep.equal([
        {
          metaResponse: {
            metaResponseBody: mockResponse.response.body,
            metaResponseCode: mockResponse.statusCode
          },
          widgetId: 'unique-widget-id',
          participantId: 'unique-participant-id'
        },
        'Duplicate Notification opt-in request error received from Facebook. Acknowledged.'
      ])
    })

    it('should not process action if rate_limit exists', async () => {
      simple.mock(db, 'getUserRateLimit').resolveWith(1)
      simple.mock(endpoints, 'callEndpoint').resolveWith()
      simple.mock(utils, 'delayAction').resolveWith()

      await actionProcessor.sendFacebookMessage(action)

      expect(utils.delayAction.lastCall.args).to.deep.equal([
        {
          action,
          limitResetAt: 1
        }
      ])
      expect(endpoints.callEndpoint.called).to.equal(false)
    })
  })

  describe('SEND_FACEBOOK_COMMENT', () => {
    beforeEach(() => {
      simple.mock(cache, 'cacheMetaRequest')
      simple.mock(db, 'upsertRateLimit').resolveWith()
      simple.mock(db, 'getUserRateLimit').resolveWith([])
      simple
        .mock(db, 'getMetaPageAccessToken')
        .resolveWith([[{ page_access_token: 'encrypted-page-access-token' }]])
      simple.mock(crypt, 'decrypt').returnWith('decrypted-page-access-token')
    })

    afterEach(() => {
      simple.restore()
    })

    const action = {
      type: 'SEND_FACEBOOK_COMMENT',
      objectId: 'unique-fb-object-id',
      commentId: 'comment_1234',
      message: {
        message:
          'Hello user who commented or posted! This is a new comment from the bot!'
      }
    }

    it('should call endpoint with the correct options', async () => {
      const responseBody = {
        recipient_id: '1234',
        message_id: '4321'
      }

      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 200,
        body: JSON.stringify(responseBody)
      })
      simple.mock(db, 'cacheMetaCommentResponse').resolveWith()

      const expected = {
        method: 'POST',
        url: `${
          process.env.FACEBOOK_API_URL
        }/${'unique-fb-object-id'}/comments?access_token=${'decrypted-page-access-token'}`,
        body: action.message,
        retryRemaining: 100,
        retryStatuses: '4,17,32'
      }

      await actionProcessor.sendFacebookComment(action)

      expect(crypt.decrypt.lastCall.args).to.deep.equal([
        'encrypted-page-access-token'
      ])
      expect(endpoints.callEndpoint.firstCall.args).to.deep.equal([expected])
      expect(cache.cacheMetaRequest.callCount).to.equal(1)
      expect(db.cacheMetaCommentResponse.callCount).to.equal(1)
      expect(db.cacheMetaCommentResponse.lastCall.args).to.deep.equal([
        '4321',
        '1234',
        'comment_1234',
        '',
        'facebook'
      ])
    })

    it('should set rate limit if endpoint returns 4', async () => {
      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 400,
        body: {
          error: {
            code: 4,
            message: 'Application request limit reached'
          }
        }
      })

      simple.mock(utils, 'setRateLimit').resolveWith()

      const expected = {
        action: {
          type: 'SEND_FACEBOOK_COMMENT',
          objectId: 'unique-fb-object-id',
          commentId: 'comment_1234',
          message: {
            message:
              'Hello user who commented or posted! This is a new comment from the bot!'
          }
        },
        endpoint: 'comments',
        headers: {
          'x-rate-limit-reset': 1602550800
        },
        method: 'POST',
        platform: 'FACEBOOK',
        userId: undefined
      }

      await actionProcessor.sendFacebookComment(action)

      expect(utils.setRateLimit.lastCall.args).to.deep.equal([expected])
    })

    it('should set rate limit if endpoint returns 17', async () => {
      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 400,
        body: {
          error: {
            code: 17,
            message: 'User request limit reached'
          }
        }
      })

      simple.mock(utils, 'setRateLimit').resolveWith()

      const expected = {
        action: {
          type: 'SEND_FACEBOOK_COMMENT',
          objectId: 'unique-fb-object-id',
          commentId: 'comment_1234',
          message: {
            message:
              'Hello user who commented or posted! This is a new comment from the bot!'
          }
        },
        endpoint: 'comments',
        headers: {
          'x-rate-limit-reset': 1602550800
        },
        method: 'POST',
        platform: 'FACEBOOK',
        userId: undefined
      }

      await actionProcessor.sendFacebookComment(action)

      expect(utils.setRateLimit.lastCall.args).to.deep.equal([expected])
    })

    it('should set rate limit if endpoint returns 32', async () => {
      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 400,
        body: {
          error: {
            code: 32,
            message: 'Could not authenticate you'
          }
        }
      })

      simple.mock(utils, 'setRateLimit').resolveWith()

      const expected = {
        action: {
          type: 'SEND_FACEBOOK_COMMENT',
          objectId: 'unique-fb-object-id',
          commentId: 'comment_1234',
          message: {
            message:
              'Hello user who commented or posted! This is a new comment from the bot!'
          }
        },
        endpoint: 'comments',
        headers: {
          'x-rate-limit-reset': 1602550800
        },
        method: 'POST',
        platform: 'FACEBOOK',
        userId: undefined
      }

      await actionProcessor.sendFacebookComment(action)

      expect(utils.setRateLimit.lastCall.args).to.deep.equal([expected])
    })

    it('should not process action if rate_limit exists', async () => {
      simple.mock(db, 'getUserRateLimit').resolveWith(2)
      simple.mock(endpoints, 'callEndpoint').resolveWith()
      simple.mock(utils, 'delayAction').resolveWith()

      await actionProcessor.sendFacebookComment(action)

      expect(utils.delayAction.lastCall.args).to.deep.equal([
        {
          action,
          limitResetAt: 2
        }
      ])
      expect(endpoints.callEndpoint.called).to.equal(false)
    })
  })

  describe('FB_OPT_IN_ONE_TIME', () => {
    const action = {
      userId: 'FB-102402752351760',
      type: 'FB_OPT_IN_ONE_TIME',
      failure: [],
      success: [
        {
          type: 'SEND_FACEBOOK_MESSAGE',
          message: {
            message: {
              text:
                'Hello Michael G. Thomas! this is your opt-in confirmation response when you opted in at 1656416291769 !'
            },
            recipient: {
              id: '4137552649681107'
            },
            messaging_type: 'RESPONSE'
          }
        }
      ],
      fbUserId: '4137552649681107',
      username:
        'dae5082d8f6244cdd956e2b2ab470e7f54bd021464477bf6f34ce22fdcb97a9c91b80b6188a688552ab7f9788131af08df9858bc747379144a86a0e0e9adb5b45495f23914f4e22c50d89a58db3afd3d55e7e70e198e601ce8e4a61126fab11dc25526bf96888e4f42d6c4edd0b0fc290a',
      responseType: 'ONE_TIME_REMINDER',
      widgetId: 'fb-optin',
      token: '6177341647910041736'
    }
    it('should call FB subscription endpoint with the correct options', async () => {
      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 200
      })
      simple.mock(db, 'getFbParticipants', () => Promise.resolve([[]]))
      const {
        widgetId,
        userId,
        userPsid,
        username,
        token,
        responseType
      } = action

      const expected = {
        widgetId,
        userId,
        method: 'POST',
        url: `${process.env.FACEBOOK_SUBSCRIPTION_URL}/participants/${action.widgetId}`,
        body: JSON.stringify({
          userPsid,
          username,
          token,
          responseType
        })
      }

      await actionProcessor.fbOptInOneTime(action)

      expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([expected])
    })
  })

  describe('FB_OPT_IN_RECURRING', () => {
    const action = {
      userId: 'FB-102402752351760',
      type: 'FB_OPT_IN_RECURRING',
      failure: [],
      success: [
        {
          type: 'SEND_FACEBOOK_MESSAGE',
          message: {
            message: {
              text:
                'Hello Michael G. Thomas! this is your opt-in confirmation response when you opted in at 1656416291769 !'
            },
            recipient: {
              id: '4137552649681107'
            },
            messaging_type: 'RESPONSE'
          }
        }
      ],
      userPsId: '4137552649681107',
      username:
        'dae5082d8f6244cdd956e2b2ab470e7f54bd021464477bf6f34ce22fdcb97a9c91b80b6188a688552ab7f9788131af08df9858bc747379144a86a0e0e9adb5b45495f23914f4e22c50d89a58db3afd3d55e7e70e198e601ce8e4a61126fab11dc25526bf96888e4f42d6c4edd0b0fc290a',
      responseType: 'ONE_TIME_REMINDER',
      widgetId: 'fb-optin',
      token: '6177341647910041736',
      tokenExpirtyTimestamp: '1234'
    }
    it('should call FB subscription endpoint with the correct options', async () => {
      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 200
      })
      simple.mock(db, 'getFbParticipants', () => Promise.resolve([[]]))
      const {
        widgetId,
        userId,
        userPsid,
        username,
        token,
        responseType,
        tokenExpiryTimestamp
      } = action

      const expected = {
        widgetId,
        userId,
        method: 'POST',
        url: `${process.env.FACEBOOK_SUBSCRIPTION_URL}/participants/${action.widgetId}`,
        body: JSON.stringify({
          userPsid,
          username,
          token,
          responseType,
          tokenExpiryTimestamp
        })
      }

      await actionProcessor.fbOptInRecurring(action)

      expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([expected])
    })
  })

  describe('FB_OPT_OUT_ONE_TIME', () => {
    const action = {
      type: 'FB_OPT_OUT_ONE_TIME',
      failure: [],
      success: [
        {
          type: 'SEND_FACEBOOK_MESSAGE',
          message: {
            message: {
              text:
                'Sorry to see you changed your mind from that other time: ${timestamp}! You are successfully opted out.'
            },
            recipient: {
              id: '4137552649681107'
            },
            messaging_type: 'RESPONSE'
          }
        }
      ],
      userPsid: '10855ed5-c90c-4507-9ace-570bd1aa3568',
      widgetId: 'a000c430-0d90-11ed-89b1-42010a840093'
    }
    it('should call FB subscription endpoint with the correct options', async () => {
      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 200
      })
      simple.mock(db, 'getFbParticipants', () => Promise.resolve([]))

      const { widgetId, userId, userPsid } = action

      const expected = {
        widgetId,
        userId,
        method: 'DELETE',
        url: `${process.env.FACEBOOK_SUBSCRIPTION_URL}/participants/${widgetId}/optout/${userPsid}`
      }

      await actionProcessor.fbOptOut(action)

      expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([expected])
    })
  })

  describe('SEND_FACEBOOK_BLAST', () => {
    const action = {
      type: 'SEND_FACEBOOK_BLAST',
      message: {
        message: {
          text:
            'Thank you for participating ${senderName}! Here is your reminder!'
        }
      },
      expiration: 1677750360000,
      widgetId: 'fb-optin-image'
    }
    it('should call the 🐙 Kraken 🐙 endpoint with the correct options for one-time blasts', async () => {
      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 200
      })
      const {
        widgetId,
        userId,
        message: { message }
      } = action

      const expected = {
        widgetId,
        userId,
        method: 'POST',
        url: `${process.env.KRAKEN_URL}/release-facebook/${action.widgetId}`,
        body: JSON.stringify({ message })
      }

      await actionProcessor.sendFacebookBlast(action)

      expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([expected])
    })

    it('should call the 🐙 Kraken 🐙 endpoint with the correct options for recurring blasts', async () => {
      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 200
      })
      const recurringBlastAction = {
        ...action,
        frequency: 'DAILY'
      }
      const {
        widgetId,
        userId,
        message: { message },
        frequency
      } = recurringBlastAction

      const expected = {
        widgetId,
        userId,
        method: 'POST',
        url: `${process.env.KRAKEN_URL}/release-facebook/${recurringBlastAction.widgetId}`,
        body: JSON.stringify({ message, frequency })
      }

      await actionProcessor.sendFacebookBlast(recurringBlastAction)

      expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([expected])
    })
  })
})
