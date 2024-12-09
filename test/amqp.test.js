const { assert, expect } = require('chai')
const simple = require('simple-mock')
const amqp = require('../app/amqp')
const { logger, metrics } = require('@bluerobot/monitoring')
const R = require('ramda')

const actionProcessor = require('../app/action-processor')

const getErrorDetailsObject = error => ({
  jsonString: JSON.stringify(error ?? ''),
  message: JSON.stringify(error?.message ?? ''),
  stack: JSON.stringify(error?.stack ?? '')
})

describe('amqp', () => {
  const exchangeName = process.env.AMQP_EXCHANGE || 'bluerobot'

  beforeEach(() => {
    simple.mock(logger, 'child').returnWith(logger)
    simple.mock(logger, 'debug')
    simple.mock(logger, 'info')
    simple.mock(logger, 'warn')
    simple.mock(logger, 'error')
  })

  afterEach(() => {
    simple.restore()
  })

  describe('parseMessage', () => {
    it('should return the parsed action', () => {
      simple.mock(JSON, 'parse').returnWith({
        type: 'An action'
      })

      const message = {
        fields: {
          routingKey: 'actions.process.type.owner_id'
        },
        content: '{}'
      }

      const results = amqp.parseMessage(message)

      assert.equal(JSON.parse.called, true)
      assert.deepEqual(results, {
        type: 'An action',
        userId: 'owner_id'
      })
    })

    it('should not overwrite userId with ownerId in the parsed action', () => {
      simple.mock(JSON, 'parse').returnWith({
        type: 'An action',
        userId: 'user_id'
      })

      const message = {
        fields: {
          routingKey: 'actions.process.type.owner_id'
        },
        content: '{}'
      }

      const results = amqp.parseMessage(message)

      assert.equal(JSON.parse.called, true)
      assert.deepEqual(results, {
        type: 'An action',
        userId: 'user_id'
      })
    })

    it('should return the parsed action with the type included in the message, and not override with type in routing key', () => {
      const message = {
        fields: {
          routingKey: 'actions.process.should_not_show_this_as_type.owner_id'
        },
        content: '{"type":"some_action"}'
      }

      const results = amqp.parseMessage(message)

      assert.deepEqual(results, {
        type: 'some_action',
        userId: 'owner_id'
      })
    })

    it('should return the parsed action with the type included in the routing key IF type is not included in the message', () => {
      const message = {
        fields: {
          routingKey: 'actions.process.some_action.owner_id'
        },
        content: '{}'
      }

      const results = amqp.parseMessage(message)

      assert.deepEqual(results, {
        type: 'some_action',
        userId: 'owner_id'
      })
    })
  })

  describe('handleMessage', () => {
    let channel
    const isExpired = simple.mock().returnWith(false)
    const buffer = simple.mock(R.identity)
    const twitterAccessTokens = {
      token: 'token',
      secret: 'secret'
    }

    const type = 'SEND_TWEET'
    const text = 'text'
    const userId = 'user-id'
    const widgetId = 'widget-id'
    const action = { type, text, userId, widgetId }
    const priority = 10
    const message = { properties: { priority } }

    const parse = simple.mock().returnWith({ ...action, twitterAccessTokens })

    beforeEach(() => {
      simple.mock(actionProcessor, 'processAction').resolveWith()
      simple.mock(logger, 'debug')
      simple.mock(logger, 'info')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'error')
      simple.mock(metrics, 'increment')

      channel = {
        publish: simple.mock(),
        ack: simple.mock()
      }
    })

    afterEach(() => {
      simple.restore()
    })

    it('should throw an exception and log an error if processAction returns an error status code (>= 400)', async () => {
      const isExpired = simple.mock().returnWith(false)
      const processAction = simple
        .mock()
        .returnWith({ status: 403, body: 'Your tweet was invalid' })

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      const err = new Error('Your tweet was invalid')

      expect(Object.keys(logger.child.lastCall.args[0])).to.deep.equal([
        'action',
        'err',
        'errorDetails'
      ])
      expect(logger.child.lastCall.args[0].action).to.deep.equal({
        text: 'text',
        type: 'SEND_TWEET',
        userId: 'user-id',
        widgetId: 'widget-id'
      })
      expect(logger.child.lastCall.args[0].err.toString()).to.equal(
        err.toString()
      )

      expect(logger.error.lastCall.args[0]).to.equal(
        `Error processing SEND_TWEET action: '${err.message}'. Discarding...`
      )
    })

    it('should log a twitter error correctly if it is an array', async () => {
      const err = [{ code: 214, message: 'Bad request.' }]
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Twitter error ${
          err[0].code || ''
        }: Bad request.'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should log a non-twitter error message (i.e if it is not an array)', async () => {
      const err = { code: 500, message: 'Internal error' }
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Internal error'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should log "Unknown error" for a non-twitter error (i.e if it is not an array) with no message ', async () => {
      const err = { code: 500 }
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Unknown error'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should correctly log an error where the error message is an object', async () => {
      const err = {
        statusCode: 403,
        name: 'SomeError',
        message: {
          someProperty: 'someValue'
        }
      }
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      const stringifiedErrMessage = JSON.stringify(err.message)

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing ${type} action: '${stringifiedErrMessage}'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should discard expired action', async () => {
      const isExpired = simple.mock().returnWith(true)

      await amqp.handleMessage({ channel, message }, { parse, isExpired })

      expect(channel.publish.called).to.equal(false)
      expect(logger.debug.lastCall.args).to.deep.equal([
        { action },
        `${type} action expired, action has been discarded`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        `actions.process.expired.${type}`
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should process action', async () => {
      const result = false
      const processAction = simple.mock().returnWith(result)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.debug.lastCall.args).to.deep.equal([
        { action, result, widgetId },
        `${type} action processed`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        `actions.process.${type}`
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should process retry', async () => {
      const retryRemaining = 5
      const result = { retry: true, retryRemaining }
      simple.mock(actionProcessor, 'processAction').resolveWith(result)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, buffer }
      )

      const retryAction = {
        ...action,
        twitterAccessTokens,
        retryRemaining: retryRemaining - 1 + ''
      }

      expect(buffer.called).to.equal(true)
      expect(buffer.lastCall.args).to.deep.equal([retryAction])

      expect(channel.publish.called).to.equal(true)
      expect(channel.publish.lastCall.args).to.deep.equal([
        exchangeName,
        `actions.throttle.${type}.${userId}`,
        retryAction,
        {
          priority
        }
      ])

      expect(logger.debug.lastCall.args).to.deep.equal([
        { result, action },
        `${type} action retry requested`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        `actions.retry.${type}`
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should process delay', async () => {
      const delay = 123454321
      const result = { delay }
      simple.mock(actionProcessor, 'processAction').resolveWith(result)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, buffer }
      )

      const delayAction = { ...action, twitterAccessTokens }

      expect(buffer.called).to.equal(true)
      expect(buffer.lastCall.args).to.deep.equal([delayAction])

      expect(channel.publish.called).to.equal(true)
      expect(channel.publish.lastCall.args).to.deep.equal([
        exchangeName,
        `actions.throttle.${type}.${userId}`,
        delayAction,
        {
          headers: {
            'x-delay': delay
          },
          priority
        }
      ])

      expect(logger.debug.lastCall.args).to.deep.equal([
        { result, action },
        `${type} action delay requested`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        `actions.rate_limit.${type}`
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should process feedback failed', async () => {
      const feedbackFailed = true
      const delayAction = { ...action, twitterAccessTokens }
      const result = { feedbackFailed, action: delayAction }
      simple.mock(actionProcessor, 'processAction').resolveWith(result)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, buffer }
      )

      expect(buffer.called).to.equal(true)
      expect(buffer.lastCall.args).to.deep.equal([delayAction])

      expect(channel.publish.called).to.equal(true)
      expect(channel.publish.lastCall.args).to.deep.equal([
        exchangeName,
        `actions.throttle.${type}.${userId}`,
        delayAction,
        {
          priority
        }
      ])

      expect(logger.error.lastCall.args).to.deep.equal([
        {
          result,
          action
        },
        `Feedback limit reached for ${type} action. Fallback requested...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should requeue over capacity error with code 130', async () => {
      const err = {
        statusCode: 403,
        name: 'HTTPError',
        message: 'Over capacity',
        type: 'HTTPError',
        response: {
          body: {
            errors: [{ code: 130 }]
          }
        }
      }
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction, buffer }
      )

      const retryAction = { ...action, twitterAccessTokens }

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction, buffer }
      )

      expect(channel.publish.called).to.equal(true)
      const [
        publishExchangeName,
        publishRoutingKey,
        publishAction,
        publishOptions
      ] = channel.publish.lastCall.args
      expect(publishExchangeName).to.equal(exchangeName)
      expect(publishAction).to.deep.equal(retryAction)
      expect(publishOptions).to.deep.equal({ priority })
      expect(publishRoutingKey).to.equal('actions.throttle.SEND_TWEET.user-id')

      expect(buffer.called).to.equal(true)
      expect(buffer.lastCall.args).to.deep.equal([retryAction])

      expect(logger.warn.lastCall.args).to.deep.equal([
        { err, action },
        `Error processing ${type} action: 'Over capacity'. Requeuing...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.requeued'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should requeue internal server error with code 131', async () => {
      const err = {
        statusCode: 403,
        name: 'HTTPError',
        message: 'Internal error',
        type: 'HTTPError',
        response: {
          body: {
            errors: [{ code: 131 }]
          }
        }
      }
      const processAction = simple.mock().rejectWith(err)
      const retryAction = { ...action, twitterAccessTokens }

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction, buffer }
      )

      expect(channel.publish.called).to.equal(true)
      const [
        publishExchangeName,
        publishRoutingKey,
        publishAction,
        publishOptions
      ] = channel.publish.lastCall.args
      expect(publishExchangeName).to.equal(exchangeName)
      expect(publishAction).to.deep.equal(retryAction)
      expect(publishOptions).to.deep.equal({ priority })
      expect(publishRoutingKey).to.equal('actions.throttle.SEND_TWEET.user-id')

      expect(buffer.called).to.equal(true)
      expect(buffer.lastCall.args).to.deep.equal([retryAction])

      expect(logger.warn.lastCall.args).to.deep.equal([
        { err, action },
        `Error processing ${type} action: 'Internal error'. Requeuing...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.requeued'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should process lookup failed', async () => {
      const result = { lookupFailed: true }
      const processAction = simple
        .mock(actionProcessor, 'processAction')
        .resolveWith(result)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(processAction.called).to.equal(true)
      expect(channel.publish.called).to.equal(false)
    })

    it('should process unsuccessful result', async () => {
      const result = {
        success: false,
        message: 'error description for failure'
      }
      const processAction = simple
        .mock(actionProcessor, 'processAction')
        .resolveWith(result)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(processAction.called).to.equal(true)
      expect(channel.ack.called).to.equal(true)
      expect(channel.publish.called).to.equal(false)
      expect(logger.warn.lastCall.args).to.deep.equal([
        { action, result },
        `${type} action failed. Checking for inner failure actions...`
      ])
      expect(metrics.increment.calls[0].args).to.deep.equal([
        `actions.process.${type}.failed`
      ])
    })

    it('should process handled errors', async () => {
      const result = {
        isHandled: true
      }
      const processAction = simple
        .mock(actionProcessor, 'processAction')
        .resolveWith(result)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(processAction.called).to.equal(true)
      expect(channel.ack.called).to.equal(true)
      expect(channel.publish.called).to.equal(false)
      expect(logger.debug.lastCall.args).to.deep.equal([
        { action, result },
        `${type} action handled without processing`
      ])
      expect(metrics.increment.calls[0].args).to.deep.equal([
        `actions.process.${type}.handled`
      ])
    })

    describe('DB connection errors', () => {
      const action = {
        type: 'SEND_DARK_TWEET',
        twitterAccessTokens: {
          token: 'token',
          secret: 'secret'
        },
        text: 'text',
        media: ['mediaId'],
        userId: '123'
      }

      const simulateDbError = async error => {
        const processAction = simple.mock().rejectWith(error)

        const parse = simple.mock().returnWith(action)

        return amqp.handleMessage(
          { channel, message },
          { parse, isExpired, processAction, buffer }
        )
      }

      const expectActionRequeued = () => {
        expect(channel.publish.called).to.equal(true)
        const [
          publishExchangeName,
          publishRoutingKey,
          publishAction,
          publishOptions
        ] = channel.publish.lastCall.args
        expect(publishExchangeName).to.equal(exchangeName)
        expect(publishAction).to.deep.equal(action)
        expect(publishOptions).to.deep.equal({ priority })
        expect(publishRoutingKey).to.equal(
          'actions.throttle.SEND_DARK_TWEET.123'
        )

        expect(buffer.called).to.equal(true)
        expect(buffer.lastCall.args).to.deep.equal([action])

        expect(channel.ack.called).to.equal(true)
      }

      const expectWarningLogged = error => {
        expect(logger.warn.lastCall.args).to.deep.equal([
          {
            err: error,
            action: {
              type: 'SEND_DARK_TWEET',
              text: 'text',
              media: ['mediaId'],
              userId: '123'
            }
          },
          `Error processing SEND_DARK_TWEET action: '${error.message}'. Requeuing...`
        ])
        expect(metrics.increment.lastCall.args).to.deep.equal([
          'actions.process.requeued'
        ])
      }

      it('should requeue actions for ECONNREFUSED error', async () => {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:3306')
        error.sqlMessage = undefined
        error.code = 'ECONNREFUSED'
        error.errno = 'ECONNREFUSED'

        await simulateDbError(error)

        expectActionRequeued()
        expectWarningLogged(error)
      })

      it('should requeue actions for ETIMEDOUT error', async () => {
        const error = new Error('connect ETIMEDOUT')
        error.sqlMessage = undefined
        error.code = 'ETIMEDOUT'
        error.errno = 'ETIMEDOUT'

        await simulateDbError(error)

        expectActionRequeued()
        expectWarningLogged(error)
      })

      it('should requeue actions for EPIPE error', async () => {
        const error = new Error('This socket has been ended by the other party')
        error.sqlMessage = undefined
        error.code = 'EPIPE'
        error.errno = 'EPIPE'

        await simulateDbError(error)

        expectActionRequeued()
        expectWarningLogged(error)
      })

      it('should requeue actions for PROTOCOL_CONNECTION_LOST error', async () => {
        const error = new Error(
          'Connection lost: The server closed the connection.'
        )
        error.sqlMessage = undefined
        error.code = 'PROTOCOL_CONNECTION_LOST'
        error.errno = 'PROTOCOL_CONNECTION_LOST'

        await simulateDbError(error)

        expectActionRequeued()
        expectWarningLogged(error)
      })
    })

    it('should discard duplicate error with code 187', async () => {
      const err = {
        statusCode: 403,
        name: 'HTTPError',
        message: 'Status is a duplicate.',
        type: 'HTTPError',
        response: {
          body: {
            errors: [{ code: 187, message: 'Tweet is a duplicate' }]
          }
        }
      }
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.info.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Status is a duplicate.'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should discard invalid token error with code 401', async () => {
      const err = {
        statusCode: 401,
        name: 'HTTPError',
        message: 'Invalid or expired token.',
        type: 'HTTPError',
        response: {
          body: {
            errors: [{ code: 401, message: 'Invalid or expired token' }]
          }
        }
      }
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.warn.lastCall.args).to.deep.equal([
        { alertLevel: 'support-tier-1' },
        `Error processing ${type} action: 'Invalid or expired token.'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it("should discard 'cannot DM user' error with code 349", async () => {
      const err = {
        statusCode: 403,
        name: 'HTTPError',
        message: 'You cannot send messages to this user.',
        type: 'HTTPError',
        response: {
          body: {
            errors: [
              { code: 349, message: 'You cannot send messages to this user.' }
            ]
          }
        }
      }

      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.info.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'You cannot send messages to this user.'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should log the type as "UNKNOWN" if the errored action has no type defined', async () => {
      const err = [
        { code: 123, message: 'This error internals is completely irrelevant' }
      ]
      const processAction = simple.mock().rejectWith(err)
      const { type, ...actionWithoutType } = action
      const parse = simple
        .mock()
        .returnWith({ ...actionWithoutType, twitterAccessTokens })

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(logger.child.lastCall.args).to.deep.equal([
        {
          err,
          action: actionWithoutType,
          errorDetails: getErrorDetailsObject(err)
        }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing UNKNOWN action: 'Twitter error ${
          err[0].code || ''
        }: This error internals is completely irrelevant'. Discarding...`
      ])
    })

    it('should handle other error with code', async () => {
      const err = [
        { code: 200, message: 'This is some other error with a code' }
      ]
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Twitter error ${
          err[0].code || ''
        }: This is some other error with a code'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should return a custom message if we did not receive one from twitter', async () => {
      const err = [{ code: 200 }]
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Unknown error with code 200'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should return "Unknown error" message if no code and no message', async () => {
      const err = [{ code: '', message: '' }]
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Twitter error: Unknown error'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should return a custom message for twitter error code 130', async () => {
      const err = [{ code: 130, message: 'Over capacity' }]
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Twitter error 130: ${err[0].message}. BR says: Over capacity'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should return a custom message for twitter error code 131', async () => {
      const err = [{ code: 131, message: 'Internal error' }]
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Twitter error 131: ${err[0].message}. BR says: Twitter Internal error'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should return a custom message for twitter error code 187', async () => {
      const err = [{ code: 187, message: 'Duplicate tweet' }]
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Twitter error 187: ${err[0].message}. BR says: Duplicate tweet'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should handle other error without code', async () => {
      const err = [{ message: 'This is some other error without a code' }]
      const processAction = simple.mock().rejectWith(err)

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        { err, action, errorDetails: getErrorDetailsObject(err) }
      ])
      expect(logger.error.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Twitter error: This is some other error without a code'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should log a warning instead of an error if ignoreErrors is set to true', async () => {
      const err = [{ message: 'This is some other error without a code' }]
      const processAction = simple.mock().rejectWith(err)

      const parse = simple
        .mock()
        .returnWith({ ...action, twitterAccessTokens, ignoreErrors: true })

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        {
          err,
          action: { ...action, ignoreErrors: true },
          errorDetails: getErrorDetailsObject(err)
        }
      ])
      expect(logger.info.lastCall.args).to.deep.equal([
        `Error processing ${type} action: 'Twitter error: This is some other error without a code'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should log a warning instead of an error if the error is a facebook rate limit error', async () => {
      const facebookAction = { ...action, type: 'SEND_FACEBOOK_MESSAGE' }
      const err = [
        { message: 'Calls to this api have exceeded the rate limit' }
      ]
      const processAction = simple.mock().rejectWith(err)

      const parse = simple.mock().returnWith({ ...facebookAction })

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        {
          err,
          action: { ...facebookAction },
          errorDetails: getErrorDetailsObject(err)
        }
      ])
      expect(logger.warn.lastCall.args).to.deep.equal([
        `Error processing SEND_FACEBOOK_MESSAGE action: 'Twitter error: Calls to this api have exceeded the rate limit'. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should log an info instead of an error if the error is a user archiving their conversation', async () => {
      const facebookAction = { ...action, type: 'SEND_FACEBOOK_MESSAGE' }
      const err = {
        message:
          '(#100) The thread owner has archived or deleted this conversation, or the thread does not exist.',
        error_subcode: 2534001
      }

      const processAction = simple.mock().rejectWith(err)

      const parse = simple.mock().returnWith({ ...facebookAction })

      await amqp.handleMessage(
        { channel, message },
        { parse, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      expect(logger.child.lastCall.args).to.deep.equal([
        {
          err,
          action: { ...facebookAction },
          errorDetails: getErrorDetailsObject(err)
        }
      ])
      expect(logger.info.lastCall.args).to.deep.equal([
        {
          error:
            '(#100) The thread owner has archived or deleted this conversation, or the thread does not exist.'
        },
        'User has archived/deleted the conversation. Discarding...'
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.discarded'
      ])
      expect(channel.ack.called).to.equal(true)
    })

    it('should discard an action if it is a duplicate (status 409)', async () => {
      const processResult = { status: 409, message: 'Duplicate' }
      const processAction = simple.mock().resolveWith(processResult)
      const sendFacebookMessageAction = {
        widgetId: 'some-widget_id',
        participantId: 'some-participant_id',
        type: 'SEND_FACEBOOK_MESSAGE',
        message: {
          message: {
            attachment: {
              type: 'template',
              payload: {
                title: "We'll remind you!",
                payload: 'some payload',
                image_url:
                  'https://i.postimg.cc/26Vx2Y3T/17895-S-Monday-Burger-Blue-Robot-Reminder-Experience-628x1200px-FA.jpg',
                template_type: 'notification_messages',
                notification_messages_reoptin: 'ENABLED',
                notification_messages_timezone: 'Africa/Johannesburg',
                notification_messages_frequency: 'DAILY'
              }
            }
          },
          recipient: {
            id: '4137552649681107'
          }
        }
      }

      const parsedSendFacebookMessage = simple
        .mock()
        .returnWith(sendFacebookMessageAction)

      await amqp.handleMessage(
        { channel, message },
        { parse: parsedSendFacebookMessage, isExpired, processAction }
      )

      expect(channel.publish.called).to.equal(false)
      // expect(logger.child.lastCall.args).to.deep.equal([
      //   { processResult, action }
      // ])
      expect(logger.info.lastCall.args).to.deep.equal([
        { action: sendFacebookMessageAction, result: processResult },
        `Duplicate ${sendFacebookMessageAction.type} action. Discarding...`
      ])
      expect(metrics.increment.lastCall.args).to.deep.equal([
        'actions.process.duplicate.SEND_FACEBOOK_MESSAGE'
      ])
      expect(channel.ack.called).to.equal(true)
    })
  })
})
