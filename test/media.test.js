const { expect, assert } = require('chai')
const simple = require('simple-mock')
const { logger } = require('@bluerobot/monitoring')
const nock = require('nock')

const media = require('../app/media')

const userId = 'user-id'
const gcsMediaId = 'gcs-media-id-1'
const gcsMediaIds = [gcsMediaId]
const destination = 'tweet'

describe('Media', () => {
  describe('getTwitterMediaIds', () => {
    beforeEach(() => {
      simple.mock(logger, 'debug')
      simple.mock(logger, 'info')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'error')
    })

    afterEach(() => {
      simple.restore()
    })

    it('should error when param gcsMediaIds is not an array', () => {
      return media
        .getTwitterMediaIds({
          userId,
          destination
        })
        .then(() => {
          assert.fail('should throw on invalid type')
        })
        .catch(e => {
          expect(e.message).to.equal("Param 'gcsMediaIds' should be an array")
        })
    })

    it('should error when param userId is not a string', () => {
      return media
        .getTwitterMediaIds({
          gcsMediaIds,
          destination
        })
        .then(() => {
          assert.fail('should throw on invalid type')
        })
        .catch(e => {
          expect(e.message).to.equal("Param 'userId' should be a string")
        })
    })

    it("should error when param destination is not 'tweet' or 'dm'", () => {
      return media
        .getTwitterMediaIds({
          gcsMediaIds,
          userId,
          destination: 'blah'
        })
        .then(() => {
          assert.fail('should throw on invalid destination')
        })
        .catch(e => {
          expect(e.message).to.equal(
            "Param 'destination' should be either 'tweet' or 'dm'"
          )
        })
    })

    it('should return an empty array if one is provided', () => {
      const getTwitterMediaIdMock = simple.mock(
        media,
        'getTwitterMediaId',
        ({ gcsMediaId }) =>
          Promise.resolve(gcsMediaId.replace('gcs', 'twitter'))
      )
      const gcsMediaIds = []
      const twitterMediaIds = []

      return media
        .getTwitterMediaIds({
          gcsMediaIds,
          userId,
          destination
        })
        .then(result => {
          expect(result).to.deep.equal(twitterMediaIds)
          expect(getTwitterMediaIdMock.called).to.equal(false)
        })
    })

    it('should return the result of getTwitterMediaId', () => {
      simple.mock(media, 'getTwitterMediaId', ({ gcsMediaId }) =>
        Promise.resolve(gcsMediaId.replace('gcs', 'twitter'))
      )
      const gcsMediaIds = ['gcs_1', 'gcs_2', 'gcs_3']
      const twitterMediaIds = ['twitter_1', 'twitter_2', 'twitter_3']

      return media
        .getTwitterMediaIds({
          gcsMediaIds,
          userId,
          destination
        })
        .then(result => {
          expect(result).to.deep.equal(twitterMediaIds)
        })
    })

    it('should return any error thrown by getTwitterMediaId', () => {
      const errorMsg = 'Error calling media service'
      const getTwitterMediaIdError = new Error(errorMsg)
      simple.mock(media, 'getTwitterMediaId', () =>
        Promise.reject(getTwitterMediaIdError)
      )
      const gcsMediaIds = ['gcs_1', 'gcs_2', 'gcs_3']

      return media
        .getTwitterMediaIds({
          gcsMediaIds,
          userId,
          destination
        })
        .then(result => {
          assert.fail('Expected reject with error')
        })
        .catch(e => {
          expect(e.message).to.equal(errorMsg)
        })
    })
  })

  describe('getTwitterMediaId', () => {
    let mediaUri
    beforeEach(() => {
      simple.mock(media, 'isGcsMediaId').returnWith(true)
      simple.mock(logger, 'debug')
      simple.mock(logger, 'info')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'error')
      mediaUri = 'http://media'
    })

    afterEach(() => {
      simple.restore()
      mediaUri = ''
      nock.cleanAll()
    })

    const id = 'twitter-media-id-1'
    const responseBody = {
      id
    }

    it('should error when param gcsMediaId is not a string', () => {
      return media
        .getTwitterMediaId({
          userId,
          destination
        })
        .then(() => {
          assert.fail('should throw on invalid type')
        })
        .catch(e => {
          expect(e.message).to.equal("Param 'gcsMediaId' should be a string")
        })
    })

    it('should resolve with passed in value if value is not GCS media id', () => {
      const twitterMediaId = '928534384524845056'
      const isGcsMediaIdMock = simple
        .mock(media, 'isGcsMediaId')
        .returnWith(false)
      return media
        .getTwitterMediaId(
          {
            gcsMediaId: twitterMediaId,
            userId,
            destination
          },
          {
            mediaUri
          }
        )
        .then(result => {
          expect(isGcsMediaIdMock.called).to.equal(true)
          expect(result).to.deep.equal(twitterMediaId)
          expect(logger.debug.firstCall.arg).to.deep.equal(
            `Incorrect gcs media id format, assuming media id ('${twitterMediaId}') is in twitter format...`
          )
        })
    })

    it('should error when param userId is not a string', () => {
      return media
        .getTwitterMediaId({
          gcsMediaId,
          destination
        })
        .then(() => {
          assert.fail('should throw on invalid type')
        })
        .catch(e => {
          expect(e.message).to.equal("Param 'userId' should be a string")
        })
    })

    it("should error when param destination is not 'tweet' or 'dm'", () => {
      return media
        .getTwitterMediaId({
          gcsMediaId,
          userId,
          destination: 'blah'
        })
        .then(() => {
          assert.fail('should throw on invalid destination')
        })
        .catch(e => {
          expect(e.message).to.equal(
            "Param 'destination' should be either 'tweet' or 'dm'"
          )
        })
    })

    it('should return twitter media id', () => {
      nock(mediaUri)
        .get(`/twitter/${gcsMediaId}`)
        .query({
          destination
        })
        .reply(200, responseBody)

      return media
        .getTwitterMediaId(
          {
            gcsMediaId,
            userId,
            destination
          },
          {
            mediaUri
          }
        )
        .then(result => {
          expect(result).to.deep.equal(id)
          expect(logger.debug.calls[0].arg).to.deep.equal(
            `Calling media service to obtain twitter media id (${destination}) for gcs media id '${gcsMediaId}'...`
          )
          expect(logger.debug.calls[1].arg).to.deep.equal(
            `Obtained twitter media id '${id}'`
          )
        })
    })

    it('should call the upload endpoint if no twitter media id is available', () => {
      nock(mediaUri)
        .get(`/twitter/${gcsMediaId}`)
        .query({
          destination
        })
        .reply(200)

      nock(mediaUri)
        .get(`/twitter/upload/${userId}/${gcsMediaId}`)
        .query({
          destination
        })
        .reply(200, responseBody)

      return media
        .getTwitterMediaId(
          {
            gcsMediaId,
            userId,
            destination
          },
          {
            mediaUri
          }
        )
        .then(result => {
          expect(logger.debug.calls[1].arg).to.deep.equal(
            `No twitter media id available, calling media service to upload media to twitter for gcs media id '${gcsMediaId}'...`
          )
          expect(result).to.equal(id)
          expect(logger.debug.calls[2].arg).to.deep.equal(
            `Obtained twitter media id '${id}'`
          )
        })
    })

    it('should call the upload endpoint if response body is empty', () => {
      nock(mediaUri)
        .get(`/twitter/${gcsMediaId}`)
        .query({
          destination
        })
        .reply(200)

      nock(mediaUri)
        .get(`/twitter/upload/${userId}/${gcsMediaId}`)
        .query({
          destination
        })
        .reply(200, responseBody)

      return media
        .getTwitterMediaId(
          {
            gcsMediaId,
            userId,
            destination
          },
          {
            mediaUri
          }
        )
        .then(result => {
          expect(logger.debug.calls[1].arg).to.deep.equal(
            `No twitter media id available, calling media service to upload media to twitter for gcs media id '${gcsMediaId}'...`
          )
          expect(result).to.equal(id)
          expect(logger.debug.calls[2].arg).to.deep.equal(
            `Obtained twitter media id '${id}'`
          )
        })
    })

    it('should resolve with undefined if the media id is not ', () => {
      nock(mediaUri)
        .get(`/twitter/${gcsMediaId}`)
        .query({
          destination
        })
        .reply(200)

      nock(mediaUri)
        .get(`/twitter/upload/${userId}/${gcsMediaId}`)
        .query({
          destination
        })
        .reply(200)

      return media
        .getTwitterMediaId(
          {
            gcsMediaId,
            userId,
            destination
          },
          {
            mediaUri
          }
        )
        .then(result => {
          expect(logger.debug.calls[1].arg).to.deep.equal(
            `No twitter media id available, calling media service to upload media to twitter for gcs media id '${gcsMediaId}'...`
          )
          expect(result).to.equal(undefined)
          expect(logger.debug.calls[2].arg).to.deep.equal(
            'No twitter media id available')
        })
    })

    it('should reject with generic error', () => {
      const errorMsg = 'Failed to connect to database'
      nock(mediaUri)
        .get(`/twitter/${gcsMediaId}`)
        .query({
          destination
        })
        .reply(503, errorMsg)

      return media
        .getTwitterMediaId(
          {
            gcsMediaId,
            userId,
            destination
          },
          {
            mediaUri
          }
        )
        .then(
          () => {
            assert.fail('expected an error to have occurred')
          },
          error => {
            const { statusCode, body } = error.response
            expect(statusCode).to.equal(503)
            expect(body).to.equal(errorMsg)
          }
        )
    })

    it('should reject with twitter error', () => {
      nock(mediaUri)
        .get(`/twitter/${gcsMediaId}`)
        .query({
          destination
        })
        .reply(200)

      nock(mediaUri)
        .get(`/twitter/upload/${userId}/${gcsMediaId}`)
        .query({
          destination
        })
        .reply(429, undefined, {
          'x-rate-limit-reset': 10
        })

      return media
        .getTwitterMediaId(
          {
            gcsMediaId,
            userId,
            destination
          },
          {
            mediaUri
          }
        )
        .then(
          () => {
            assert.fail('expected an error to have occurred')
          },
          error => {
            const { statusCode, headers } = error.response
            expect(statusCode).to.equal(429)
            expect(headers).to.deep.equal({
              'x-rate-limit-reset': '10'
            })
          }
        )
    })
  })

  describe('isGcsMediaId', () => {
    it('should match gcs media ids', () => {
      const mediaId = '118f0061-c489-11e7-8330-0242ac190002'
      expect(media.isGcsMediaId(mediaId)).to.equal(true)
    })

    it('should not match twitter ids', () => {
      const mediaId = '928534384524845056'
      expect(media.isGcsMediaId(mediaId)).to.equal(false)
    })
  })
})
