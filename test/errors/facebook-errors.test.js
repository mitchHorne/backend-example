const { expect } = require('chai')
const simple = require('simple-mock')
const { handleMetaApiResponse } = require('../../app/errors/facebook-errors')
const utils = require('../../app/utils')
const endpoints = require('../../app/endpoints')
const { logger } = require('@bluerobot/monitoring')

describe('Facebook API error handler', () => {
  it('should handle rate limited errors', async () => {
    const fbDelayStatuses = utils.getFbDelayStatuses()

    fbDelayStatuses.forEach(async status => {
      const action = {
        type: 'SEND_FACEBOOK_COMMENT',
        userId: '12345'
      }
      simple.mock(utils, 'setRateLimit').resolveWith({
        action,
        delay: 1000
      })
      const error = {
        response: {
          body: {
            error: {
              code: status
            }
          }
        },
        statusCode: 200
      }
      const result = await handleMetaApiResponse(error, action)
      expect(result).to.deep.equal({
        metaResponseBody: error.response.body,
        metaResponseCode: 200,
        action,
        delay: 1000
      })
    })
  })

  it('should handle duplicate opt in errors', async () => {
    const action = {
      type: 'SEND_FACEBOOK_MESSAGE',
      userId: '12345'
    }
    const error = {
      response: {
        body: {
          error: {
            code: 613,
            error_subcode: 1893016
          }
        }
      },
      statusCode: 400
    }
    simple.mock(utils, 'setRateLimit').resolveWith()
    const result = await handleMetaApiResponse(error, action)
    expect(result).to.deep.equal({
      isHandled: true,
      metaResponseBody: error.response.body,
      metaResponseCode: 400
    })
  })

  it('should handle stopped notification errors', async () => {
    const action = {
      type: 'SEND_FACEBOOK_MESSAGE',
      userId: '12345'
    }
    const error = {
      response: {
        body: {
          error: {
            code: 10,
            error_subcode: 1893015
          }
        }
      },
      statusCode: 400
    }
    simple.mock(utils, 'setRateLimit').resolveWith()
    const result = await handleMetaApiResponse(error, action)
    expect(result).to.deep.equal({
      isHandled: true,
      metaResponseBody: error.response.body,
      metaResponseCode: 400,
      deleteParticipant: true
    })
  })

  it('should handle user not available errors', async () => {
    simple.mock(logger, 'warn')

    const action = {
      type: 'SEND_FACEBOOK_MESSAGE',
      userId: '12345',
      participantId: 'P1234',
      widgetId: 'W1234'
    }
    const error = {
      response: { body: { error: { code: 551 } } },
      statusCode: 400
    }

    const result = await handleMetaApiResponse(error, action)
    expect(result).to.deep.equal({
      isHandled: true,
      metaResponseBody: error.response.body,
      metaResponseCode: 400
    })
  })

  it('should handle unexpected internal facebook errors', async () => {
    simple.mock(logger, 'warn')

    const action = {
      type: 'SEND_FACEBOOK_MESSAGE',
      userId: '12345',
      participantId: 'P1234',
      widgetId: 'W1234'
    }
    const error = {
      response: { body: { error: { code: -1 } } },
      statusCode: 400
    }

    const result = await handleMetaApiResponse(error, action)
    expect(result).to.deep.equal({
      isHandled: true,
      metaResponseBody: error.response.body,
      metaResponseCode: 400
    })
  })

  it('should handle other errors', async () => {
    const action = {
      type: 'SEND_FACEBOOK_MESSAGE',
      userId: '12345'
    }
    const error = {
      response: {
        body: {
          error: {
            code: 123
          }
        }
      }
    }
    simple.mock(utils, 'setRateLimit').resolveWith()
    const result = await handleMetaApiResponse(error, action)
    expect(result).to.deep.equal({
      error,
      isHandled: false,
      metaResponseBody: error.response.body,
      metaResponseCode: 0
    })
  })

  it('should handle non-Meta response thrown errors', async () => {
    const error = new Error('non-meta error')
    simple.mock(endpoints, 'callEndpoint').rejectWith(error)
    const action = {
      type: 'SEND_FACEBOOK_MESSAGE',
      userId: '12345'
    }
    const result = await handleMetaApiResponse(error, action)
    expect(result).to.deep.equal({
      error,
      isHandled: false,
      metaResponseBody: {},
      metaResponseCode: 0
    })
  })
})
