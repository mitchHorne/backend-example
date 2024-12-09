/* eslint-disable no-template-curly-in-string */
const { assert, expect } = require('chai')
const simple = require('simple-mock')
const nock = require('nock')
const R = require('ramda')

const { logger, metrics } = require('@bluerobot/monitoring')

const db = require('../app/db')
const twitter = require('../app/twitter')
const utils = require('../app/utils')
const email = require('../app/email')
const endpoints = require('../app/endpoints')
const lookup = require('../app/lookup')
const instagram = require('../app/instagram')
const facebook = require('../app/facebook')

const actionProcessor = require('../app/action-processor')
const { processAction } = require('../app/action-processor')
const crypt = require('@bluerobot/crypt-keeper')

describe('action-processor', () => {
  afterEach(() => {
    simple.restore()
  })

  describe('processAction', () => {
    const attachmentUrl = 'http://t.co'
    const cardUri = 'card://853503245793641682'

    afterEach(() => {
      simple.restore()
      nock.cleanAll()
    })

    it('should call this.sendTweet for SEND_TWEET actions', () => {
      const action = {
        type: 'SEND_TWEET',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        text: 'text',
        media: ['mediaId'],
        userId: '123'
      }

      const data = [
        [
          {
            rateLimited: 0
          }
        ]
      ]
      simple.mock(db, 'getUserRateLimit').resolveWith(data)
      simple.mock(twitter, 'sendTweet').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(twitter.sendTweet.called)
        const actual = twitter.sendTweet.lastCall.arg
        const expected = {
          token: 'token',
          secret: 'secret',
          text: 'text',
          media: ['mediaId'],
          userId: '123'
        }
        assert.deepEqual(actual, expected)
      })
    })

    it('should call utils.delayAction if SEND_TWEET is rate limited', () => {
      const action = {
        type: 'SEND_TWEET',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        text: 'text',
        media: ['mediaId'],
        userId: '123'
      }
      const expectedArgs = {
        action,
        limitResetAt: 1
      }
      simple.mock(db, 'getUserRateLimit').resolveWith(1)
      simple.mock(utils, 'delayAction').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(db.getUserRateLimit.called)
        assert.deepEqual(db.getUserRateLimit.lastCall.args[0], {
          userId: action.userId,
          platform: 'TWITTER',
          method: 'POST',
          endpoint: 'statuses/update'
        })

        assert(utils.delayAction.called)
        assert.deepEqual(utils.delayAction.lastCall.args[0], expectedArgs)
      })
    })

    it('should call this.deleteTweet for DELETE_TWEET actions', () => {
      const action = {
        type: 'DELETE_TWEET',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        tweetId: 'tweet-id',
        userId: '123'
      }

      const data = [
        [
          {
            rateLimited: 0
          }
        ]
      ]
      simple.mock(db, 'getUserRateLimit').resolveWith(data)
      simple.mock(twitter, 'deleteTweet').resolveWith()
      simple.mock(db, 'deleteTweet').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(twitter.deleteTweet.called)
        const actual = twitter.deleteTweet.lastCall.arg
        const expected = {
          token: 'token',
          secret: 'secret',
          userId: '123',
          tweetId: 'tweet-id'
        }
        assert.deepEqual(actual, expected)
      })
    })

    it('should call utils.delayAction if DELETE_TWEET is rate limited', () => {
      const action = {
        type: 'DELETE_TWEET',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        userId: '123',
        tweetId: 'tweet-id'
      }
      const expectedArgs = {
        action,
        limitResetAt: 1
      }
      simple.mock(db, 'getUserRateLimit').resolveWith(1)
      simple.mock(utils, 'delayAction').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(db.getUserRateLimit.called)
        assert.deepEqual(db.getUserRateLimit.lastCall.args[0], {
          userId: action.userId,
          platform: 'TWITTER',
          method: 'POST',
          endpoint: 'statuses/destroy'
        })

        assert(utils.delayAction.called)
        assert.deepEqual(utils.delayAction.lastCall.args[0], expectedArgs)
      })
    })

    it('should call twitter.sendDm for SEND_DM actions', () => {
      const action = {
        type: 'SEND_DM',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        recipientId: 'recipient_id',
        text: 'text',
        media: ['mediaId'],
        quickReply: [],
        ctas: [],
        userId: '123',
        customProfileId: '321'
      }
      const data = [
        [
          {
            rateLimited: 0
          }
        ]
      ]
      simple.mock(db, 'getUserRateLimit').resolveWith(data)
      simple.mock(twitter, 'sendDm').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(twitter.sendDm.called)
        const args = twitter.sendDm.lastCall.args
        const actual = args
        const expected = [
          {
            token: 'token',
            secret: 'secret',
            recipientId: 'recipient_id',
            text: 'text',
            quickReply: [],
            ctas: [],
            media: ['mediaId'],
            userId: '123',
            customProfileId: '321'
          }
        ]
        assert.deepEqual(actual, expected)
      })
    })

    it('should call twitter.sendReply for SEND_REPLY actions', () => {
      const action = {
        type: 'SEND_REPLY',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        replyToStatusId: 'id',
        text: 'text',
        media: ['mediaId'],
        userId: '123'
      }
      simple.mock(db, 'getUserRateLimit').resolveWith(0)
      simple.mock(twitter, 'sendReply').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(twitter.sendReply.called)

        const args = twitter.sendReply.lastCall.args
        const actual = args
        const expected = [
          {
            token: 'token',
            secret: 'secret',
            text: 'text',
            media: ['mediaId'],
            statusId: 'id',
            userId: '123'
          }
        ]
        assert.deepEqual(actual, expected)
      })
    })

    it('should call utils.delayAction if SEND_REPLY is rate limited', () => {
      const action = {
        type: 'SEND_REPLY',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        replyToStatusId: 'id',
        text: 'text',
        media: ['mediaId'],
        userId: '123'
      }
      const expectedArgs = {
        action,
        limitResetAt: 1
      }
      simple.mock(db, 'getUserRateLimit').resolveWith(1)
      simple.mock(utils, 'delayAction').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(db.getUserRateLimit.called)
        assert.deepEqual(db.getUserRateLimit.lastCall.args[0], {
          userId: action.userId,
          platform: 'TWITTER',
          method: 'POST',
          endpoint: 'statuses/update'
        })

        assert(utils.delayAction.called)
        assert.deepEqual(utils.delayAction.lastCall.args[0], expectedArgs)
      })
    })

    it('should call email.send for SEND_EMAIL actions', () => {
      const action = {
        type: 'SEND_EMAIL',
        recipients: {
          to: 'to',
          cc: 'cc',
          bcc: 'bcc'
        },
        subject: 'subject',
        body: 'text',
        media: ['media urls']
      }
      simple.mock(email, 'send').resolveWith()

      actionProcessor.processAction(action)

      assert(email.send.called)

      const args = email.send.lastCall.args
      const actual = args
      const expected = [
        {
          to: 'to',
          cc: 'cc',
          bcc: 'bcc',
          subject: 'subject',
          text: 'text',
          attachments: ['media urls']
        }
      ]
      assert.deepEqual(actual, expected)
    })

    it('should call endpoints.callEndpoint for CALL_ENDPOINT actions', () => {
      const userId = 'a-user'
      const action = {
        userId,
        type: 'CALL_ENDPOINT',
        method: 'method',
        url: 'url',
        headers: {},
        body: 'a body',
        timeout: '123',
        retryStatuses: '321',
        auth: {
          username: 'user',
          password: 'pass'
        },
        query: {
          param: 'param'
        },
        form: {
          param: 'param'
        },
        retry: true
      }
      simple.mock(endpoints, 'callEndpoint').resolveWith()

      actionProcessor.processAction(action)

      assert(endpoints.callEndpoint.called)

      const args = endpoints.callEndpoint.lastCall.args
      const actual = args
      const expected = [
        {
          userId,
          method: 'method',
          url: 'url',
          headers: {},
          body: 'a body',
          timeout: '123',
          retryStatuses: '321',
          auth: {
            username: 'user',
            password: 'pass'
          },
          query: {
            param: 'param'
          },
          form: {
            param: 'param'
          },
          retryRemaining: 100
        }
      ]
      assert.deepEqual(actual, expected)
    })

    it('should call endpoints.callEndpoint for DASHBOT_TRACK actions', () => {
      const userId = '345678'
      const action = {
        type: 'DASHBOT_TRACK',
        apiKey: 'api_key_for_dashbot_track',
        platform: 'twitter',
        platformJson: {
          twitterActivity: 'should be in here'
        },
        userId,
        text: 'the original tweet text'
      }
      simple.mock(endpoints, 'callEndpoint').resolveWith()
      simple.mock(process.env, 'DASHBOT_API_VERSION', 'v12')

      actionProcessor.processAction(action)

      assert(endpoints.callEndpoint.called)

      const args = endpoints.callEndpoint.lastCall.args
      const actual = args
      const expected = [
        {
          userId,
          body: {
            platformJson: action.platformJson,
            userId: action.userId,
            text: action.text
          },
          method: 'POST',
          query: {
            apiKey: 'api_key_for_dashbot_track',
            platform: 'twitter',
            type: 'incoming',
            v: 'v12'
          },
          retryRemaining: 100,
          url: 'https://tracker.dashbot.io/track'
        }
      ]
      assert.deepEqual(actual, expected)
    })

    it('should call endpoints.callEndpoint for CHATBASE_TRACK actions', () => {
      const userId = '345678'
      const action = {
        type: 'CHATBASE_TRACK',
        message: 'the original tweet text',
        userId,
        timestamp: '1234567890',
        intent: 'the_dialog_flow_intent_name',
        platform: 'twitter',
        apiKey: 'api_key_for_chatbase_track'
      }
      simple.mock(endpoints, 'callEndpoint').resolveWith()

      actionProcessor.processAction(action)

      assert(endpoints.callEndpoint.called)

      const args = endpoints.callEndpoint.lastCall.args
      const actual = args
      const expected = [
        {
          userId,
          body: {
            message: 'the original tweet text',
            user_id: '345678',
            time_stamp: '1234567890',
            intent: 'the_dialog_flow_intent_name',
            platform: 'twitter',
            api_key: 'api_key_for_chatbase_track',
            type: 'user'
          },
          method: 'POST',
          retryRemaining: 100,
          url: 'https://chatbase.com/api/message'
        }
      ]
      assert.deepEqual(actual, expected)
    })

    it('should call endpoints.callEndpoint for GOOGLE_ANALYTICS_TRACK_EVENT actions', () => {
      const action = {
        type: 'GOOGLE_ANALYTICS_TRACK_EVENT',
        url: 'https://www.google-analytics.com/collect',
        method: 'POST',
        query: {
          v: 1,
          cid: 'widget_id-123',
          t: 'event',
          tid: 'UA-151748730-1',
          ec: 'Twitter dm',
          ea: 'Record',
          el: 'Return of the king'
        }
      }
      simple.mock(endpoints, 'callEndpoint').resolveWith()

      actionProcessor.processAction(action)

      assert(endpoints.callEndpoint.called)

      const args = endpoints.callEndpoint.lastCall.args
      const actual = args
      const expected = [
        {
          query: {
            v: 1,
            cid: 'widget_id-123',
            t: 'event',
            tid: 'UA-151748730-1',
            ec: 'Twitter dm',
            ea: 'Record',
            el: 'Return of the king'
          },
          method: 'POST',
          retryRemaining: 100,
          url: 'https://www.google-analytics.com/collect'
        }
      ]
      assert.deepEqual(actual, expected)
    })

    it('should call db.insert for DATASET_INSERT actions', () => {
      const action = {
        type: 'DATASET_INSERT',
        dataset: 'd',
        data: 'data'
      }
      simple.mock(db, 'insert').resolveWith()

      actionProcessor.processAction(action)

      assert(db.insert.called)

      const args = db.insert.lastCall.args
      const actual = args
      const expected = [
        {
          dataset: 'd',
          data: 'data'
        }
      ]
      assert.deepEqual(actual, expected)
    })

    it('should call db.update for DATASET_UPDATE actions', () => {
      const action = {
        type: 'DATASET_UPDATE',
        dataset: 'dataset',
        column: 'column',
        value: 'value',
        searchColumn: 'searchColumn',
        searchKey: 'searchKey',
        insertIfNotExist: false
      }
      simple.mock(db, 'update').resolveWith()

      actionProcessor.processAction(action)

      assert(db.update.called)

      const args = db.update.lastCall.args
      const actual = args
      const expected = [
        {
          dataset: 'dataset',
          column: 'column',
          value: 'value',
          searchColumn: 'searchColumn',
          searchKey: 'searchKey',
          insertIfNotExist: false
        }
      ]

      assert.deepEqual(actual, expected)
    })

    it('should call this.sendDarkTweet for SEND_DARK_TWEET actions', () => {
      const action = {
        type: 'SEND_DARK_TWEET',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        text: 'text',
        media: ['mediaId'],
        userId: '123',
        attachmentUrl,
        cardUri
      }
      simple.mock(db, 'getUserRateLimit').resolveWith(0)
      simple.mock(twitter, 'sendDarkTweet').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(twitter.sendDarkTweet.called)

        const args = twitter.sendDarkTweet.lastCall.args
        const actual = args
        const expected = [
          {
            token: 'token',
            secret: 'secret',
            text: 'text',
            media: ['mediaId'],
            userId: '123',
            attachmentUrl,
            cardUri
          }
        ]
        assert.deepEqual(actual, expected)
      })
    })

    it('should call utils.delayAction if SEND_DARK_TWEET is rate limited', () => {
      const action = {
        type: 'SEND_DARK_TWEET',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        text: 'text',
        media: ['mediaId'],
        userId: '123',
        attachmentUrl,
        cardUri
      }
      const expectedArgs = {
        action,
        limitResetAt: 1
      }
      simple.mock(db, 'getUserRateLimit').resolveWith(1)
      simple.mock(utils, 'delayAction').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(db.getUserRateLimit.called)
        assert.deepEqual(db.getUserRateLimit.lastCall.args[0], {
          userId: action.userId,
          platform: 'TWITTER',
          method: 'POST',
          endpoint: 'statuses/update'
        })

        assert(utils.delayAction.called)
        assert.deepEqual(utils.delayAction.lastCall.args[0], expectedArgs)
      })
    })

    it('should call this.sendDarkReply for SEND_DARK_REPLY actions', () => {
      const action = {
        type: 'SEND_DARK_REPLY',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        text: 'text',
        media: ['mediaId'],
        replyToStatusId: '1',
        userId: '123',
        attachmentUrl,
        cardUri
      }
      simple.mock(db, 'getUserRateLimit').resolveWith(0)
      simple.mock(twitter, 'sendDarkReply').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(twitter.sendDarkReply.called)

        const args = twitter.sendDarkReply.lastCall.args
        const actual = args
        const expected = [
          {
            token: 'token',
            secret: 'secret',
            text: 'text',
            media: ['mediaId'],
            statusId: '1',
            userId: '123',
            attachmentUrl,
            cardUri
          }
        ]
        assert.deepEqual(actual, expected)
      })
    })

    it('should call this.hideTwitterReply for HIDE_TWITTER_REPLY actions', () => {
      simple.mock(crypt, 'decrypt').returnWith('decrypted-thing')
      simple.mock(db, 'storeHiddenTweet').resolveWith({})
      const action = {
        type: 'HIDE_TWITTER_REPLY',
        twitterAccessTokens: {
          token: 'the-token',
          secret: 'the-secret'
        },
        replyFromUserId: '1038012925657657344',
        userId: 'FB-105060699031754',
        handle: 'MichaelGarthT',
        tweetId: '1760196424124260546',
        eventText: '@BusinessCorne #AutomationTestOptinWGF62XS83U3U1WLUYMQ5',
        replyCreatedAt: '1708501626218',
        widgetId: '1'
      }

      const tweetId = '1760196424124260546'
      const url = 'https://api.twitter.com/2'
      const path = `/tweets/${tweetId}/hidden`

      const twitterCalled = nock(url)
        .put(path, { hidden: true })
        .reply(200, { data: { hidden: true } })

      return actionProcessor.processAction(action).then(() => {
        assert(twitterCalled.isDone())
        const dbArgs = db.storeHiddenTweet.lastCall.args
        const expected = [
          {
            widgetId: '1',
            userId: '1038012925657657344',
            userHandle: 'MichaelGarthT',
            tweetId: '1760196424124260546',
            eventText:
              '@BusinessCorne #AutomationTestOptinWGF62XS83U3U1WLUYMQ5',
            createdAt: '1708501626218',
            replyText: '@BusinessCorne #AutomationTestOptinWGF62XS83U3U1WLUYMQ5'
          }
        ]
        assert.deepEqual(dbArgs, expected)
      })
    })

    it('should call utils.delayAction if SEND_DARK_REPLY is rate limited', () => {
      const action = {
        type: 'SEND_DARK_REPLY',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        text: 'text',
        media: ['mediaId'],
        replyToStatusId: '1',
        userId: '123',
        attachmentUrl,
        cardUri
      }
      const expectedArgs = {
        action,
        limitResetAt: 1
      }
      simple.mock(db, 'getUserRateLimit').resolveWith(1)
      simple.mock(utils, 'delayAction').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(db.getUserRateLimit.called)
        assert.deepEqual(db.getUserRateLimit.lastCall.args[0], {
          userId: action.userId,
          platform: 'TWITTER',
          method: 'POST',
          endpoint: 'statuses/update'
        })

        assert(utils.delayAction.called)
        assert.deepEqual(utils.delayAction.lastCall.args[0], expectedArgs)
      })
    })

    it('should delay if action has a delay', () => {
      const action = { delay: 500 }

      const delayParam = simple.mock().resolveWith()

      return actionProcessor
        .processAction(action, {}, { delayParam })
        .catch(_ => {
          expect(delayParam.lastCall.args).to.deep.equal([500])
        })
    })

    it('should return a rejected promise if an unknown action is sent', () => {
      const action = {
        type: 'UNKNOWN'
      }

      return actionProcessor
        .processAction(action)
        .then(() => assert.fail('Promise not rejected'))
        .catch(error =>
          assert.equal(error.message, 'Action not recognized: UNKNOWN')
        )
    })

    it('should call utils.delayAction if SEND_DM is rate limited', () => {
      const action = {
        userId: 'some id',
        type: 'SEND_DM'
      }
      const expectedArgs = {
        action,
        limitResetAt: 1
      }
      simple.mock(db, 'getUserRateLimit').resolveWith(1)
      simple.mock(utils, 'delayAction').resolveWith()

      return actionProcessor.processAction(action).then(() => {
        assert(db.getUserRateLimit.called)
        assert.deepEqual(db.getUserRateLimit.lastCall.args[0], {
          userId: action.userId,
          platform: 'TWITTER',
          method: 'POST',
          endpoint: 'direct_messages/events/new'
        })

        assert(utils.delayAction.called)
        assert.deepEqual(utils.delayAction.lastCall.args[0], expectedArgs)
      })
    })

    it('Should call sendWhatsappMessage for SEND_WHATSAPP_MESSAGE actions', async () => {
      simple.mock(actionProcessor, 'sendWhatsappMessage').resolveWith()

      const action = {
        type: 'SEND_WHATSAPP_MESSAGE'
      }

      await actionProcessor.processAction(action)

      expect(actionProcessor.sendWhatsappMessage.lastCall.args).to.deep.equal([
        action
      ])
    })

    it('Should call lookupApi for LOOKUP_API actions', async () => {
      simple.mock(actionProcessor, 'lookupApi').resolveWith()

      const action = {
        type: 'LOOKUP_API'
      }

      await actionProcessor.processAction(action)

      expect(actionProcessor.lookupApi.lastCall.args).to.deep.equal([action])
    })

    it('Should call sendInstagramMessage for SEND_INSTAGRAM_MESSAGE actions', async () => {
      simple.mock(actionProcessor, 'sendInstagramMessage').resolveWith()

      const action = {
        type: 'SEND_INSTAGRAM_MESSAGE'
      }

      await actionProcessor.processAction(action)

      expect(actionProcessor.sendInstagramMessage.lastCall.args).to.deep.equal([
        action
      ])
    })

    it('Should call sendFacebookMessage for SEND_FACEBOOK_MESSAGE actions', async () => {
      simple.mock(actionProcessor, 'sendFacebookMessage').resolveWith()

      const action = {
        type: 'SEND_FACEBOOK_MESSAGE',
        message: {
          message: {
            text: 'This is a DM for the user!'
          },
          recipient: {
            comment_id: '2312453318786367_5339623706069298'
          },
          messaging_type: 'RESPONSE'
        }
      }

      await actionProcessor.processAction(action)

      expect(actionProcessor.sendFacebookMessage.lastCall.args).to.deep.equal([
        action
      ])
    })

    it('Should call fbOptInOneTime for FB_OPT_IN_ONE_TIME actions', async () => {
      simple.mock(facebook, 'fbOptInOneTime').resolveWith()
      simple.mock(db, 'getFbParticipants', () => Promise.resolve([[]]))

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
        token: '6177341647910041736',
        createdAt: '1656416291769'
      }

      await actionProcessor.processAction(action)

      expect(facebook.fbOptInOneTime.lastCall.args).to.deep.equal([action])
    })

    it('Should not call fbOptInOneTime for FB_OPT_IN_ONE_TIME actions if already opted in', async () => {
      simple.mock(facebook, 'fbOptInOneTime').resolveWith()
      simple.mock(db, 'getFbParticipants', () => Promise.resolve([['12345']]))

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
        token: '6177341647910041736',
        createdAt: '1656416291769'
      }

      await actionProcessor.processAction(action)

      expect(facebook.fbOptInOneTime.calls.length).to.equal(0)
    })

    it('Should call fbOptOut for FB_OPT_OUT_ONE_TIME actions', async () => {
      simple.mock(facebook, 'fbOptOut').resolveWith()

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

      await actionProcessor.processAction(action)

      expect(facebook.fbOptOut.lastCall.args).to.deep.equal([action])
    })

    it('Should call fbOptInRecurring for FB_OPT_IN_RECURRING actions', async () => {
      simple.mock(facebook, 'fbOptInRecurring').resolveWith()
      simple.mock(db, 'getFbParticipants', () => Promise.resolve([[]]))

      const action = {
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
        userPsid: '123456789',
        username: '987654321',
        responseType: 'RECURRING_REMINDER',
        widgetId: '12345',
        token: '1234567890',
        tokenExpiryTimestamp: '16843143145230'
      }

      await actionProcessor.processAction(action)

      expect(facebook.fbOptInRecurring.lastCall.args).to.deep.equal([action])
    })

    it('Should call fbOptInRecurring for FB_OPT_IN_RECURRING regardless of user already opted in', async () => {
      simple.mock(facebook, 'fbOptInRecurring').resolveWith()
      simple.mock(db, 'getFbParticipants').resolveWith()

      const action = {
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
        userPsid: '123456789',
        username: '987654321',
        responseType: 'RECURRING_REMINDER',
        widgetId: '12345',
        token: '1234567890',
        tokenExpiryTimestamp: '16843143145230'
      }

      await actionProcessor.processAction(action)

      expect(db.getFbParticipants.calls.length).to.equal(0)

      expect(facebook.fbOptInRecurring.calls.length).to.equal(1)
      expect(facebook.fbOptInRecurring.lastCall.args).to.deep.equal([action])
    })

    it('Should call fbOptOut for FB_OPT_OUT_ONE_RECURRING actions', async () => {
      simple.mock(facebook, 'fbOptOut').resolveWith()

      const action = {
        type: 'FB_OPT_OUT_RECURRING',
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

      await actionProcessor.processAction(action)

      expect(facebook.fbOptOut.lastCall.args).to.deep.equal([action])
    })

    it('Should call sendFacebookBlast for SEND_FACEBOOK_BLAST actions', async () => {
      simple.mock(facebook, 'sendFacebookBlast').resolveWith()

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

      await actionProcessor.processAction(action)

      expect(facebook.sendFacebookBlast.lastCall.args).to.deep.equal([action])
    })

    it('Should call sendFacebookComment for SEND_FACEBOOK_COMMENT actions', async () => {
      simple.mock(actionProcessor, 'sendFacebookComment').resolveWith()

      const action = {
        type: 'SEND_FACEBOOK_COMMENT',
        objectId: 'comment-or-post-id',
        message: {
          type: 'SEND_FACEBOOK_COMMENT',
          message: {
            message: 'This is a plain text response'
          }
        }
      }

      await actionProcessor.processAction(action)

      expect(actionProcessor.sendFacebookComment.lastCall.args).to.deep.equal([
        action
      ])
    })

    describe('SEND_BLAST', () => {
      afterEach(() => {
        simple.restore()
      })

      const widgetId = 'kraken-widget'
      const message = 'some message'
      const media = ['some media']

      it('should call sendBlast with action', () => {
        const action = {
          type: 'SEND_BLAST',
          widgetId,
          message,
          media,
          attachmentUrl,
          cardUri
        }

        simple.mock(endpoints, 'callEndpoint').resolveWith()
        simple.mock(actionProcessor, 'sendBlast').resolveWith()

        actionProcessor.processAction(action)

        expect(actionProcessor.sendBlast.called).to.equal(true)
        const [option] = actionProcessor.sendBlast.lastCall.args
        expect(option).to.deep.equal(action)
      })

      it('should call sendBlast with widgetId', () => {
        const action = {
          type: 'SEND_BLAST',
          widgetId,
          message,
          media,
          attachmentUrl,
          cardUri
        }

        simple.mock(endpoints, 'callEndpoint').resolveWith()
        simple.mock(actionProcessor, 'sendBlast').resolveWith()

        actionProcessor.processAction(action)

        expect(actionProcessor.sendBlast.called).to.equal(true)
        const [options] = actionProcessor.sendBlast.lastCall.args
        expect(options.widgetId).to.deep.equal(widgetId)
      })

      it("should call the blast processor ('The Kraken' 🦑) service to trigger the Tweet blast", () => {
        const quickReply = {
          type: 'options',
          options: [{ label: 'Red Bird', metadata: 'external_id_1' }]
        }
        const ctas = [
          {
            type: 'web_url',
            label: 'Blue Robot Website',
            url: 'http://bluerobot.com'
          }
        ]
        const userId = 'a-user'
        const action = {
          userId,
          type: 'SEND_BLAST',
          widgetId,
          message,
          media,
          attachmentUrl,
          cardUri,
          quickReply,
          ctas
        }
        const krakenUrl = 'http://kraken-my-biscuit'
        simple.mock(process.env, 'KRAKEN_URL', krakenUrl)
        simple.mock(endpoints, 'callEndpoint').resolveWith()

        actionProcessor.sendBlast(action, {
          krakenUrl
        })

        expect(endpoints.callEndpoint.called).to.equal(true)
        expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([
          {
            userId,
            method: 'POST',
            url: krakenUrl,
            timeout: 60000,
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              userId,
              widgetId,
              message,
              media,
              attachmentUrl,
              cardUri,
              quickReply,
              ctas
            })
          }
        ])
      })
    })

    describe('SEND_BLAST_BATCH', () => {
      const channel = {
        publish: simple.mock()
      }

      afterEach(() => {
        simple.restore()
      })

      it('should publish the received action to the kraken', () => {
        const expectedPayload = {
          type: 'SEND_BLAST_BATCH',
          widgetId: 'a-widget-id',
          widgetOwnerId: 'widget-owner-id',
          participantIndex: 0,
          count: 100,
          twitterAccessTokens: {
            token: 'a-token',
            secret: 'a-super-secret'
          }
        }

        const expectedChannelPublishArgs = [
          'bluerobot',
          'actions.blastbatch.a-widget-id',
          Buffer.from(JSON.stringify(expectedPayload))
        ]

        return actionProcessor
          .processAction(expectedPayload, channel)
          .then(() => {
            assert(channel.publish.called)

            const actual = channel.publish.lastCall.args
            assert.deepEqual(actual, expectedChannelPublishArgs)
          })
      })
    })

    describe('OPT_IN', () => {
      afterEach(() => {
        simple.restore()
      })

      const widgetId = 'subscription-widgetId'
      const userId = 'userId'
      const handle = '@testHandle'
      const responseType = 'SEND_DARK_TWEET'
      const optinId = 'tweetId'

      it('should call optIn with action', () => {
        const action = {
          type: 'OPT_IN',
          widgetId,
          userId,
          handle,
          responseType,
          optinId
        }

        simple.mock(endpoints, 'callEndpoint').resolveWith()
        simple.mock(actionProcessor, 'optIn').resolveWith()

        actionProcessor.processAction(action)

        expect(actionProcessor.optIn.called).to.equal(true)
        const [option] = actionProcessor.optIn.lastCall.args
        expect(option).to.deep.equal(action)
      })

      it('should call optIn with widgetId', () => {
        const action = {
          type: 'OPT_IN',
          widgetId,
          userId,
          handle,
          responseType,
          optinId
        }

        simple.mock(endpoints, 'callEndpoint').resolveWith()
        simple.mock(actionProcessor, 'optIn').resolveWith()

        actionProcessor.processAction(action)

        expect(actionProcessor.optIn.called).to.equal(true)
        const [options] = actionProcessor.optIn.lastCall.args
        expect(options.widgetId).to.deep.equal(widgetId)
      })

      it('should call the subscriptions service to opt the user in', () => {
        const action = {
          type: 'OPT_IN',
          widgetId,
          userId,
          handle,
          responseType,
          optinId
        }

        const subscriptionsUrl = 'http://subscribe-me-please'
        simple.mock(process.env, 'SUBSCRIPTIONS_URL', subscriptionsUrl)
        simple.mock(endpoints, 'callEndpoint').resolveWith()

        actionProcessor.optIn(action, {
          subscriptionsUrl
        })

        expect(endpoints.callEndpoint.called).to.equal(true)
        expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([
          {
            widgetId,
            userId,
            method: 'POST',
            url: `${subscriptionsUrl}/${widgetId}`,
            body: JSON.stringify({
              widgetId,
              userId,
              handle,
              responseType,
              optinId
            })
          }
        ])
      })
    })

    describe('OPT_OUT', () => {
      afterEach(() => {
        simple.restore()
      })

      const widgetId = 'subscription-widgetId'
      const userId = 'userId'

      it('should call optUserOut with action', () => {
        const action = {
          type: 'OPT_OUT',
          widgetId,
          userId
        }

        simple.mock(endpoints, 'callEndpoint').resolveWith()
        simple.mock(actionProcessor, 'optOut').resolveWith()

        actionProcessor.processAction(action)

        expect(actionProcessor.optOut.called).to.equal(true)
        const [option] = actionProcessor.optOut.lastCall.args
        expect(option).to.deep.equal(action)
      })

      it('should call optOut with widgetId', () => {
        const action = {
          type: 'OPT_OUT',
          widgetId,
          userId
        }

        simple.mock(endpoints, 'callEndpoint').resolveWith()
        simple.mock(actionProcessor, 'optOut').resolveWith()

        actionProcessor.processAction(action)

        expect(actionProcessor.optOut.called).to.equal(true)
        const [options] = actionProcessor.optOut.lastCall.args
        expect(options.widgetId).to.deep.equal(widgetId)
      })

      it('should call the subscriptions service to opt the user out', () => {
        const action = {
          type: 'OPT_OUT',
          widgetId,
          userId
        }

        const subscriptionsUrl = 'http://subscribe-me-please'
        simple.mock(process.env, 'SUBSCRIPTIONS_URL', subscriptionsUrl)

        simple.mock(endpoints, 'callEndpoint').resolveWith()
        actionProcessor.optOut(action, {
          subscriptionsUrl
        })

        expect(endpoints.callEndpoint.called).to.equal(true)
        expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([
          {
            method: 'DELETE',
            url: `${subscriptionsUrl}/${widgetId}/${userId}`,
            widgetId,
            userId
          }
        ])
      })
    })

    describe('SEQUENCE', () => {
      afterEach(() => {
        simple.restore()
      })

      it('should reject if no actions array is present', () => {
        const action = {
          type: 'SEQUENCE'
        }

        return actionProcessor.processAction(action).catch(error => {
          expect(error.message).to.equal(
            'Sequence requires a valid array of actions'
          )
        })
      })

      it('should reject if actions is not an array', () => {
        const action = {
          type: 'SEQUENCE',
          actions: {}
        }

        return actionProcessor.processAction(action).catch(error => {
          expect(error.message).to.equal(
            'Sequence requires a valid array of actions'
          )
        })
      })

      it('should not allow sequence of sequence', () => {
        const action = {
          type: 'SEQUENCE',
          actions: [
            {
              type: 'SEQUENCE',
              actions: []
            }
          ]
        }

        return actionProcessor
          .processAction(action)
          .then(() => expect.fail())
          .catch(error => {
            expect(error.message).to.equal(
              'Sequence cannot contain a sequence of actions'
            )
          })
      })

      it('should call process action sequentially for each action', () => {
        const action = {
          type: 'SEND_DM',
          twitterAccessTokens: {
            token: 'token',
            secret: 'secret'
          },
          recipientId: 'recipient_id',
          text: 'first',
          media: ['mediaId'],
          quickReply: [],
          ctas: [],
          userId: '123',
          customProfileId: '321'
        }

        const actions = [
          action,
          { ...action, text: 'second' },
          { ...action, text: 'third' }
        ]

        simple
          .mock(actionProcessor, 'sendDm')
          .resolveWith('first')
          .resolveWith('second')
          .resolveWith('third')

        return actionProcessor
          .processAction({ type: 'SEQUENCE', actions })
          .then(result => {
            const sendDm = actionProcessor.sendDm
            expect(sendDm.callCount).to.equal(3)
            sendDm.calls.forEach((call, ix) => {
              expect(R.head(call.args)).to.deep.equal(actions[ix])
            })

            expect(result).to.deep.equal(['first', 'second', 'third'])
          })
      })

      it('should reject on individual action error', () => {
        const action = {
          type: 'SEND_DM',
          twitterAccessTokens: {
            token: 'token',
            secret: 'secret'
          },
          recipientId: 'recipient_id',
          text: 'first',
          media: ['mediaId'],
          quickReply: [],
          ctas: [],
          userId: '123',
          customProfileId: '321'
        }

        const actions = [
          action,
          { ...action, text: 'second' },
          { ...action, text: 'third' }
        ]

        simple
          .mock(actionProcessor, 'sendDm')
          .resolveWith('first')
          .rejectWith(new Error('oops!'))
          .resolveWith('third')

        return actionProcessor
          .processAction({ type: 'SEQUENCE', actions })
          .then(() => {
            assert.fail('test should have thrown an error')
          })
          .catch(error => {
            expect(actionProcessor.sendDm.callCount).to.equal(2)
            expect(error.message).to.equal('oops!')
          })
      })

      it('should include userId in sub-actions', () => {
        const subAction = {
          type: 'SEND_DM'
        }
        const actions = [subAction]
        const userId = '123'
        simple.mock(actionProcessor, 'sendDm').resolveWith()

        return actionProcessor
          .processAction({ type: 'SEQUENCE', actions, userId })
          .then(() => {
            expect(actionProcessor.sendDm.lastCall.args).to.deep.equal([
              { ...subAction, userId }
            ])
          })
      })
    })

    describe('INDICATE_TYPING', () => {
      beforeEach(() => {
        simple.restore()
      })

      it('should call twitter.indicateTyping for INDICATE_TYPING actions', () => {
        const action = {
          type: 'INDICATE_TYPING',
          twitterAccessTokens: {
            token: 'token',
            secret: 'secret'
          },
          recipientId: 'recipient_id',
          userId: '123'
        }
        const data = [
          [
            {
              rateLimited: 0
            }
          ]
        ]
        simple.mock(db, 'getUserRateLimit').resolveWith(data)
        simple.mock(twitter, 'indicateTyping').resolveWith()

        return actionProcessor.processAction(action).then(() => {
          assert(twitter.indicateTyping.called)
          const args = twitter.indicateTyping.lastCall.args
          const actual = args
          const expected = [
            {
              token: 'token',
              secret: 'secret',
              recipientId: 'recipient_id',
              userId: '123'
            }
          ]
          assert.deepEqual(actual, expected)
        })
      })

      it('should call utils.delayAction if INDICATE_TYPING is rate limited', () => {
        const action = {
          userId: 'some id',
          type: 'INDICATE_TYPING'
        }
        const expectedArgs = {
          action,
          limitResetAt: 1
        }
        simple.mock(db, 'getUserRateLimit').resolveWith(1)
        simple.mock(utils, 'delayAction').resolveWith()

        return actionProcessor.processAction(action).then(() => {
          assert(db.getUserRateLimit.called)
          assert.deepEqual(db.getUserRateLimit.lastCall.args[0], {
            userId: action.userId,
            platform: 'TWITTER',
            method: 'POST',
            endpoint: 'direct_messages/indicate_typing'
          })

          assert(utils.delayAction.called)
          assert.deepEqual(utils.delayAction.lastCall.args[0], expectedArgs)
        })
      })
    })

    describe('SEND_FEEDBACK_REQUEST', () => {
      beforeEach(() => {
        simple.restore()
      })

      const action = {
        type: 'SEND_FEEDBACK_REQUEST',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        feedbackType: 'nps',
        displayName: 'a  display name',
        externalId: '1234',
        message: 'Hello @furni!',
        privacyUrl: 'not.asprivate.net',
        failureMessage: 'Aha it has failed!',
        questionVariantId: '0',
        test: 'true',
        toUserId: '1234',
        userId: 'some id'
      }

      it('should call twitter.requestFeedback for SEND_FEEDBACK_REQUEST actions', () => {
        const data = [
          [
            {
              rateLimited: 0
            }
          ]
        ]
        simple.mock(db, 'getUserRateLimit').resolveWith(data)
        simple.mock(twitter, 'requestFeedback').resolveWith()

        return actionProcessor.processAction(action).then(() => {
          assert(twitter.requestFeedback.called)
          const args = twitter.requestFeedback.lastCall.args
          const actual = args
          const expected = [
            {
              type: 'SEND_FEEDBACK_REQUEST',
              twitterAccessTokens: {
                token: 'token',
                secret: 'secret'
              },
              feedbackType: 'nps',
              displayName: 'a  display name',
              externalId: '1234',
              message: 'Hello @furni!',
              privacyUrl: 'not.asprivate.net',
              failureMessage: 'Aha it has failed!',
              questionVariantId: '0',
              test: 'true',
              toUserId: '1234',
              userId: 'some id'
            }
          ]
          assert.deepEqual(actual, expected)
        })
      })

      it('should call utils.delayAction if SEND_FEEDBACK_REQUEST is rate limited', () => {
        const expectedArgs = {
          action,
          limitResetAt: 1
        }
        simple.mock(db, 'getUserRateLimit').resolveWith(1)
        simple.mock(utils, 'delayAction').resolveWith()

        return actionProcessor.processAction(action).then(() => {
          assert(db.getUserRateLimit.called)
          assert.deepEqual(db.getUserRateLimit.lastCall.args[0], {
            userId: action.userId,
            platform: 'TWITTER',
            method: 'POST',
            endpoint: 'feedback/create'
          })

          assert(utils.delayAction.called)
          assert.deepEqual(utils.delayAction.lastCall.args[0], expectedArgs)
        })
      })
    })

    describe('Overlay Actions', () => {
      beforeEach(() => {
        // mocking these functions allows for easier to read diffs on test failures
        simple.mock(Buffer, 'from', param => param)
        simple.mock(JSON, 'stringify', param => param)
      })

      afterEach(() => {
        simple.restore()
      })

      const userId = 123
      const widgetId = 'widget id'

      const action = {
        userId,
        widgetId,
        text: "Hey @devillexio, here's your overlay!",
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        overlayMediaId: 'media-service-image-id',
        profileImageUrl: 'pic.twitter.com/...'
      }

      const channel = {
        publish: simple.mock()
      }

      describe('OVERLAY_IMAGE', () => {
        const overlayImageAction = { ...action, type: 'OVERLAY_IMAGE' }

        afterEach(() => {
          simple.restore()
        })

        it('should publish the correct payload to the image manipulation service for SEND_OVERLAY_IMAGE action', () => {
          simple.mock(actionProcessor, 'overlay')

          const expectedImageManipulationPayload = {
            pipeline: {
              imageUrl: 'pic.twitter.com/...',
              responseType: 'MEDIA_ID',
              tasks: [
                {
                  type: 'OVERLAY_IMAGE',
                  imageMediaId: 'media-service-image-id'
                }
              ]
            },
            action: {
              type: 'SEND_DARK_TWEET',
              widgetId,
              text: "Hey @devillexio, here's your overlay!",
              twitterAccessTokens: {
                token: 'token',
                secret: 'secret'
              },
              media: []
            }
          }

          const expectedChannelPublishArgs = [
            'bluerobot',
            `image.manipulation.SEND_DARK_TWEET.${userId}`,
            Buffer.from(JSON.stringify(expectedImageManipulationPayload)),
            {
              priority: 1
            }
          ]

          return actionProcessor
            .processAction(overlayImageAction, channel)
            .then(() => {
              assert(channel.publish.called)

              const actual = channel.publish.lastCall.args
              assert.deepEqual(actual, expectedChannelPublishArgs)
            })
        })
      })

      describe('OVERLAY_GIF', () => {
        const overlayGifAction = { ...action, type: 'OVERLAY_GIF' }

        afterEach(() => {
          simple.restore()
        })

        it('should publish the correct payload to the image manipulation service for SEND_OVERLAY_GIF action', () => {
          const expectedImageManipulationPayload = {
            pipeline: {
              imageUrl: 'pic.twitter.com/...',
              responseType: 'MEDIA_ID',
              tasks: [
                {
                  type: 'OVERLAY_GIF',
                  imageMediaId: 'media-service-image-id'
                }
              ]
            },
            action: {
              type: 'SEND_DARK_TWEET',
              widgetId,
              text: "Hey @devillexio, here's your overlay!",
              twitterAccessTokens: {
                token: 'token',
                secret: 'secret'
              },
              media: []
            }
          }

          const expectedChannelPublishArgs = [
            'bluerobot',
            `image.manipulation.SEND_DARK_TWEET.${userId}`,
            Buffer.from(JSON.stringify(expectedImageManipulationPayload)),
            {
              priority: 1
            }
          ]

          return actionProcessor
            .processAction(overlayGifAction, channel)
            .then(() => {
              assert(channel.publish.called)

              const actual = channel.publish.lastCall.args
              assert.deepEqual(actual, expectedChannelPublishArgs)
            })
        })
      })
    })

    describe('Photo Mosaic Actions', () => {
      beforeEach(() => {
        simple.mock(logger, 'debug')
        simple.mock(logger, 'info')
        simple.mock(logger, 'warn')
        simple.mock(logger, 'error')
        simple.mock(metrics, 'increment')
      })

      afterEach(() => {
        simple.restore()
      })

      const id = 'photo-mosaic-campaign-id'

      const channel = {
        publish: simple.mock()
      }

      describe('when PHOTO_MOSAIC_VERSION is 1', () => {
        const action = {
          source: 'TWITTER',
          widgetId: '5',
          ownerId: '3833695467',
          campaignId: id,
          actions: [
            {
              type: 'SEND_DARK_TWEET',
              twitterAccessTokens: {
                token: 'a-token',
                secret: 'a-super-secret'
              },
              text: 'Hey @RickRedSix, here is your message...'
            }
          ]
        }
        beforeEach(() => {
          simple.mock(process.env, 'PHOTO_MOSAIC_VERSION', '1')
        })

        it('should discard message if no mosaic campaign id is specified', () => {
          const { campaignId, ...filteredAction } = action
          const actionWithType = { ...filteredAction, type: 'MOSAIC_OPT_IN' }

          return actionProcessor
            .processAction(actionWithType, channel)
            .then(() => {
              expect(logger.warn.lastCall.arg).to.deep.equal(
                'No mosaic campaign id specified for widget id 5, discarding message...'
              )

              expect(metrics.increment.lastCall.args[0]).to.equal(
                'actions.process.discarded'
              )
            })
        })

        describe('MOSAIC_OPT_IN', () => {
          const data = { 1: 'tweet-id', 2: 'RickRedSix' }
          const imageUrls = [
            'https://pbs.twimg.com/profile_images/576376765645385729/Lc8BPier.png'
          ]

          const photoMosaicOptInAction = {
            ...action,
            type: 'MOSAIC_OPT_IN',
            imageUrls,
            data
          }

          afterEach(() => {
            simple.restore()
          })

          it('should publish the correct payload to the photo mosaic API MOSAIC_OPT_IN action', () => {
            const expectedPhotoMosaicPayload = {
              source: 'TWITTER',
              widgetId: '5',
              ownerId: '3833695467',
              actions: [
                {
                  type: 'SEND_DARK_TWEET',
                  twitterAccessTokens: {
                    token: 'a-token',
                    secret: 'a-super-secret'
                  },
                  text: 'Hey @RickRedSix, here is your message...'
                }
              ],
              imageUrls: [
                'https://pbs.twimg.com/profile_images/576376765645385729/Lc8BPier.png'
              ],
              data: { 1: 'tweet-id', 2: 'RickRedSix' }
            }

            const expectedChannelPublishArgs = [
              'bluerobot',
              `actions.mosaic.MOSAIC_OPT_IN.${id}`,
              Buffer.from(JSON.stringify(expectedPhotoMosaicPayload)),
              {
                priority: 1
              }
            ]

            return actionProcessor
              .processAction(photoMosaicOptInAction, channel)
              .then(() => {
                assert(channel.publish.called, 'publish not called')

                const actual = channel.publish.lastCall.args
                assert.deepEqual(actual, expectedChannelPublishArgs)
              })
          })
        })

        describe('MOSAIC_OPT_OUT', () => {
          const data = { 2: 'RickRedSix' }
          const photoMosaicOptInAction = {
            ...action,
            type: 'MOSAIC_OPT_OUT',
            data
          }

          afterEach(() => {
            simple.restore()
          })

          it('should publish the correct payload to the photo mosaic API MOSAIC_OPT_OUT action', () => {
            const expectedPhotoMosaicPayload = {
              source: 'TWITTER',
              widgetId: '5',
              ownerId: '3833695467',
              actions: [
                {
                  type: 'SEND_DARK_TWEET',
                  twitterAccessTokens: {
                    token: 'a-token',
                    secret: 'a-super-secret'
                  },
                  text: 'Hey @RickRedSix, here is your message...'
                }
              ],
              data: { 2: 'RickRedSix' }
            }

            const expectedChannelPublishArgs = [
              'bluerobot',
              `actions.mosaic.MOSAIC_OPT_OUT.${id}`,
              Buffer.from(JSON.stringify(expectedPhotoMosaicPayload)),
              {
                priority: 1
              }
            ]

            return actionProcessor
              .processAction(photoMosaicOptInAction, channel)
              .then(() => {
                assert(channel.publish.called)

                const actual = channel.publish.lastCall.args

                assert.deepEqual(actual, expectedChannelPublishArgs)
              })
          })
        })
      })

      describe('when PHOTO_MOSAIC_VERSION is 2', () => {
        const expectedProperties = [
          'source',
          'identifier',
          'imageUrls',
          'ownerId',
          'id',
          'type',
          'searchTerms'
        ]

        const getMissingProperties = R.pipe(
          R.keys,
          R.difference(expectedProperties)
        )

        beforeEach(() => {
          simple.mock(process.env, 'PHOTO_MOSAIC_VERSION', '2')
        })

        describe('MOSAIC_OPT_IN (facebook)', () => {
          const platform = 'FACEBOOK'
          const action = {
            source: platform,
            identifier: 'some-user-psid',
            imageUrls: ['https://image-url'],
            ownerId: 'owner-id-1',
            searchTerms: ['Mitch Horne'],
            actions: [
              {
                type: 'SEND_FACEBOOK_MESSAGE'
              }
            ],
            type: 'MOSAIC_OPT_IN', // added from the routing key
            id: id // added from the routing key
          }

          it('should publish the correct payload to the photo mosaic service', () => {
            const expectedPhotoMosaicPayload = {
              source: platform,
              identifier: 'some-user-psid',
              imageUrls: ['https://image-url'],
              ownerId: 'owner-id-1',
              searchTerms: ['Mitch Horne'],
              actions: [
                {
                  type: 'SEND_FACEBOOK_MESSAGE'
                }
              ]
            }

            const expectedChannelPublishArgs = [
              'bluerobot',
              `actions.mosaic2.MOSAIC_OPT_IN.${id}`,
              Buffer.from(JSON.stringify(expectedPhotoMosaicPayload)),
              {
                priority: 1
              }
            ]

            return actionProcessor.processAction(action, channel).then(() => {
              assert(channel.publish.called)

              const actual = channel.publish.lastCall.args
              assert.deepEqual(actual, expectedChannelPublishArgs)
            })
          })
        })

        describe('MOSAIC_OPT_IN (twitter)', () => {
          const platform = 'TWITTER'
          const action = {
            source: platform,
            identifier: 'some-user-handle',
            imageUrls: ['https://image-url'],
            ownerId: 'owner-id-1',
            searchTerms: ['Mitch Horne'],
            actions: [
              {
                type: 'SEND_DARK_TWEET'
              }
            ],
            type: 'MOSAIC_OPT_IN', // added from the routing key
            id: id // added from the routing key
          }

          it('should publish the correct payload to the photo mosaic service', () => {
            const expectedPhotoMosaicPayload = {
              source: platform,
              identifier: 'some-user-handle',
              imageUrls: ['https://image-url'],
              ownerId: 'owner-id-1',
              searchTerms: ['Mitch Horne'],
              actions: [
                {
                  type: 'SEND_DARK_TWEET'
                }
              ]
            }

            const expectedChannelPublishArgs = [
              'bluerobot',
              `actions.mosaic2.MOSAIC_OPT_IN.${id}`,
              Buffer.from(JSON.stringify(expectedPhotoMosaicPayload)),
              {
                priority: 1
              }
            ]

            return actionProcessor.processAction(action, channel).then(() => {
              assert(channel.publish.called)

              const actual = channel.publish.lastCall.args
              assert.deepEqual(actual, expectedChannelPublishArgs)
            })
          })
        })

        describe('MOSAIC_OPT_OUT (facebook)', () => {
          const platform = 'FACEBOOK'
          const type = 'MOSAIC_OPT_OUT'
          const action = {
            source: platform,
            identifier: 'some-user-psid',
            imageUrls: ['https://image-url'],
            ownerId: 'owner-id-1',
            searchTerms: ['Mitch Horne'],
            actions: [
              {
                type: 'SEND_FACEBOOK_MESSAGE'
              }
            ],
            type, // added from the routing key
            id: id // added from the routing key
          }

          it('should publish the correct payload to the photo mosaic service', () => {
            const expectedPhotoMosaicPayload = {
              source: platform,
              identifier: 'some-user-psid',
              imageUrls: ['https://image-url'],
              ownerId: 'owner-id-1',
              searchTerms: ['Mitch Horne'],
              actions: [
                {
                  type: 'SEND_FACEBOOK_MESSAGE'
                }
              ]
            }

            const expectedChannelPublishArgs = [
              'bluerobot',
              `actions.mosaic2.MOSAIC_OPT_OUT.${id}`,
              Buffer.from(JSON.stringify(expectedPhotoMosaicPayload)),
              {
                priority: 1
              }
            ]

            return actionProcessor.processAction(action, channel).then(() => {
              assert(channel.publish.called)

              const actual = channel.publish.lastCall.args
              assert.deepEqual(actual, expectedChannelPublishArgs)
            })
          })
        })

        describe('MOSAIC_OPT_OUT (twitter)', () => {
          const platform = 'TWITTER'
          const type = 'MOSAIC_OPT_OUT'
          const action = {
            source: platform,
            identifier: 'some-user-handle',
            imageUrls: ['https://image-url'],
            ownerId: 'owner-id-1',
            searchTerms: ['Mitch Horne'],
            actions: [
              {
                type: 'SEND_DARK_TWEET'
              }
            ],
            type, // added from the routing key
            id: id // added from the routing key
          }

          it('should publish the correct payload to the photo mosaic service', () => {
            const expectedPhotoMosaicPayload = {
              source: platform,
              identifier: 'some-user-handle',
              imageUrls: ['https://image-url'],
              ownerId: 'owner-id-1',
              searchTerms: ['Mitch Horne'],
              actions: [
                {
                  type: 'SEND_DARK_TWEET'
                }
              ]
            }

            const expectedChannelPublishArgs = [
              'bluerobot',
              `actions.mosaic2.MOSAIC_OPT_OUT.${id}`,
              Buffer.from(JSON.stringify(expectedPhotoMosaicPayload)),
              {
                priority: 1
              }
            ]

            return actionProcessor.processAction(action, channel).then(() => {
              assert(channel.publish.called)

              const actual = channel.publish.lastCall.args
              assert.deepEqual(actual, expectedChannelPublishArgs)
            })
          })
        })

        it('should discard message if no user identifier is specified', () => {
          const action = {
            source: 'TWITTER',
            type: 'MOSAIC_OPT_IN',
            imageUrls: ['https://image-url'],
            ownerId: 'owner-id-1',
            searchTerms: ['Mitch Horne'],
            actions: [
              {
                type: 'SEND_DARK_TWEET'
              }
            ],
            id: id
          }

          const missingProperties = getMissingProperties(action)

          actionProcessor.processAction(action, channel)
          expect(logger.error.lastCall.arg).to.deep.equal(
            `Missing properties for photo mosaic action(s): ${missingProperties}. Discarding...`
          )

          expect(metrics.increment.lastCall.args[0]).to.equal(
            'actions.process.photomosaic.discarded'
          )
        })
        it('should discard message if searchTerms is not specified', () => {
          const action = {
            source: 'TWITTER',
            identifier: 'some-user-id',
            type: 'MOSAIC_OPT_IN',
            imageUrls: ['https://image-url'],
            ownerId: 'owner-id-1',
            actions: [
              {
                type: 'SEND_DARK_TWEET'
              }
            ],
            id: id
          }

          const missingProperties = getMissingProperties(action)

          actionProcessor.processAction(action, channel)
          expect(logger.error.lastCall.arg).to.deep.equal(
            `Missing properties for photo mosaic action(s): ${missingProperties}. Discarding...`
          )

          expect(metrics.increment.lastCall.args[0]).to.equal(
            'actions.process.photomosaic.discarded'
          )
        })

        it('should discard message if no owner id is specified', () => {
          const action = {
            source: 'TWITTER',
            type: 'MOSAIC_OPT_IN',
            identifier: 'some-user-handle',
            imageUrls: ['https://image-url'],
            searchTerms: ['Mitch Horne'],
            actions: [
              {
                type: 'SEND_DARK_TWEET'
              }
            ],
            id: id
          }

          const missingProperties = getMissingProperties(action)

          actionProcessor.processAction(action, channel)
          expect(logger.error.lastCall.arg).to.deep.equal(
            `Missing properties for photo mosaic action(s): ${missingProperties}. Discarding...`
          )

          expect(metrics.increment.lastCall.args[0]).to.equal(
            'actions.process.photomosaic.discarded'
          )
        })

        it('should discard message if no source is specified', () => {
          const action = {
            identifier: 'some-user-handle',
            imageUrls: ['https://image-url'],
            ownerId: 'owner-id-1',
            searchTerms: ['Mitch Horne'],
            actions: [
              {
                type: 'SEND_DARK_TWEET'
              }
            ],
            id: id,
            type: 'MOSAIC_OPT_IN'
          }

          const missingProperties = getMissingProperties(action)

          actionProcessor.processAction(action, channel)
          expect(logger.error.lastCall.arg).to.deep.equal(
            `Missing properties for photo mosaic action(s): ${missingProperties}. Discarding...`
          )

          expect(metrics.increment.lastCall.args[0]).to.equal(
            'actions.process.photomosaic.discarded'
          )
        })

        it('should discard message if no mosaic campaign id is specified', () => {
          const action = {
            source: 'TWITTER',
            type: 'MOSAIC_OPT_IN',
            imageUrls: ['https://image-url'],
            identifier: 'some-user-handle',
            ownerId: 'owner-id-1',
            searchTerms: ['Mitch Horne'],
            actions: [
              {
                type: 'SEND_DARK_TWEET'
              }
            ]
          }

          const missingProperties = getMissingProperties(action)

          actionProcessor.processAction(action, channel)
          expect(logger.error.lastCall.arg).to.deep.equal(
            `Missing properties for photo mosaic action(s): ${missingProperties}. Discarding...`
          )
          expect(metrics.increment.lastCall.args[0]).to.equal(
            'actions.process.photomosaic.discarded'
          )
        })

        it('should discard message if type is MOSAIC_OPT_IN and no image urls are specified', () => {
          const action = {
            source: 'TWITTER',
            type: 'MOSAIC_OPT_IN',
            identifier: 'some-user-handle',
            ownerId: 'owner-id-1',
            searchTerms: ['Mitch Horne'],
            imageUrls: [],
            actions: [
              {
                type: 'SEND_DARK_TWEET'
              }
            ],
            id: id
          }

          actionProcessor.processAction(action, channel)
          expect(logger.error.lastCall.arg).to.deep.equal(
            'Missing required non-empty imageUrls parameter for photo mosaic opt in'
          )

          expect(metrics.increment.lastCall.args[0]).to.equal(
            'actions.process.photomosaic.discarded'
          )
        })
      })
    })

    describe('GOOGLE_SHEET_APPEND', () => {
      const channel = {
        publish: simple.mock()
      }

      afterEach(() => {
        simple.restore()
      })

      it('should publish the received action to the google sheets service', () => {
        const expectedPayload = {
          type: 'GOOGLE_SHEET_APPEND',
          widgetId: 'a-widget-id',
          spreadsheetId: 'id-of-the-sheet-we-want-to-append-to',
          sheetId: 0,
          row: [
            'devillexdev',
            'Siphesi72397581',
            'I totally know who I voted for!',
            '1575994725'
          ]
        }

        const expectedChannelPublishArgs = [
          'bluerobot',
          'googlesheets.append.a-widget-id',
          Buffer.from(JSON.stringify(expectedPayload))
        ]

        return actionProcessor
          .processAction(expectedPayload, channel)
          .then(() => {
            assert(channel.publish.called)

            const actual = channel.publish.lastCall.args
            assert.deepEqual(actual, expectedChannelPublishArgs)
          })
      })
    })

    describe('SPEED_THREAD_START', () => {
      const channel = {
        publish: simple.mock()
      }

      it('should call speedThreadStart function', () => {
        const speedThreadStart = simple
          .mock(actionProcessor, 'speedThreadStart')
          .resolveWith()

        const action = {
          type: 'SPEED_THREAD_START',
          widgetId: 'a-widget-id',
          data: {
            threadId: 'a-thread-id'
          }
        }

        return actionProcessor.processAction(action, channel).then(() => {
          assert(speedThreadStart.called)
        })
      })
    })

    describe('SPEED_THREAD_STOP', () => {
      const channel = {
        publish: simple.mock()
      }

      it('should call speedThreadStop function', () => {
        const speedThreadStop = simple
          .mock(actionProcessor, 'speedThreadStop')
          .resolveWith()

        const action = {
          type: 'SPEED_THREAD_STOP',
          widgetId: 'a-widget-id',
          data: {
            threadId: 'a-thread-id'
          }
        }

        return actionProcessor.processAction(action, channel).then(() => {
          assert(speedThreadStop.called)
        })
      })
    })

    describe('ADD_TIMED_THREAD_ACTIVITY', () => {
      const channel = {
        publish: simple.mock()
      }
      it('should call addTimedThreadActivity function', () => {
        const addTimedThreadActivity = simple
          .mock(actionProcessor, 'addTimedThreadActivity')
          .resolveWith()

        const action = {
          type: 'ADD_TIMED_THREAD_ACTIVITY',
          widgetId: 'a-widget-id',
          data: {
            threadId: 'a-thread-id',
            activityId: 'an-activity-id',
            time: 1000
          }
        }

        actionProcessor.processAction(action, channel)

        assert(addTimedThreadActivity.called)
      })
    })
  })

  describe('reRouteAction', () => {
    const channel = {
      publish: simple.mock()
    }

    afterEach(() => {
      simple.restore()
    })

    it('should publish the action', () => {
      const routingKeyPrefix = 'a-routingkey.prefix'
      const action = {
        widgetId: 'a-widget-id',
        type: 'A_TYPE'
      }

      const expectedChannelPublishArgs = [
        'bluerobot',
        'a-routingkey.prefix.a-widget-id',
        Buffer.from(JSON.stringify(action))
      ]

      actionProcessor.reRouteAction(routingKeyPrefix, action, channel)

      assert(channel.publish.called)

      const actual = channel.publish.lastCall.args
      assert.deepEqual(actual, expectedChannelPublishArgs)
    })

    it('should call sendInstagramCommentReply when of type SEND_INSTAGRAM_COMMENT_REPLY', async () => {
      simple.mock(instagram, 'sendInstagramCommentReply').resolveWith({})

      const action = {
        type: 'SEND_INSTAGRAM_COMMENT_REPLY'
      }

      await processAction(action)

      assert(instagram.sendInstagramCommentReply.called)
      expect(instagram.sendInstagramCommentReply.lastCall.args).to.deep.equal([
        action
      ])
    })
  })

  describe('SEND_WHATSAPP_MESSAGE', () => {
    beforeEach(() => {
      simple.mock(db, 'upsertRateLimit').resolveWith()
      simple.mock(db, 'getUserRateLimit').resolveWith([])
    })

    afterEach(() => {
      simple.restore()
    })

    it('should call endpoint with the correct options', async () => {
      const crypt = {
        decrypt: simple.mock(apiKey => apiKey.replace('encrypted', 'decrypted'))
      }

      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 200
      })

      const action = {
        type: 'SEND_WHATSAPP_MESSAGE',
        apiKey: 'encrypted-api-key',
        message: {
          to: '27629483242',
          recipient_type: 'individual',
          text: {
            body: 'Ahoy there.'
          },
          type: 'text'
        }
      }
      const expected = {
        method: 'POST',
        url: process.env.D360_API_URL,
        body: action.message,
        retryRemaining: 100,
        retryStatuses: '429,503',
        headers: {
          'D360-Api-Key': 'decrypted-api-key'
        }
      }

      await actionProcessor.sendWhatsappMessage(action, { crypt })

      expect(crypt.decrypt.lastCall.args).to.deep.equal([action.apiKey])
      expect(endpoints.callEndpoint.lastCall.args).to.deep.equal([expected])
    })

    it('should set rate limit if endpoint returns 429', async () => {
      const crypt = {
        decrypt: simple.mock(apiKey => apiKey.replace('encrypted', 'decrypted'))
      }

      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 429
      })

      simple.mock(utils, 'setRateLimit').resolveWith()

      const action = {
        type: 'SEND_WHATSAPP_MESSAGE',
        apiKey: 'encrypted-api-key',
        message: {
          to: '27629483242',
          recipient_type: 'individual',
          text: {
            body: 'Ahoy there.'
          },
          type: 'text'
        }
      }
      const expected = {
        action: {
          apiKey: 'encrypted-api-key',
          message: {
            recipient_type: 'individual',
            text: {
              body: 'Ahoy there.'
            },
            to: '27629483242',
            type: 'text'
          },
          type: 'SEND_WHATSAPP_MESSAGE'
        },
        endpoint: 'messages',
        headers: {
          'x-rate-limit-reset': 1602547203
        },
        method: 'POST',
        platform: 'WHATSAPP',
        userId: undefined
      }

      await actionProcessor.sendWhatsappMessage(action, { crypt })

      expect(utils.setRateLimit.lastCall.args).to.deep.equal([expected])
    })

    it('should set rate limit if endpoint returns 503', async () => {
      const crypt = {
        decrypt: simple.mock(apiKey => apiKey.replace('encrypted', 'decrypted'))
      }

      simple.mock(endpoints, 'callEndpoint').resolveWith({
        status: 503
      })

      simple.mock(utils, 'setRateLimit').resolveWith()

      const action = {
        type: 'SEND_WHATSAPP_MESSAGE',
        apiKey: 'encrypted-api-key',
        message: {
          to: '27629483242',
          recipient_type: 'individual',
          text: {
            body: 'Ahoy there.'
          },
          type: 'text'
        }
      }
      const expected = {
        action: {
          apiKey: 'encrypted-api-key',
          message: {
            recipient_type: 'individual',
            text: {
              body: 'Ahoy there.'
            },
            to: '27629483242',
            type: 'text'
          },
          type: 'SEND_WHATSAPP_MESSAGE'
        },
        endpoint: 'messages',
        headers: {
          'x-rate-limit-reset': 1602547203
        },
        method: 'POST',
        platform: 'WHATSAPP',
        userId: undefined
      }

      await actionProcessor.sendWhatsappMessage(action, { crypt })

      expect(utils.setRateLimit.lastCall.args).to.deep.equal([expected])
    })
  })

  it('should not process action if rate_limit exists', async () => {
    const crypt = {
      decrypt: simple.mock(apiKey => apiKey.replace('encrypted', 'decrypted'))
    }

    simple.mock(db, 'getUserRateLimit').resolveWith(1)
    simple.mock(endpoints, 'callEndpoint').resolveWith()
    simple.mock(utils, 'delayAction').resolveWith()

    const action = {
      type: 'SEND_WHATSAPP_MESSAGE',
      apiKey: 'encrypted-api-key',
      message: {
        to: '27629483242',
        recipient_type: 'individual',
        text: {
          body: 'Ahoy there.'
        },
        type: 'text'
      }
    }

    await actionProcessor.sendWhatsappMessage(action, { crypt })

    expect(utils.delayAction.lastCall.args).to.deep.equal([
      {
        action,
        limitResetAt: 1
      }
    ])
    expect(endpoints.callEndpoint.called).to.equal(false)
  })

  describe('LOOKUP_API', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should get lookup data', async () => {
      simple.mock(lookup, 'getLookupData').resolveWith({})

      const action = {
        type: 'LOOKUP_API',
        url: 'localhost',
        id: 'test_field',
        username: 'username',
        password: 'password'
      }

      await actionProcessor.lookupApi(action)

      const actual = lookup.getLookupData.called
      const expected = true

      expect(actual).to.deep.equal(expected)
    })
  })

  describe('SEND_INSTAGRAM_MESSAGE', () => {
    afterEach(() => {
      simple.restore()
    })

    const instagramAccessToken = 'some-access-token'

    it('should send Instagram message', async () => {
      simple.mock(instagram, 'sendInstagramMessage').resolveWith({})

      /** @type {instagram.SendInstagramMessageAction} */
      const action = {
        type: 'SEND_INSTAGRAM_MESSAGE',
        accessToken: instagramAccessToken,
        message: {
          recipient: {
            id: '1234567890'
          },
          message: {
            text: 'test message'
          }
        },
        userId: '0987654321'
      }

      await actionProcessor.sendInstagramMessage(action)

      assert(instagram.sendInstagramMessage.called)
    })
  })

  describe('speedThreadStart', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should successfully call db.startSpeedThreadParticipant for non-existing speed thread participant', async () => {
      simple.mock(db, 'getSpeedThreadParticipant').resolveWith(false)
      simple.mock(db, 'startSpeedThreadParticipant').resolveWith()

      const action = {
        type: 'START_SPEED_START',
        userId: '0987654321'
      }

      const result = await actionProcessor.speedThreadStart(action)
      expect(result).to.deep.equal({
        success: true
      })
    })

    it('should not call db.startSpeedThreadParticipant for user who has completed speed thread participant', async () => {
      simple
        .mock(db, 'getSpeedThreadParticipant')
        .resolveWith([
          { user_id: '0987654321', last_interaction_time: 1234567890 }
        ])
      const dbStartSpeedThreadParticipant = simple
        .mock(db, 'startSpeedThreadParticipant')
        .resolveWith()

      const action = {
        type: 'START_SPEED_START',
        userId: '0987654321',
        widgetId: '1234567890'
      }

      const result = await actionProcessor.speedThreadStart(action)
      expect(db.startSpeedThreadParticipant.called).to.equal(false)
      assert(dbStartSpeedThreadParticipant.called === false)

      expect(result).to.deep.equal({
        success: false,
        message: `User ID ${action.userId} has already finished the speed thread for widget ${action.widgetId}`
      })
    })

    it('should not call db.startSpeedThreadParticipant for user who has started but not yet completed speed thread participant', async () => {
      simple
        .mock(db, 'getSpeedThreadParticipant')
        .resolveWith([{ user_id: '0987654321' }])
      const dbStartSpeedThreadParticipant = simple
        .mock(db, 'startSpeedThreadParticipant')
        .resolveWith()

      const action = {
        type: 'START_SPEED_START',
        userId: '0987654321',
        widgetId: '1234567890'
      }

      const result = await actionProcessor.speedThreadStart(action)
      expect(db.startSpeedThreadParticipant.called).to.equal(false)
      assert(dbStartSpeedThreadParticipant.called === false)

      expect(result).to.deep.equal({
        success: false,
        message: `User ID ${action.userId} is already participating in speed thread widget ${action.widgetId}`
      })
    })

    it('should return false if db.isSpeedThreadParticipant throws an error', async () => {
      simple
        .mock(db, 'getSpeedThreadParticipant')
        .throwWith(new Error('test error'))

      const action = {
        type: 'START_SPEED_START',
        userId: '0987654321',
        widgetId: '1234567890'
      }

      const result = await actionProcessor.speedThreadStart(action)
      expect(result).to.deep.equal({
        success: false,
        message: 'test error'
      })
    })
  })

  describe('speedThreadStop', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should successfully call db.stopSpeedThreadParticipant for existing speed thread participant', async () => {
      simple
        .mock(db, 'getSpeedThreadParticipant')
        .resolveWith([{ user_id: '0987654321', last_interaction_time: null }])
      simple.mock(db, 'stopSpeedThreadParticipant').resolveWith()
      simple
        .mock(db, 'getInteractionDurationForParticipant')
        .resolveWith(1234567890)

      const action = {
        type: 'STOP_SPEED_START',
        userId: '0987654321',
        widgetId: '1234567890',
        finalInteractionTime: 1234567890
      }

      const result = await actionProcessor.speedThreadStop(action)
      expect(result).to.deep.equal({
        body: '{"timeElapsedInMs":1234567890}'
      })
    })

    it('should log an error for trying to fetch non-existing speed thread participant from DB', async () => {
      simple.mock(db, 'getSpeedThreadParticipant').resolveWith([])
      simple.mock(db, 'stopSpeedThreadParticipant').resolveWith()
      simple.mock(db, 'getFinalTimeElapsedForParticipant').resolveWith([])

      const action = {
        type: 'STOP_SPEED_START',
        userId: '0987654321',
        widgetId: '1234567890',
        timestamp: 1234567890
      }

      const result = await actionProcessor.speedThreadStop(action)
      expect(result).to.deep.equal({
        success: false,
        message: `User ID ${action.userId} has not started speed thread for widget ${action.widgetId}`
      })
    })

    it('should log an error for a speed thread participant who has already completed the speed thread', async () => {
      simple
        .mock(db, 'getSpeedThreadParticipant')
        .resolveWith([
          { user_id: '0987654321', last_interaction_time: 1234567890 }
        ])
      simple.mock(db, 'stopSpeedThreadParticipant').resolveWith()
      simple
        .mock(db, 'getFinalTimeElapsedForParticipant')
        .resolveWith([{ interaction_duration: 1234567890 }])

      const action = {
        type: 'STOP_SPEED_START',
        userId: '0987654321',
        widgetId: '1234567890',
        timestamp: 1234567890
      }

      const result = await actionProcessor.speedThreadStop(action)
      expect(result).to.deep.equal({
        success: false,
        message: `Failed to update speed thread participant: User ID ${action.userId} has already finished for widget ${action.widgetId}`
      })
    })

    it('should log an error if db.getSpeedThreadParticipant throws an error', async () => {
      simple
        .mock(db, 'getSpeedThreadParticipant')
        .resolveWith([{ user_id: '0987654321', last_interaction_time: null }])
      simple
        .mock(db, 'stopSpeedThreadParticipant')
        .throwWith(new Error('test error'))

      const action = {
        type: 'STOP_SPEED_START',
        userId: '0987654321',
        widgetId: '1234567890',
        timestamp: 1234567890
      }

      const result = await actionProcessor.speedThreadStop(action)
      expect(result).to.deep.equal({
        success: false,
        message:
          'Failed to update speed thread participant with finish timestamp'
      })
    })
  })

  describe('addTimedThreadActivity', () => {
    beforeEach(() => {
      simple.mock(logger, 'error')
      simple.mock(logger, 'child')
      simple.mock(logger, 'debug')
    })

    afterEach(() => {
      simple.restore()
    })

    it('should successfully call db.addTimedThreadActivity', async () => {
      simple.mock(db, 'addTimedThreadActivity').resolveWith()

      const action = {
        type: 'ADD_TIMED_THREAD_ACTIVITY',
        userId: '0987654321',
        widgetId: '1234567890',
        timestamp: 1234567890
      }

      const result = await actionProcessor.addTimedThreadActivity(action)
      expect(result).to.deep.equal({
        success: true
      })
    })

    it('should log an error if db.addTimedThreadActivity throws an error', async () => {
      const err = new Error('test')
      simple.mock(db, 'addTimedThreadActivity').throwWith(err)

      const action = {
        type: 'ADD_TIMED_THREAD_ACTIVITY',
        userId: '0987654321',
        widgetId: '1234567890',
        timestamp: 1234567890,
        tweetId: '1234567890',
        userHandle: 'test'
      }

      const result = await actionProcessor.addTimedThreadActivity(action)
      expect(result).to.deep.equal({
        success: false,
        message: 'Failed to add timed thread activity',
        retry: true,
        retryRemaining: 3
      })

      expect(logger.error.called).to.equal(true)
      expect(logger.error.lastCall.args).to.deep.equal([
        'Failed to add timed thread activity'
      ])
      expect(logger.child.lastCall.args).to.deep.equal([
        {
          action: {
            widgetId: action.widgetId,
            userId: action.userId,
            tweetId: action.tweetId,
            userHandle: action.userHandle,
            timestamp: action.timestamp
          },
          err
        }
      ])
    })

    it('should return success if the entry is a duplicate', async () => {
      const err = new Error('test')
      err.code = 'ER_DUP_ENTRY'
      simple.mock(db, 'addTimedThreadActivity').throwWith(err)

      const action = {
        type: 'ADD_TIMED_THREAD_ACTIVITY',
        userId: '0987654321',
        widgetId: '1234567890',
        timestamp: 1234567890,
        tweetId: '1234567890',
        userHandle: 'test'
      }

      const result = await actionProcessor.addTimedThreadActivity(action)
      expect(result).to.deep.equal({
        success: true
      })
      expect(logger.debug.called).to.equal(true)
      expect(logger.debug.lastCall.args).to.deep.equal([
        'Duplicate timed thread activity entry. Ignoring...'
      ])
    })
  })

  describe('SEND_INSTAGRAM_COMMENT_REPLY', () => {
    afterEach(() => {
      simple.restore()
    })

    const instagramAccessToken = 'some-access-token'

    it('should send Instagram message', async () => {
      simple.mock(instagram, 'sendInstagramCommentReply').resolveWith({})

      /** @type {instagram.SendInstagramCommentReplyAction} */
      const action = {
        type: 'SEND_INSTAGRAM_COMMENT_REPLY',
        accessToken: instagramAccessToken,
        message: {
          recipient: {
            comment_id: '1234567890'
          },
          message: {
            text: 'test message'
          }
        }
      }

      await actionProcessor.sendInstagramCommentReply(action)

      assert(instagram.sendInstagramCommentReply.called)
      expect(instagram.sendInstagramCommentReply.lastCall.args).to.deep.equal([
        action
      ])
    })
  })

  describe('UNLOCK_COUPONS', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should call coupon service to unlock coupons', async () => {
      simple.mock(endpoints, 'unlockCoupons').resolveWith({})

      const action = {
        type: 'UNLOCK_COUPONS',
        amountOfCoupons: 50
      }

      await actionProcessor.processAction(action)

      expect(endpoints.unlockCoupons.calls.length).to.equal(1)
      expect(endpoints.unlockCoupons.lastCall.args).to.deep.equal([action])
    })
  })

  describe('TRACK_INTERACTION', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should store provided interaction', async () => {
      simple.mock(db, 'trackInteraction')

      const action = {
        type: 'TRACK_INTERACTION',
        widgetId: '1234',
        interaction: {},
        eventId: 'event_id',
        trackingId: 'tracking_id',
        trackingDescr: 'description_id'
      }

      await actionProcessor.processAction(action)

      expect(db.trackInteraction.calls.length).to.equal(1)
      expect(db.trackInteraction.lastCall.args).to.deep.equal([
        action.widgetId,
        action
      ])
    })
  })
})
