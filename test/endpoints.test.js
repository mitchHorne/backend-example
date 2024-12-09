const { assert, expect } = require('chai')
const simple = require('simple-mock')

const { logger } = require('@bluerobot/monitoring')
const {
  getStatusArrayFromString,
  getRetryStatuses,
  callEndpoint,
  unlockCoupons
} = require('../app/endpoints')

describe('endpoints', () => {
  const url = 'http://localhost'
  const method = 'get'
  const auth = {
    username: 'username',
    password: 'password'
  }
  const query = {
    param: 'param'
  }
  const form = {
    param: 'param'
  }

  const { Endpoints } = require('../app/endpoints') // eslint-disable-line
  describe('callEndpoint', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should resolve with body upon successful', () => {
      const body = 'BLAH BLAH BLAH'
      const requestParam = simple.mock().resolveWith(body)

      return callEndpoint(
        {
          method,
          url
        },
        { requestParam }
      ).then(result => {
        assert(requestParam.called)
        assert.deepEqual(result.body, body)
        assert.equal(result.retry, false)
      })
    })

    it('should correctly process a successful response without a body', () => {
      const requestParam = simple.mock().resolveWith()

      return callEndpoint(
        {
          method,
          url
        },
        { requestParam }
      ).then(result => {
        assert(requestParam.called)
        assert.equal(result.status, 204)
        assert.equal(result.retry, false)
      })
    })

    it("should reject if the body isn't valid JSON", done => {
      const requestParam = simple.mock()

      callEndpoint(
        {
          method: 'post',
          url,
          body: 'the most bogus JSON in the world'
        },
        { requestParam }
      ).catch(error => {
        assert.equal(
          error.message,
          'because of badly formatted JSON in the request body'
        )
        done()
      })
    })

    it('should include a content-type header if there is a body', () => {
      const requestParam = simple.mock()

      callEndpoint(
        {
          method: 'post',
          url,
          body: JSON.stringify({ x: 'y' })
        },
        { requestParam }
      ).then(() => {
        const [args] = requestParam.lastCall.args

        assert.deepEqual(args.headers, {
          'Content-Type': 'application/json'
        })
      })
    })

    it('should reject if there is any other error', () => {
      const error = new Error('oops!')
      const requestParam = simple.mock().rejectWith(error)

      return callEndpoint(
        {
          method,
          url
        },
        { requestParam }
      ).catch(error => {
        assert.equal(error.message, 'oops!')
      })
    })

    it('should reject with a destructured facebook error if facebook is called', () => {
      simple.mock(logger, 'error')
      const facebookUrl = 'https://graph.facebook.com/v19.0/messages/1234567890'
      const facebookError = {
        response: {
          body: 'facebook error',
          statusCode: 400
        }
      }
      const requestParam = simple.mock().rejectWith(facebookError)

      return callEndpoint(
        {
          method,
          url: facebookUrl
        },
        { requestParam }
      ).catch(error => {
        assert.equal(error.message, 'facebook error')
        expect(logger.error.lastCall.args[1]).to.equal(
          'Error processing request'
        )
      })
    })

    it('should include auth in requestOptions if it exists', () => {
      const requestParam = simple.mock().resolveWith('OK')

      return callEndpoint(
        {
          method,
          url,
          auth
        },
        { requestParam }
      ).then(() => {
        assert(requestParam.called)

        const [actual] = requestParam.lastCall.args
        assert.deepEqual(actual.username, auth.username)
        assert.deepEqual(actual.password, auth.password)
      })
    })

    it('should include query in requestOptions if it exists', () => {
      const requestParam = simple.mock().resolveWith('OK')

      return callEndpoint(
        {
          method,
          url,
          query
        },
        { requestParam }
      ).then(() => {
        assert(requestParam.called)

        const [actual] = requestParam.lastCall.args
        assert.deepEqual(actual.searchParams, query)
      })
    })

    it('should include form in requestOptions if it exists', () => {
      const requestParam = simple.mock().resolveWith('OK')

      return callEndpoint(
        {
          method,
          url,
          form
        },
        { requestParam }
      ).then(() => {
        assert(requestParam.called)

        const [actual] = requestParam.lastCall.args
        assert.deepEqual(actual.form, form)
      })
    })

    it('should resolve with retry if the response code is configured to retry', () => {
      const statusCode = 404
      const requestParam = simple.mock().resolveWith({ statusCode })

      return callEndpoint(
        {
          method,
          url,
          retryStatuses: `${statusCode}`
        },
        { requestParam }
      ).then(result => {
        assert(requestParam.called)
        assert.equal(result.retry, true)
      })
    })

    it('should resolve with retry if the error code ESOCKETTIMEDOUT', () => {
      const message = 'ERROR: ESOCKETTIMEDOUT'
      const requestParam = simple
        .mock()
        .rejectWith({ message, code: 'ESOCKETTIMEDOUT' })

      return callEndpoint(
        {
          method,
          url,
          retryRemaining: 1
        },
        { requestParam }
      ).then(result => {
        assert(requestParam.called)
        assert.equal(result.body, message)
        assert.equal(result.retry, true)
      })
    })

    it('should resolve with retry if the error code ETIMEDOUT', () => {
      const message = 'ERROR: ETIMEDOUT'
      const requestParam = simple
        .mock()
        .rejectWith({ message, code: 'ETIMEDOUT' })

      return callEndpoint(
        {
          method,
          url,
          retryRemaining: 1
        },
        { requestParam }
      ).then(result => {
        assert(requestParam.called)
        assert.deepEqual(result.body, message)
        assert.equal(result.retry, true)
      })
    })

    it('should not retry if the retryRemaining is less than 1', () => {
      const message = 'ERROR: ETIMEDOUT'
      const requestParam = simple.mock().rejectWith({ message })

      return callEndpoint(
        {
          method,
          url,
          retryRemaining: -1
        },
        { requestParam }
      )
        .then(() => {
          assert.fail('')
        })
        .catch(error => {
          assert.equal(error.message, message)
        })
    })

    it("should reject if required field 'url' is missing", done => {
      const requestParam = simple.mock()

      callEndpoint(
        {
          method
        },
        { requestParam }
      ).catch(error => {
        assert.equal(error.message, "because required field 'url' is missing")
        done()
      })
    })

    it("should reject if required field 'method' is missing", done => {
      const requestParam = simple.mock()

      callEndpoint(
        {
          url
        },
        { requestParam }
      ).catch(error => {
        assert.equal(
          error.message,
          "because required field 'method' is missing"
        )
        done()
      })
    })

    it('should reject if request throws an error with no retries remaining', async () => {
      const error = new Error('oops!')
      const requestParam = simple.mock().throwWith(error)

      try {
        await callEndpoint(
          {
            url,
            method,
            retryRemaining: 0
          },
          { requestParam }
        )
        assert.fail('We should have thrown an error here')
      } catch (err) {
        assert.equal(err.message, error.message)
      }
    })

    it('should reject if request throws an error with retries remaining not set', done => {
      const error = new Error('oops!')
      const requestParam = simple.mock().throwWith(error)

      callEndpoint(
        {
          url,
          method
        },
        { requestParam }
      ).catch(err => {
        assert.equal(err.message, error.message)
        done()
      })
    })

    it('should thow an error if max retries are exhausted', done => {
      const message = 'ERROR: some random error'
      const requestParam = simple.mock().rejectWith({ message })

      const action = {
        type: 'CALL_ENDPOINT',
        method: 'method',
        url: 'url',
        headers: {},
        body: '{}',
        timeout: '123',
        auth: {
          username: 'user',
          password: 'pass'
        },
        query: {
          param: 'param'
        },
        retryRemaining: '0'
      }

      callEndpoint(
        {
          ...action
        },
        { requestParam }
      ).catch(error => {
        assert.deepEqual(error.message, message)
        done()
      })
    })

    it('should thow an error if max retries is not a number', async () => {
      const nanError = new Error("'retryRemaining' must be a number")
      const requestParam = simple.mock().resolveWith('OK')

      const action = {
        type: 'CALL_ENDPOINT',
        method: 'method',
        url: 'url',
        headers: {},
        body: '{}',
        timeout: '123',
        auth: {
          username: 'user',
          password: 'pass'
        },
        query: {
          param: 'param'
        },
        retryRemaining: 'not a number'
      }

      try {
        await callEndpoint(
          {
            ...action
          },
          { requestParam }
        )

        assert.fail('Did not throw an error when max retries was not a number')
      } catch (error) {
        assert.deepEqual(error.message, nanError.message)
      }
    })

    it('should accept a body of type object', async () => {
      const requestParam = simple.mock().resolveWith('OK')

      const action = {
        type: 'CALL_ENDPOINT',
        method: 'method',
        url: 'url',
        headers: {},
        body: {},
        timeout: '123',
        auth: {
          username: 'user',
          password: 'pass'
        },
        query: {
          param: 'param'
        }
      }

      const result = await callEndpoint(
        {
          ...action
        },
        { requestParam }
      )

      assert.deepEqual(
        { status: 204, body: 'OK', retry: false, retryRemaining: undefined },
        result
      )
    })
    it('should accept a body of type string', async () => {
      const requestParam = simple.mock().resolveWith('OK')

      const action = {
        type: 'CALL_ENDPOINT',
        method: 'method',
        url: 'url',
        headers: {},
        body: '{}',
        timeout: '123',
        auth: {
          username: 'user',
          password: 'pass'
        },
        query: {
          param: 'param'
        }
      }

      const result = await callEndpoint(
        {
          ...action
        },
        { requestParam }
      )

      assert.deepEqual(
        { status: 204, body: 'OK', retry: false, retryRemaining: undefined },
        result
      )
    })

    it('should always retry timeout errors', async () => {
      const message = 'ERROR: ESOCKETTIMEDOUT'
      const requestParam = simple
        .mock()
        .rejectWith({ message, code: 'ESOCKETTIMEDOUT' })

      const action = {
        type: 'CALL_ENDPOINT',
        method: 'method',
        url: 'url',
        headers: {},
        body: '{}',
        timeout: '123',
        auth: {
          username: 'user',
          password: 'pass'
        },
        query: {
          param: 'param'
        }
      }

      try {
        const result = await callEndpoint(
          {
            ...action
          },
          { requestParam }
        )
        assert.deepEqual(
          {
            status: 'ESOCKETTIMEDOUT',
            body: 'ERROR: ESOCKETTIMEDOUT',
            retry: true,
            retryRemaining: 100
          },
          result
        )
      } catch (e) {
        assert.fail(`Did not retry action correctly: ${e.message}`)
      }
    })

    it('should log a warning on timeout errors', async () => {
      simple.mock(logger, 'warn').resolveWith()
      const message = 'ERROR: ESOCKETTIMEDOUT'
      const requestParam = simple
        .mock()
        .rejectWith({ message, code: 'ESOCKETTIMEDOUT' })

      const userId = 'a user'
      const widgetId = 'a widget'
      const timeout = '123'

      const action = {
        userId,
        widgetId,
        type: 'CALL_ENDPOINT',
        method: 'method',
        url: 'url',
        headers: {},
        body: '{}',
        timeout,
        auth: {
          username: 'user',
          password: 'pass'
        },
        query: {
          param: 'param'
        }
      }

      await callEndpoint(
        {
          ...action
        },
        { requestParam }
      )
      expect(logger.warn.lastCall.args).to.deep.equal([
        {
          method: 'method',
          url: 'url',
          err: { message, code: 'ESOCKETTIMEDOUT' },
          userId,
          widgetId,
          timeout: Number(timeout),
          retryRemaining: 100
        },
        `A timeout occurred processing a request for owner '${userId}'`
      ])
    })
  })

  describe('getStatusArrayFromString', () => {
    it('should return single value in result array when only one is passed', () => {
      const status = 403
      const expected = [status]

      assert.deepEqual(getStatusArrayFromString(`${status}`), expected)
      assert.deepEqual(getStatusArrayFromString(`${status},`), expected)
    })

    it('should skip invalid values', () => {
      const expected = []

      assert.deepEqual(getStatusArrayFromString('bogus,values,rock'), expected)
    })

    it('should remove spaces in values', () => {
      const expected = [403, 503, 504]

      assert.deepEqual(getStatusArrayFromString('403,   503,504'), expected)
    })

    it('should return empty result array when no value proviced', () => {
      const expected = []

      assert.deepEqual(getStatusArrayFromString(), expected)
    })

    it('should return result array', () => {
      const valueString = '403,503,504'
      const expected = [403, 503, 504]

      assert.deepEqual(getStatusArrayFromString(valueString), expected)
    })
  })

  describe('getRetryStatuses', () => {
    it('should use value from action', () => {
      const valuesString = '404,403'
      const expected = [404, 403]
      const action = { retryStatuses: valuesString }
      const fromEnvironment = null

      const actual = getRetryStatuses(action, fromEnvironment)

      assert.deepEqual(actual, expected)
    })

    it('should use value from environment', () => {
      const valuesString = '404,403'
      const expected = [404, 403]
      const action = {}
      const fromEnvironment = valuesString

      const actual = getRetryStatuses(action, fromEnvironment)

      assert.deepEqual(actual, expected)
    })

    it('should use default if no other value available', () => {
      const expected = [408, 503, 504]
      const action = {}
      const fromEnvironment = null

      const actual = getRetryStatuses(action, fromEnvironment)

      assert.deepEqual(actual, expected)
    })

    it('should use empty array when invalid, non-null value provided', () => {
      const expected = []

      assert.deepEqual(
        getRetryStatuses({ retryStatuses: 'none' }, null),
        expected
      )
      assert.deepEqual(getRetryStatuses({}, 'none'), expected)
    })
  })

  describe('unlockCoupons', () => {
    beforeEach(() => {
      simple.restore()
    })
    const action = {
      widgetId: '1',
      amountOfCoupons: 100
    }

    it('Should call the endpoint with the correct parameters', async () => {
      const mockRequest = simple.mock().resolveWith({ statusCode: 200 })
      const expectedBody = JSON.stringify(action)
      const expectedUrl = `${process.env.COUPON_SERVICE_URL}/coupon/unlock/${action.widgetId}`
      const expectedMethod = 'POST'
      const expected = {
        body: expectedBody,
        url: expectedUrl,
        method: expectedMethod
      }
      const code = await unlockCoupons(action, { req: mockRequest })

      expect(code).to.equal(200)
      expect(mockRequest.calls.length).to.equal(1)
      expect(mockRequest.lastCall.args[0]).to.deep.equal(expected)
    })

    it('Should call the endpoint with the correct parameters', async () => {
      const mockRequest = simple
        .mock()
        .rejectWith({ response: { body: 'Bad juju', statusCode: 500 } })
      simple.mock(logger, 'error')

      const expectedBody = JSON.stringify(action)
      const expectedUrl = `${process.env.COUPON_SERVICE_URL}/coupon/unlock/${action.widgetId}`
      const expectedMethod = 'POST'
      const expected = {
        body: expectedBody,
        url: expectedUrl,
        method: expectedMethod
      }
      const code = await unlockCoupons(action, { req: mockRequest })

      expect(code).to.equal(500)
      expect(mockRequest.calls.length).to.equal(1)
      expect(mockRequest.lastCall.args[0]).to.deep.equal(expected)
      expect(logger.error.calls.length).to.equal(1)
      expect(logger.error.lastCall.args).to.deep.equal([
        { message: 'Bad juju', statusCode: 500 },
        `Failed call to coupon service to update coupons for widget ${action.widgetId}`
      ])
    })
  })
})
