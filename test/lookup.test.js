const { assert, expect } = require('chai')
const simple = require('simple-mock')

const { logger } = require('@bluerobot/monitoring')
const { getLookupData } = require('../app/lookup')

describe('lookup', () => {
  const url = 'http://localhost'
  const id = 'test'
  const username = 'username'
  const password = 'password'

  const validFieldValue = 'test-value'

  const successfulApiResponse = {
    statusCode: 200,
    body: {
      test: validFieldValue
    }
  }

  const validLookupApiAction = {
    url,
    id,
    username,
    password
  }

  describe('getLookupData', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should resolve with stringfied response body on success when response returns with success status code and JSON object body', async () => {
      const requestParam = simple.mock().resolveWith(successfulApiResponse)

      const expected = JSON.stringify(successfulApiResponse.body)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      const actual = result.body

      assert.isFalse(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.deepEqual(actual, expected)
    })

    it('should resolve with stringified response on success when response returns data JSON object only', async () => {
      const successfulApiResponseDataOnly = {
        test: validFieldValue
      }

      const expected = JSON.stringify(successfulApiResponseDataOnly)

      const requestParam = simple
        .mock()
        .resolveWith(successfulApiResponseDataOnly)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      const actual = result.body

      assert.isFalse(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.deepEqual(actual, expected)
    })

    it('should resolve with response body on success when response returns with success status code and JSON string body', async () => {
      const jsonStringApiResponseBody = '{"test": "test-value"}'

      const jsonStringApiResponse = {
        statusCode: 200,
        body: jsonStringApiResponseBody
      }

      const requestParam = simple.mock().resolveWith(jsonStringApiResponse)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      const expected = jsonStringApiResponseBody
      const actual = result.body

      assert.isFalse(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.deepEqual(actual, expected)
    })

    it('should throw an error if url is not defined in action', async () => {
      const lookupActionMissingUrl = {
        id,
        username,
        password
      }

      const requestParam = simple.mock().resolveWith()

      assert.isRejected(
        getLookupData(lookupActionMissingUrl, { requestParam }),
        "Required field 'url' is missing"
      )
    })

    it('should throw an error if id is not defined in action', async () => {
      const lookupActionMissingId = {
        url,
        username,
        password
      }

      const requestParam = simple.mock().resolveWith()

      assert.isRejected(
        getLookupData(lookupActionMissingId, { requestParam }),
        "Required field 'id' is missing"
      )
    })

    it('should resolve with lookupFailed when response body is null', async () => {
      const invalidApiResponse = {
        statusCode: 200,
        body: null
      }

      const requestParam = simple.mock().resolveWith(invalidApiResponse)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      assert.isTrue(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.isNull(result.body)
    })

    it('should resolve with lookupFailed when response body is empty', async () => {
      const invalidApiResponse = {
        statusCode: 200,
        body: {}
      }

      const requestParam = simple.mock().resolveWith(invalidApiResponse)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      assert.isTrue(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.isNull(result.body)
    })

    it('should resolve with lookupFailed when identifier field not in API response', async () => {
      const invalidApiResponse = {
        statusCode: 200,
        body: {
          incorrectFieldName: 'test response'
        }
      }

      const requestParam = simple.mock().resolveWith(invalidApiResponse)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      assert.isTrue(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.isNull(result.body)
    })

    it('should resolve with lookupFailed when identifier field value contains excessive punctuation', async () => {
      const invalidApiResponse = {
        statusCode: 200,
        body: {
          test: 'hello!!!!!!'
        }
      }

      const requestParam = simple.mock().resolveWith(invalidApiResponse)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      assert.isTrue(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.isNull(result.body)
    })

    it('should resolve with lookupFailed when identifier field value contains a url', async () => {
      const invalidApiResponse = {
        statusCode: 200,
        body: {
          test: 'please visit https://www.google.com'
        }
      }

      const requestParam = simple.mock().resolveWith(invalidApiResponse)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      assert.isTrue(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.isNull(result.body)
    })

    it('should resolve with lookupFailed when identifier field value exceeds 30 characters', async () => {
      const invalidApiResponse = {
        statusCode: 200,
        body: {
          test: 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'
        }
      }

      const requestParam = simple.mock().resolveWith(invalidApiResponse)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      assert.isTrue(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.isNull(result.body)
    })

    it('should resolve with lookupFailed and log warning when permanent expected error occurs', async () => {
      simple.mock(logger, 'warn').resolveWith()

      const permanentExpectedError = new Error()
      permanentExpectedError.statusCode = 501
      permanentExpectedError.error = 'Not Implemented'

      const requestParam = simple.mock().rejectWith(permanentExpectedError)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      assert.isTrue(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.isNull(result.body)

      const loggerActual = logger.warn.lastCall.args
      const loggerExpected = [
        {
          url,
          id,
          err: permanentExpectedError
        },
        `Permanent Expected error occured making lookup request to: ${url}`
      ]

      expect(loggerActual).to.deep.equal(loggerExpected)
    })

    it('should resolve with lookupFailed and log error when permanent unexpected HTTP error occurs', async () => {
      simple.mock(logger, 'error').resolveWith()

      const permanentUnexpectedError = new Error()
      permanentUnexpectedError.statusCode = 403
      permanentUnexpectedError.error = 'Unauthorized'

      const requestParam = simple.mock().rejectWith(permanentUnexpectedError)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      assert.isTrue(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.isNull(result.body)

      const loggerActual = logger.error.lastCall.args
      const loggerExpected = [
        {
          url,
          id,
          err: permanentUnexpectedError
        },
        `Permanent Unexpected error occured making lookup request to: ${url}`
      ]

      expect(loggerActual).to.deep.equal(loggerExpected)
    })

    it('should resolve with lookupFailed and log error when NodeJS system error occurs', async () => {
      simple.mock(logger, 'error').resolveWith()

      const nodeJsSystemError = new Error()
      nodeJsSystemError.code = 'ETIMEDOUT'

      const requestParam = simple.mock().rejectWith(nodeJsSystemError)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      assert.isTrue(result.lookupFailed)
      assert.isFalse(result.lookupTransientError)
      assert.isNull(result.body)

      const loggerActual = logger.error.lastCall.args
      const loggerExpected = [
        {
          url,
          id,
          err: nodeJsSystemError
        },
        `Error occured making lookup request to: ${url}`
      ]

      expect(loggerActual).to.deep.equal(loggerExpected)
    })

    it('should resolve with lookupTransientError and log error when transient error occurs', async () => {
      simple.mock(logger, 'warn').resolveWith()

      const transientErrorStatusCode = 502
      const transientErrorMessage = 'Bad Gateway'

      const failedApiResponse = {
        statusCode: transientErrorStatusCode,
        error: transientErrorMessage
      }

      const requestParam = simple.mock().rejectWith(failedApiResponse)

      const result = await getLookupData(validLookupApiAction, { requestParam })

      assert.isFalse(result.lookupFailed)
      assert.isTrue(result.lookupTransientError)
      assert.isNull(result.body)

      const loggerActual = logger.warn.lastCall.args
      const loggerExpected = [
        {
          url,
          id,
          err: failedApiResponse
        },
        `Transient error occured making lookup request to: ${url}`
      ]

      expect(loggerActual).to.deep.equal(loggerExpected)
    })
  })
})
