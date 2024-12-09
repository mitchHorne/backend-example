const chai = require('chai')
const simple = require('simple-mock')
const nock = require('nock')
const { omit } = require('ramda')

const { assert, expect } = chai
const media = require('../app/media')
const twitter = require('../app/twitter') // eslint-disable-line
const utils = require('../app/utils')
const db = require('../app/db')
const { logger } = require('@bluerobot/monitoring')
const crypt = require('@bluerobot/crypt-keeper')
const tk = require('timekeeper')
const { HTTPError } = require('@bluerobot/request')

const time = new Date('00:00:00 13 October 2020')

tk.freeze(time)

const ONE_HOUR_DELAY = 1 * 60 * 60 * 1000

const tweetAction = {
  widgetId: 'widget-id',
  token: 'client token',
  secret: 'client secret',
  text: 'some text',
  media: ['some media'],
  statusId: '1',
  userId: 'user-id',
  ownerHandle: 'MaleniaBladeOfMiquella',
  recipientHandle: 'MohgTheBloodGod',
  recipientId: '666'
}

const randomResponseTweetAction = {
  widgetId: 'widget-id',
  recipientId: '666',
  recipientHandle: 'MohgTheBloodGod',
  ownerHandle: 'MaleniaBladeOfMiquella',
  token: 'client token',
  secret: 'client secret',
  text: 'some text',
  statusId: '1',
  userId: 'user-id',
  isRandomResponse: true,
  randomResponsePoolId: 'sample-pool-id',
  tweetMediaIds: ['some media'],
  hashedResponse:
    '1705c6e4ae4eb2464e591eac0b6c0ec7981f05032bb1c279d640fa705d229bd4'
}

const isMosaicConsentTweetAction = {
  widgetId: 'widget-id',
  token: 'client token',
  secret: 'client secret',
  text: 'some text',
  statusId: '1',
  userId: 'user-id',
  isMosaicConsent: true,
  tweetMediaIds: ['some media'],
  ownerHandle: 'MaleniaBladeOfMiquella',
  recipientHandle: 'MohgTheBloodGod',
  recipientId: '666'
}

const tweetResponseBody = {
  data: {
    id: 'tweet-id',
    text: 'some text'
  }
}

const url = 'https://api.twitter.com/2'
const path = '/tweets'
describe('twitter', () => {
  beforeEach(() => {
    simple.mock(crypt, 'decrypt', () => {})
    simple.mock(db, 'storeTweet').resolveWith()
    simple.mock(db, 'upsertRateLimit').resolveWith()
  })

  afterEach(() => {
    simple.restore()
  })

  describe('sendTweet', () => {
    beforeEach(() => {
      simple.mock(media, 'getTwitterMediaIds', ({ gcsMediaIds }) =>
        Promise.resolve(gcsMediaIds)
      )
      simple.mock(db, 'storeTweet').resolveWith()
      simple.mock(db, 'getTweetDuplicates').resolveWith([[]])
      simple.mock(logger, 'debug')
      simple.mock(logger, 'info')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'error')
    })

    afterEach(() => {
      simple.restore()
      nock.cleanAll()
    })

    it('should call twitter.post', async () => {
      const postCalled = nock(url)
        .post(path, { text: 'some text', media: { media_ids: ['some media'] } })
        .reply(200, tweetResponseBody)

      await twitter.sendTweet(tweetAction)

      assert(postCalled.isDone())
    })

    it('should delay action on rate limit error', async () => {
      nock(url)
        .post(path, { text: 'some text', media: { media_ids: ['some media'] } })
        .reply(
          429,
          {
            status: 88,
            detail: 'Rate limit exceeded'
          },
          {
            'x-rate-limit-reset': time.valueOf() / 1000 + 500,
            'x-rate-limit-limit': 1000,
            'x-rate-limit-remaining': 0
          }
        )

      // obj.post.callbackWith(null, undefined, { headers: { abc: '123' }, statusCode: 429 });
      simple.mock(db, 'upsertRateLimit').resolveWith()

      await expect(twitter.sendTweet(tweetAction)).to.eventually.deep.equal({
        action: {
          media: ['some media'],
          secret: 'client secret',
          statusId: '1',
          text: 'some text',
          token: 'client token',
          widgetId: 'widget-id',
          userId: 'user-id',
          ownerHandle: 'MaleniaBladeOfMiquella',
          recipientHandle: 'MohgTheBloodGod',
          recipientId: '666'
        },
        delay: 502000 // number of milliseconds delayed
      })
      assert(db.upsertRateLimit.called, 'upsertRateLimit not called')
    })

    it('should reject when check rate limit fails', () => {
      nock(url)
        .post(path, { text: 'some text', media: { media_ids: ['some media'] } })
        .reply(
          429,
          {
            status: 88,
            detail: 'Rate limit exceeded'
          },
          {
            'x-rate-limit-limit': 1000,
            'x-rate-limit-remaining': 0
          }
        )

      return expect(twitter.sendTweet(tweetAction)).to.be.rejectedWith(
        /No x-rate-limit-reset field found in headers of the rate limited TWITTER response/
      )
    })

    it('should delay action on daily update limit error', () => {
      nock(url)
        .post(path, { text: 'some text', media: { media_ids: ['some media'] } })
        .reply(403, {
          status: 185,
          detail: 'User is over daily status update limit'
        })

      return expect(twitter.sendTweet(tweetAction)).to.eventually.deep.equal({
        action: tweetAction,
        delay: ONE_HOUR_DELAY
      })
    })

    it('should reject when it fails to send the tweet', () => {
      nock(url)
        .post(path, { text: 'some text', media: { media_ids: ['some media'] } })
        .replyWithError('oops')

      return expect(
        twitter.sendTweet(tweetAction)
      ).to.eventually.be.rejectedWith(/oops/)
    })

    it('should call the db to store tweet', () => {
      const postCalled = nock(url)
        .post(path, { text: 'some text', media: { media_ids: ['some media'] } })
        .reply(200, tweetResponseBody)

      return twitter.sendTweet(tweetAction).then(() => {
        assert(postCalled.isDone())

        expect(db.storeTweet.lastCall.args).to.deep.equal([
          {
            createdAt: 1602547200000,
            senderHandle: 'MaleniaBladeOfMiquella',
            senderId: 'user-id',
            mentionedUserId: '666',
            mentionedHandle: 'MohgTheBloodGod',
            tweetContentHash:
              '6ca86fae70c37c12ee729610842c18b66bdb3697f5fc28124e648bdfb181f0f8',
            tweetId: 'tweet-id',
            widgetId: 'widget-id',
            tweet: {
              id: tweetResponseBody.data.id,
              text: tweetResponseBody.data.text
            },
            responseHash: null
          }
        ])
      })
    })

    it('should handle db error when storing tweet', () => {
      const postCalled = nock(url)
        .post(path, { text: 'some text', media: { media_ids: ['some media'] } })
        .reply(200, tweetResponseBody)

      const err = new Error('widget not found')
      simple.mock(db, 'storeTweet').rejectWith(err)

      return twitter.sendTweet(tweetAction).then(() => {
        assert(postCalled.isDone())
      })
    })

    it('should retry when we get a timeout error', () => {
      nock(url)
        .post(path, { text: 'some text', media: { media_ids: ['some media'] } })
        .replyWithError({
          code: 'ETIMEDOUT',
          message: 'Error: ETIMEDOUT'
        })

      return expect(twitter.sendTweet(tweetAction)).to.eventually.deep.equal({
        status: 'ETIMEDOUT',
        body: 'Error: ETIMEDOUT',
        retry: true,
        retryRemaining: 100
      })
    })

    it('should retry when we get a retry statusCode', async () => {
      simple.mock(process.env, '')
      nock(url)
        .post(path, { text: 'some text', media: { media_ids: ['some media'] } })
        .reply(408, 'Request Timeout')

      return expect(twitter.sendTweet(tweetAction))
        .to.eventually.deep.include({
          status: 408,
          retry: true,
          retryRemaining: 100
        })
        .and.to.satisfy(({ body }) => {
          return (
            body instanceof HTTPError &&
            body.message === 'Response code 408 (Request Timeout)'
          )
        })
    })
  })

  describe('deleteTweet', () => {
    beforeEach(() => {
      simple.mock(logger, 'debug')
      simple.mock(logger, 'info')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'error')
      simple.mock(crypt, 'decrypt').returnWith()
      simple.mock(db, 'upsertRateLimit').resolveWith()
    })

    afterEach(() => {
      simple.restore()
      nock.cleanAll()
    })

    it('should call twitter.delete /tweets/:id', () => {
      const deleteCalled = nock(url)
        .delete('/tweets/123')
        .reply(200, tweetResponseBody)

      return twitter
        .deleteTweet({ tweetId: '123', token: 'token', secret: 'secret' })
        .then(() => {
          assert(deleteCalled.isDone())
        })
    })

    it('should delay action on rate limit error', () => {
      nock(url)
        .delete('/tweets/123')
        .reply(
          429,
          { status: 88, detail: 'Rate limit exceeded' },
          {
            'x-rate-limit-reset': time.valueOf() / 1000 + 500,
            'x-rate-limit-limit': 1000,
            'x-rate-limit-remaining': 0
          }
        )

      const action = {
        tweetId: '123'
      }
      const delay = 502000

      return twitter
        .deleteTweet({
          tweetId: '123'
        })
        .then(result => {
          assert.deepEqual(result, { action, delay })
        })
    })

    it('should reject when check rate limit fails on database upsert', () => {
      nock(url)
        .delete('/tweets/123')
        .reply(
          429,
          { status: 88, detail: 'Rate limit exceeded' },
          {
            'x-rate-limit-reset': time.valueOf() / 1000 + 500,
            'x-rate-limit-limit': 1000,
            'x-rate-limit-remaining': 0
          }
        )

      const err = new Error('oops')
      simple.mock(db, 'upsertRateLimit').rejectWith(err)

      return expect(
        twitter.deleteTweet({
          tweetId: '123'
        })
      ).to.be.rejectedWith(/oops/)
    })

    it('should delay action on daily update limit error', () => {
      nock(url).delete('/tweets/123').reply(403, {
        status: 185,
        detail: 'User is over daily status update limit'
      })

      return twitter
        .deleteTweet({
          tweetId: '123',
          token: 'token',
          secret: 'secret',
          userId: 'user-id'
        })
        .then(result => {
          assert.deepEqual(result, {
            action: {
              tweetId: '123',
              token: 'token',
              secret: 'secret',
              userId: 'user-id'
            },
            delay: ONE_HOUR_DELAY
          })
        })
    })

    it('should reject when it fails to delete the tweet', () => {
      nock(url).delete('/tweets/123').replyWithError('oops')

      return expect(twitter.deleteTweet({ tweetId: '123' })).to.be.rejectedWith(
        /oops/
      )
    })

    it('should reject when it gets an unauthorized response', () => {
      nock(url).delete('/tweets/123').reply(401, {
        status: 89,
        detail: 'Invalid or expired token.'
      })

      return expect(twitter.deleteTweet({ tweetId: '123' })).to.be.rejectedWith(
        /Invalid or expired token./
      )
    })

    it('should retry when we get a timeout error', () => {
      nock(url).delete('/tweets/123').replyWithError({
        code: 'ETIMEDOUT',
        message: 'Error: ETIMEDOUT'
      })

      return expect(
        twitter.deleteTweet({ tweetId: '123' })
      ).to.eventually.deep.equal({
        status: 'ETIMEDOUT',
        body: 'Error: ETIMEDOUT',
        retry: true,
        retryRemaining: 100
      })
    })
  })

  describe('sendReply', () => {
    const replyPostBody = {
      text: 'some text',
      media: { media_ids: ['some media'] },
      reply: {
        in_reply_to_tweet_id: '1',
        exclude_reply_user_ids: ['user-id']
      }
    }
    beforeEach(() => {
      simple.mock(media, 'getTwitterMediaIds', ({ gcsMediaIds }) =>
        Promise.resolve(gcsMediaIds)
      )
      simple.mock(db, 'storeTweet').resolveWith()
      simple.mock(db, 'upsertRateLimit').resolveWith()
      simple.mock(db, 'getTweetDuplicates').resolveWith([[]])
      simple.mock(logger, 'debug')
      simple.mock(logger, 'info')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'error')
    })

    afterEach(() => {
      simple.restore()
      nock.cleanAll()
    })

    it('should call twitter.post', () => {
      const post = nock(url)
        .post(path, replyPostBody)
        .reply(200, tweetResponseBody)

      return twitter.sendReply(tweetAction).then(() => {
        assert(post.isDone())
      })
    })

    it('should delay action on rate limit error', async () => {
      nock(url)
        .post(path, replyPostBody)
        .reply(
          429,
          { status: 88, detail: 'Rate limit exceeded' },
          {
            'x-rate-limit-reset': time.valueOf() / 1000 + 500,
            'x-rate-limit-limit': 1000,
            'x-rate-limit-remaining': 0
          }
        )

      await expect(twitter.sendReply(tweetAction)).to.eventually.deep.equal({
        action: tweetAction,
        delay: 502000
      })
    })

    it('should reject when check rate limit fails', () => {
      nock(url)
        .post(path, replyPostBody)
        .reply(
          429,
          { status: 88, detail: 'Rate limit exceeded' },
          {
            'x-rate-limit-reset': time.valueOf() / 1000 + 500,
            'x-rate-limit-limit': 1000,
            'x-rate-limit-remaining': 0
          }
        )

      twitter.setRateLimit = simple.mock(() =>
        Promise.reject(new Error('oops'))
      )

      return twitter.sendReply(tweetAction).catch(error => {
        assert.equal(error.message, 'oops')
      })
    })

    it('should delay action on daily update limit error', () => {
      nock(url).post(path, replyPostBody).reply(403, {
        status: 185,
        detail: 'User is over daily status update limit'
      })

      return twitter.sendReply(tweetAction).then(result => {
        assert.deepEqual(result, { action: tweetAction, delay: ONE_HOUR_DELAY })
      })
    })

    it('should reject when it fails to send the reply', () => {
      nock(url).post(path, replyPostBody).replyWithError('oops')

      return expect(
        twitter.sendReply(tweetAction)
      ).to.eventually.be.rejectedWith(/oops/)
    })

    it('should call the db to store tweet', () => {
      const postCalled = nock(url)
        .post(path, replyPostBody)
        .reply(200, tweetResponseBody)

      return twitter.sendReply(tweetAction).then(() => {
        assert(postCalled.isDone())

        expect(db.storeTweet.lastCall.args).to.deep.equal([
          {
            createdAt: 1602547200000,
            senderHandle: 'MaleniaBladeOfMiquella',
            senderId: 'user-id',
            mentionedUserId: '666',
            mentionedHandle: 'MohgTheBloodGod',
            tweetContentHash:
              '6ca86fae70c37c12ee729610842c18b66bdb3697f5fc28124e648bdfb181f0f8',
            tweetId: 'tweet-id',
            widgetId: 'widget-id',
            tweet: {
              id: 'tweet-id',
              text: 'some text'
            },
            responseHash: null
          }
        ])
      })
    })

    it('should handle db error when storing tweet', () => {
      const postCalled = nock(url)
        .post(path, replyPostBody)
        .reply(200, tweetResponseBody)

      const err = new Error('widget not found')
      simple.mock(db, 'storeTweet').rejectWith(err)

      return twitter.sendReply(tweetAction).then(() => {
        assert(postCalled.isDone())

        expect(logger.warn.lastCall.args).to.deep.equal([
          {
            err,
            tweet: { ...tweetResponseBody.data },
            action: omit(['token', 'secret'], tweetAction),
            isReply: true,
            nullcast: undefined
          },
          `Error storing Tweet: ${err.message}`
        ])
      })
    })

    it('should retry when we get a timeout error', () => {
      nock(url).post(path, replyPostBody).replyWithError({
        code: 'ETIMEDOUT',
        message: 'Error: ETIMEDOUT'
      })

      return expect(twitter.sendReply(tweetAction)).to.eventually.deep.equal({
        status: 'ETIMEDOUT',
        body: 'Error: ETIMEDOUT',
        retry: true,
        retryRemaining: 100
      })
    })
  })

  describe('sendDarkTweet', () => {
    const darkTweetBody = {
      text: 'some text',
      media: { media_ids: ['some media'] },
      nullcast: true
    }
    beforeEach(() => {
      simple.mock(media, 'getTwitterMediaIds', ({ gcsMediaIds }) =>
        Promise.resolve(gcsMediaIds)
      )
      simple.mock(db, 'storeTweet').resolveWith()
      simple.mock(db, 'getTweetDuplicates').resolveWith([[]])
      simple.mock(logger, 'debug')
      simple.mock(logger, 'info')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'error')
    })

    afterEach(() => {
      simple.restore()
      nock.cleanAll()
    })

    it('should call twitter.post', () => {
      const post = nock(url)
        .post(path, darkTweetBody)
        .reply(200, tweetResponseBody)

      return twitter.sendDarkTweet(tweetAction).then(() => {
        assert(post.isDone())
      })
    })

    it('should delay action on rate limit error', () => {
      nock(url)
        .post(path, darkTweetBody)
        .reply(
          429,
          { status: 88, detail: 'Rate limit exceeded' },
          {
            'x-rate-limit-reset': time.valueOf() / 1000 + 500,
            'x-rate-limit-limit': 1000,
            'x-rate-limit-remaining': 0
          }
        )

      return expect(
        twitter.sendDarkTweet(tweetAction)
      ).to.eventually.deep.equal({ action: tweetAction, delay: 502000 })
    })

    it('should reject when check rate limit fails', () => {
      nock(url)
        .post(path, darkTweetBody)
        .reply(
          429,
          { status: 88, detail: 'Rate limit exceeded' },
          {
            'x-rate-limit-reset': time.valueOf() / 1000 + 500,
            'x-rate-limit-limit': 1000,
            'x-rate-limit-remaining': 0
          }
        )

      return twitter.sendDarkTweet(tweetAction).catch(error => {
        assert.equal(error.message, 'oops')
      })
    })

    it('should delay action on daily update limit error', () => {
      nock(url).post(path, darkTweetBody).reply(403, {
        status: 185,
        detail: 'User is over daily status update limit'
      })

      return twitter.sendDarkTweet(tweetAction).then(result => {
        assert.deepEqual(result, { action: tweetAction, delay: ONE_HOUR_DELAY })
      })
    })

    describe("Twitter's 420 enhance your calm error", () => {
      beforeEach(() => {
        simple.mock(db, 'upsertRateLimit').resolveWith()
      })

      it('should delay Tweets for default time', () => {
        nock(url).post(path, darkTweetBody).reply(420)

        const delay = Number(process.env.ACTION_RATE_LIMIT_DELAY) || 2
        const TEN_MINUTES_AND_DELAY = 10 * 60 * 1000 + delay * 1000

        return twitter.sendDarkTweet(tweetAction).then(result => {
          expect(db.upsertRateLimit.called).to.equal(true)
          expect(result).to.deep.contain({
            action: tweetAction,
            delay: TEN_MINUTES_AND_DELAY
          })
        })
      })

      it('should delay Tweets for configured time', () => {
        simple.mock(
          process.env,
          'TWITTER_420_TWEET_BACKOFF_DELAY',
          ONE_HOUR_DELAY
        )
        nock(url).post(path, darkTweetBody).reply(420)

        const delay = Number(process.env.ACTION_RATE_LIMIT_DELAY) || 2
        const ONE_HOUR_AND_DELAY = ONE_HOUR_DELAY + delay * 1000

        return twitter.sendDarkTweet(tweetAction).then(result => {
          expect(db.upsertRateLimit.called).to.equal(true)
          expect(result).to.deep.contain({
            action: tweetAction,
            delay: ONE_HOUR_AND_DELAY
          })
        })
      })
    })

    it('should reject when it fails to send the dark tweet', () => {
      nock(url).post(path, darkTweetBody).replyWithError('oops')

      return expect(
        twitter.sendDarkTweet(tweetAction)
      ).to.eventually.be.rejectedWith(/oops/)
    })

    it('should call the db to store tweet', () => {
      const postCalled = nock(url)
        .post(path, darkTweetBody)
        .reply(200, tweetResponseBody)

      return twitter.sendDarkTweet(tweetAction).then(() => {
        assert(postCalled.isDone())

        expect(db.storeTweet.lastCall.args).to.deep.equal([
          {
            createdAt: 1602547200000,
            senderHandle: 'MaleniaBladeOfMiquella',
            senderId: 'user-id',
            mentionedUserId: '666',
            mentionedHandle: 'MohgTheBloodGod',
            tweetContentHash:
              '6ca86fae70c37c12ee729610842c18b66bdb3697f5fc28124e648bdfb181f0f8',
            tweetId: 'tweet-id',
            widgetId: 'widget-id',
            tweet: {
              id: 'tweet-id',
              text: 'some text'
            },
            responseHash: null
          }
        ])
      })
    })

    it('should call the db to store random response tweet', () => {
      simple.mock(db, 'updatePoolRecipients').resolveWith([])
      const postCalled = nock(url)
        .post(path, darkTweetBody)
        .reply(200, tweetResponseBody)

      return twitter.sendDarkTweet(randomResponseTweetAction).then(() => {
        assert(postCalled.isDone())

        expect(db.storeTweet.lastCall.args).to.deep.equal([
          {
            createdAt: 1602547200000,
            senderHandle: 'MaleniaBladeOfMiquella',
            senderId: 'user-id',
            mentionedUserId: '666',
            mentionedHandle: 'MohgTheBloodGod',
            tweetContentHash:
              '6ca86fae70c37c12ee729610842c18b66bdb3697f5fc28124e648bdfb181f0f8',
            tweetId: 'tweet-id',
            widgetId: 'widget-id',
            tweet: {
              id: 'tweet-id',
              text: 'some text'
            },
            responseHash:
              '1705c6e4ae4eb2464e591eac0b6c0ec7981f05032bb1c279d640fa705d229bd4'
          }
        ])
      })
    })

    it('should call the db to store consent tweet and participant', () => {
      const options = {
        userId: '666',
        widgetId: 'widget-id',
        handle: 'MohgTheBloodGod',
        responseType: 'SEND_DARK_TWEET',
        optinId: 'tweet-id',
        consentResponseTweetId: 'tweet-id',
        status: 'pending_explicit_consent'
      }

      const {
        widgetId,
        userId,
        handle,
        responseType,
        optinId,
        consentResponseTweetId,
        status
      } = options

      simple.mock(db, 'addParticipant').resolveWith({
        participant: {
          widgetId,
          userId,
          handle,
          responseType,
          optinId,
          consentResponseTweetId,
          status
        },
        duplicate: false
      })
      const postCalled = nock(url)
        .post(path, darkTweetBody)
        .reply(200, tweetResponseBody)

      return twitter.sendDarkTweet(isMosaicConsentTweetAction).then(() => {
        assert(postCalled.isDone())

        expect(db.storeTweet.lastCall.args).to.deep.equal([
          {
            createdAt: 1602547200000,
            senderHandle: 'MaleniaBladeOfMiquella',
            senderId: 'user-id',
            mentionedUserId: '666',
            mentionedHandle: 'MohgTheBloodGod',
            tweetContentHash:
              '6ca86fae70c37c12ee729610842c18b66bdb3697f5fc28124e648bdfb181f0f8',
            tweetId: 'tweet-id',
            widgetId: 'widget-id',
            tweet: {
              id: 'tweet-id',
              text: 'some text'
            },
            responseHash: null
          }
        ])

        expect(db.addParticipant.lastCall.args).to.deep.equal([
          {
            widgetId,
            userId,
            handle,
            responseType,
            optinId,
            consentResponseTweetId,
            status
          }
        ])
      })
    })

    it('should handle db error when storing tweet', () => {
      const postCalled = nock(url)
        .post(path, darkTweetBody)
        .reply(200, tweetResponseBody)

      const err = new Error('widget not found')
      simple.mock(db, 'storeTweet').rejectWith(err)

      return twitter.sendDarkTweet(tweetAction).then(() => {
        assert(postCalled.isDone())

        expect(logger.warn.lastCall.args).to.deep.equal([
          {
            err,
            tweet: tweetResponseBody.data,
            action: omit(['token', 'secret'], tweetAction),
            isReply: false,
            nullcast: true
          },
          `Error storing Tweet: ${err.message}`
        ])
      })
    })

    it('should retry when we get a timeout error', () => {
      nock(url).post(path, darkTweetBody).replyWithError({
        code: 'ETIMEDOUT',
        message: 'Error: ETIMEDOUT'
      })

      return expect(
        twitter.sendDarkTweet(tweetAction)
      ).to.eventually.deep.equal({
        status: 'ETIMEDOUT',
        body: 'Error: ETIMEDOUT',
        retry: true,
        retryRemaining: 100
      })
    })
  })

  describe('sendDarkReply', () => {
    const darkReplyPostBody = {
      text: 'some text',
      media: { media_ids: ['some media'] },
      reply: {
        in_reply_to_tweet_id: '1',
        exclude_reply_user_ids: ['user-id']
      },
      nullcast: true
    }

    beforeEach(() => {
      simple.mock(media, 'getTwitterMediaIds', ({ gcsMediaIds }) =>
        Promise.resolve(gcsMediaIds)
      )
      simple.mock(db, 'storeTweet').resolveWith()
      simple.mock(db, 'getTweetDuplicates').resolveWith([[]])
      simple.mock(logger, 'debug')
      simple.mock(logger, 'info')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'error')
    })

    afterEach(() => {
      simple.restore()
      nock.cleanAll()
    })

    it('should call twitter.post', () => {
      const post = nock(url)
        .post(path, darkReplyPostBody)
        .reply(200, tweetResponseBody)

      return twitter.sendDarkReply(tweetAction).then(() => {
        assert(post.isDone())
      })
    })

    it('should delay action on rate limit error', () => {
      nock(url)
        .post(path, darkReplyPostBody)
        .reply(
          429,
          { status: 88, detail: 'Rate limit exceeded' },
          {
            'x-rate-limit-reset': time.valueOf() / 1000 + 500,
            'x-rate-limit-limit': 1000,
            'x-rate-limit-remaining': 0
          }
        )

      return expect(
        twitter.sendDarkReply(tweetAction)
      ).to.eventually.deep.equal({ action: tweetAction, delay: 502000 })
    })

    it('should reject when check rate limit fails', () => {
      nock(url)
        .post(path, darkReplyPostBody)
        .reply(
          429,
          { status: 88, detail: 'Rate limit exceeded' },
          {
            'x-rate-limit-reset': time.valueOf() / 1000 + 500,
            'x-rate-limit-limit': 1000,
            'x-rate-limit-remaining': 0
          }
        )

      return twitter.sendDarkReply(tweetAction).catch(error => {
        assert.equal(error.message, 'oops')
      })
    })

    it('should delay action on daily update limit error', () => {
      nock(url).post(path, darkReplyPostBody).reply(403, {
        status: 185,
        detail: 'User is over daily status update limit'
      })

      return twitter.sendDarkReply(tweetAction).then(result => {
        assert.deepEqual(result, { action: tweetAction, delay: ONE_HOUR_DELAY })
      })
    })

    it('should reject when it fails to send the reply', () => {
      nock(url).post(path, darkReplyPostBody).replyWithError('oops')

      return expect(
        twitter.sendDarkReply(tweetAction)
      ).to.eventually.be.rejectedWith(/oops/)
    })

    it('should call the db to store tweet', () => {
      const postCalled = nock(url)
        .post(path, darkReplyPostBody)
        .reply(200, tweetResponseBody)

      return twitter.sendDarkReply(tweetAction).then(() => {
        assert(postCalled.isDone())

        expect(db.storeTweet.lastCall.args).to.deep.equal([
          {
            createdAt: 1602547200000,
            senderHandle: 'MaleniaBladeOfMiquella',
            senderId: 'user-id',
            mentionedUserId: '666',
            mentionedHandle: 'MohgTheBloodGod',
            tweetContentHash:
              '6ca86fae70c37c12ee729610842c18b66bdb3697f5fc28124e648bdfb181f0f8',
            tweetId: 'tweet-id',
            widgetId: 'widget-id',
            tweet: {
              id: 'tweet-id',
              text: 'some text'
            },
            responseHash: null
          }
        ])
      })
    })

    it('should handle db error when storing tweet', () => {
      const postCalled = nock(url)
        .post(path, darkReplyPostBody)
        .reply(200, tweetResponseBody)

      const err = new Error('widget not found')
      simple.mock(db, 'storeTweet').rejectWith(err)

      return twitter.sendDarkReply(tweetAction).then(() => {
        assert(postCalled.isDone())

        expect(logger.warn.lastCall.args).to.deep.equal([
          {
            err,
            tweet: tweetResponseBody.data,
            action: omit(['token', 'secret'], tweetAction),
            isReply: true,
            nullcast: true
          },
          `Error storing Tweet: ${err.message}`
        ])
      })
    })

    it('should retry when we get a timeout error', () => {
      nock(url).post(path, darkReplyPostBody).replyWithError({
        code: 'ETIMEDOUT',
        message: 'Error: ETIMEDOUT'
      })

      return expect(
        twitter.sendDarkReply(tweetAction)
      ).to.eventually.deep.equal({
        status: 'ETIMEDOUT',
        body: 'Error: ETIMEDOUT',
        retry: true,
        retryRemaining: 100
      })
    })
  })

  describe('Tweet Media', () => {
    beforeEach(() => {
      nock('https://api.twitter.com/2')
        .post('/tweets', {
          text: 'some text',
          media: {
            media_ids: ['some media']
          }
        })
        .reply(200, tweetResponseBody)

      simple.mock(db, 'getTweetDuplicates').resolveWith([[]])
      simple.mock(logger, 'debug')
      simple.mock(logger, 'info')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'error')
    })

    afterEach(() => {
      simple.restore()
      nock.cleanAll()
    })

    const tweetAction = {
      token: 'client token',
      secret: 'client secret',
      text: 'some text',
      media: ['some media'],
      userId: 'some user id'
    }

    it('should handle tweet with no media', () => {
      const getTwitterMediaIdsMock = simple.mock(
        media,
        'getTwitterMediaIds',
        ({ gcsMediaIds }) => Promise.resolve(gcsMediaIds)
      )

      nock('https://api.twitter.com/2')
        .post('/tweets', body => {
          expect(body).to.deep.equal({
            text: 'some text'
          })
          return true
        })
        .reply(200, tweetResponseBody)

      return twitter
        .sendTweet({
          token: tweetAction.token,
          secret: tweetAction.secret,
          text: tweetAction.text,
          userId: tweetAction.userId
        })
        .then(() => {
          expect(getTwitterMediaIdsMock.lastCall.args).to.deep.equal([])
        })
    })

    it('should handle tweet with attachment url', () => {
      const tweetNock = nock('https://api.twitter.com/2')
        .post('/tweets', body => {
          expect(body).to.deep.equal({
            text: 'some text',
            quote_tweet_id: '1637492381065854976'
          })
          return true
        })
        .reply(200, tweetResponseBody)

      return twitter
        .sendTweet({
          token: tweetAction.token,
          secret: tweetAction.secret,
          text: tweetAction.text,
          userId: tweetAction.userId,
          attachmentUrl:
            'https://twitter.com/BRobotStaging/status/1637492381065854976'
        })
        .then(() => {
          expect(tweetNock.isDone()).to.equal(true)
        })
    })

    it('should handle tweet with null attachment url', () => {
      const tweetNock = nock('https://api.twitter.com/2')
        .post('/tweets', body => {
          expect(body).to.deep.equal({
            text: 'some text'
          })
          return true
        })
        .reply(200, tweetResponseBody)

      return twitter
        .sendTweet({
          token: tweetAction.token,
          secret: tweetAction.secret,
          text: tweetAction.text,
          userId: tweetAction.userId,
          attachmentUrl: null
        })
        .then(() => {
          expect(tweetNock.isDone()).to.equal(true)
        })
    })

    it('should handle tweet with card uri', () => {
      const tweetNock = nock('https://api.twitter.com/2')
        .post('/tweets', body => {
          expect(body).to.deep.equal({
            text: 'some text',
            card_uri: '853503245793641682'
          })
          return true
        })
        .reply(200, tweetResponseBody)

      return twitter
        .sendTweet({
          token: tweetAction.token,
          secret: tweetAction.secret,
          text: tweetAction.text,
          userId: tweetAction.userId,
          cardUri: 'card://853503245793641682'
        })
        .then(() => {
          expect(tweetNock.isDone()).to.equal(true)
        })
    })

    it('should handle tweet with null card uri', () => {
      const tweetNock = nock('https://api.twitter.com/2')
        .post('/tweets', body => {
          expect(body).to.deep.equal({
            text: 'some text'
          })
          return true
        })
        .reply(200, tweetResponseBody)

      return twitter
        .sendTweet({
          token: tweetAction.token,
          secret: tweetAction.secret,
          text: tweetAction.text,
          userId: tweetAction.userId,
          cardUri: null
        })
        .then(() => {
          expect(tweetNock.isDone()).to.equal(true)
        })
    })

    it('should include twitter media ids with tweet', () => {
      const getTwitterMediaIdsMock = simple.mock(
        media,
        'getTwitterMediaIds',
        ({ gcsMediaIds }) => Promise.resolve(gcsMediaIds)
      )

      return twitter.sendTweet(tweetAction).then(() => {
        expect(getTwitterMediaIdsMock.lastCall.args).to.deep.equal([
          {
            gcsMediaIds: tweetAction.media,
            userId: tweetAction.userId,
            destination: 'tweet'
          }
        ])
      })
    })

    it('should delay action on rate limit error', () => {
      const response = {
        statusCode: 429,
        headers: {
          'x-rate-limit-reset': time / 1000 + 60
        }
      }
      const error = {
        response
      }
      simple.mock(media, 'getTwitterMediaIds', () => Promise.reject(error))

      return expect(twitter.sendTweet(tweetAction)).to.eventually.deep.equal({
        action: tweetAction,
        delay: 62000
      })
    })

    it('should reject when check rate limit fails', () => {
      const response = {
        statusCode: 429,
        headers: {
          'x-rate-limit-reset': time / 1000 + 60
        }
      }
      const error = { response }
      simple.mock(media, 'getTwitterMediaIds', () => Promise.reject(error))
      simple.mock(db, 'upsertRateLimit').rejectWith(new Error('oops'))

      return expect(
        twitter.sendTweet(tweetAction)
      ).to.eventually.be.rejectedWith(/oops/)
    })

    it('should delay action on daily update limit error', () => {
      const errors = [
        { code: 185, message: 'User is over daily status update limit' }
      ]
      const response = {
        statusCode: 403,
        body: {
          errors
        }
      }
      const error = { message: 'Oops!', response }
      simple.mock(media, 'getTwitterMediaIds', () => Promise.reject(error))

      return twitter.sendTweet(tweetAction).then(result => {
        expect(result).to.deep.equal({
          action: tweetAction,
          delay: ONE_HOUR_DELAY
        })
      })
    })

    it('should reject on generic error', () => {
      const errorMessage = 'insert funny error message here'
      const error = new Error(errorMessage)
      simple.mock(media, 'getTwitterMediaIds', () => Promise.reject(error))

      return twitter.sendTweet(tweetAction).catch(error => {
        expect(error.message).to.equal('Error obtaining media: ' + errorMessage)
      })
    })

    it('should retry on connection error', () => {
      const err = new Error('media connect error')
      simple.mock(media, 'getTwitterMediaIds').rejectWith(err)
      simple.mock(utils, 'isConnectionError').returnWith(true)

      const postCalled = nock('https://api.twitter.com/1.1')
        .post('/statuses/update.json', {
          status: 'some text',
          media_ids: 'some media'
        })
        .reply(200)

      return twitter.sendTweet(tweetAction).then(result => {
        expect(postCalled.isDone()).to.equal(false)
        expect(logger.warn.lastCall.args).to.deep.equal([
          {
            err,
            action: utils.sanitizeAction(tweetAction, ['token', 'secret'])
          },
          `Error connecting to media service: ${err.message}`
        ])
        expect(result).to.deep.equal({
          retry: true,
          retryRemaining: 1000,
          error: err.message
        })
      })
    })

    it('should retry on media uploading error', () => {
      const err = new Error('423 - "Media id \'media-id\' is uploading"')
      simple.mock(media, 'getTwitterMediaIds').rejectWith(err)
      simple.mock(utils, 'isConnectionError').returnWith(false)
      simple.mock(utils, 'isMediaUploadingError').returnWith(true)

      const postCalled = nock('https://api.twitter.com/1.1')
        .post('/statuses/update.json', {
          status: 'some text',
          media_ids: 'some media'
        })
        .reply(200)

      return twitter.sendTweet(tweetAction).then(result => {
        expect(postCalled.isDone()).to.equal(false)
        expect(logger.debug.lastCall.args).to.deep.equal([
          {
            err,
            action: utils.sanitizeAction(tweetAction, ['token', 'secret'])
          },
          `Error obtaining media: ${err.message}`
        ])
        expect(result).to.deep.equal({
          retry: true,
          retryRemaining: 1000,
          error: err.message
        })
      })
    })
  })

  describe('sendDm', () => {
    afterEach(() => {
      simple.restore()
      nock.cleanAll()
    })

    it('should call twitter.post', () => {
      simple.mock(media, 'getTwitterMediaId', ({ gcsMediaId }) =>
        Promise.resolve(gcsMediaId)
      )

      const post = nock('https://api.twitter.com/2')
        .post('/dm_conversations/with/3805104374/messages', {
          text: 'some text',
          attachments: [{ media_id: 'some media' }]
        })
        .reply(200, {})

      const dm = {
        token: 'client token',
        secret: 'client secret',
        text: 'some text',
        media: 'some media',
        recipientId: '3805104374',
        userId: '987654321'
      }

      return twitter.sendDm(dm).then(() => {
        assert(post.isDone())
      })
    })

    it('should throw when authentication fails', () => {
      nock('https://api.twitter.com/2')
        .post('/dm_conversations/with/3805104374/messages', {
          text: 'some text'
        })
        .reply(401, {
          status: 32,
          detail: 'Could not authenticate you.'
        })

      const action = {
        token: 'client token',
        secret: 'client secret',
        text: 'some text',
        recipientId: '3805104374'
      }

      return expect(twitter.sendDm(action)).to.eventually.be.rejectedWith(
        /Could not authenticate you./
      )
    })

    it('should delay action on rate limit error', () => {
      nock('https://api.twitter.com/2')
        .post('/dm_conversations/with/3805104374/messages', {
          text: 'some text'
        })
        .reply(
          429,
          { status: 88, detail: 'Rate limit exceeded' },
          {
            'x-rate-limit-reset': time.valueOf() / 1000 + 500,
            'x-rate-limit-limit': 1000,
            'x-rate-limit-remaining': 0
          }
        )

      const action = {
        token: 'client token',
        secret: 'client secret',
        text: 'some text',
        recipientId: '3805104374'
      }

      return expect(twitter.sendDm(action)).to.eventually.deep.equal({
        action,
        delay: 502000
      })
    })

    it('should delay action on daily update limit error', () => {
      nock('https://api.twitter.com/2')
        .post('/dm_conversations/with/3805104374/messages', {
          text: 'some text'
        })
        .reply(403, {
          status: 185,
          detail: 'User is over daily status update limit'
        })

      const action = {
        token: 'client token',
        secret: 'client secret',
        text: 'some text',
        recipientId: '3805104374'
      }

      return twitter.sendDm(action).then(result => {
        assert.deepEqual(result, { action, delay: ONE_HOUR_DELAY })
      })
    })

    it('should reject on a Twitter call error', () => {
      nock('https://api.twitter.com/2')
        .post('/dm_conversations/with/3805104374/messages', {
          text: 'some text'
        })
        .replyWithError('oops')

      const dm = {
        token: 'client token',
        secret: 'client secret',
        text: 'some text',
        recipientId: '3805104374'
      }

      return expect(twitter.sendDm(dm)).to.eventually.be.rejectedWith(/oops/)
    })

    it('should retry when we get a timeout error', () => {
      nock('https://api.twitter.com/2')
        .post('/dm_conversations/with/1234/messages')
        .replyWithError({
          code: 'ETIMEDOUT',
          message: 'Error: ETIMEDOUT'
        })

      return expect(
        twitter.sendDm({
          token: 'client token',
          secret: 'client secret',
          text: 'some text',
          recipientId: '1234'
        })
      ).to.eventually.deep.equal({
        status: 'ETIMEDOUT',
        body: 'Error: ETIMEDOUT',
        retry: true,
        retryRemaining: 100
      })
    })
  })

  describe('DM Media', () => {
    beforeEach(() => {
      simple.mock(logger, 'debug')
      simple.mock(logger, 'info')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'error')
    })

    afterEach(() => {
      simple.restore()
      nock.cleanAll()
    })

    const userId = '987654321'
    const mediaId = 'some media'
    const destination = 'dm'

    const action = {
      token: 'client token',
      secret: 'client secret',
      text: 'some text',
      recipientId: '3805104374',
      media: mediaId
    }

    it('should handle dm with no media', () => {
      const getTwitterMediaIdMock = simple.mock(
        media,
        'getTwitterMediaId',
        ({ gcsMediaId }) => Promise.resolve(gcsMediaId)
      )
      const post = nock('https://api.twitter.com/2')
        .post('/dm_conversations/with/3805104374/messages', body => {
          expect(body.attachments).to.equal(undefined)
          return true
        })
        .reply(200, {})

      const dm = {
        token: 'client token',
        secret: 'client secret',
        text: 'some text',
        recipientId: '3805104374'
      }

      return twitter.sendDm(dm).then(() => {
        assert(post.isDone())
        expect(getTwitterMediaIdMock.called).to.equal(false)
      })
    })

    it('should include twitter media id with dm', () => {
      const getTwitterMediaIdMock = simple.mock(
        media,
        'getTwitterMediaId',
        ({ gcsMediaId }) => Promise.resolve(gcsMediaId)
      )

      const post = nock('https://api.twitter.com/2')
        .post('/dm_conversations/with/3805104374/messages', body => {
          expect(body.attachments).to.deep.equal([
            {
              media_id: 'some media'
            }
          ])
          return true
        })
        .reply(200, {})

      const dm = {
        token: 'client token',
        secret: 'client secret',
        text: 'some text',
        media: mediaId,
        recipientId: '3805104374',
        userId
      }

      return twitter.sendDm(dm).then(() => {
        assert(post.isDone())
        expect(getTwitterMediaIdMock.lastCall.args).deep.equal([
          {
            destination,
            gcsMediaId: mediaId,
            userId
          }
        ])
      })
    })

    // the below is from some old means of creating widgets
    it('should include twitter media id (old format) with dm', () => {
      const getTwitterMediaIdMock = simple.mock(
        media,
        'getTwitterMediaId',
        ({ gcsMediaId }) => Promise.resolve(gcsMediaId)
      )

      const post = nock('https://api.twitter.com/2')
        .post('/dm_conversations/with/3805104374/messages', body => {
          expect(body.attachments).to.deep.equal([{ media_id: 'some media' }])
          return true
        })
        .reply(200, {})

      const dm = {
        token: 'client token',
        secret: 'client secret',
        text: 'some text',
        media: { id: mediaId },
        recipientId: '3805104374',
        userId
      }

      return twitter.sendDm(dm).then(() => {
        assert(post.isDone())
        expect(getTwitterMediaIdMock.lastCall.args).deep.equal([
          {
            destination,
            gcsMediaId: mediaId,
            userId
          }
        ])
      })
    })

    it('should delay action on rate limit error', () => {
      const response = {
        statusCode: 429,
        headers: {
          'x-rate-limit-reset': time.valueOf() / 1000 + 500,
          'x-rate-limit-limit': 1000,
          'x-rate-limit-remaining': 0
        }
      }
      const error = { response }
      simple.mock(media, 'getTwitterMediaId', () => Promise.reject(error))

      return expect(twitter.sendDm(action)).to.eventually.deep.equal({
        action,
        delay: 502000
      })
    })

    it('should reject when check rate limit fails', () => {
      const response = {
        statusCode: 429,
        headers: {
          'x-rate-limit-reset': time.valueOf() / 1000 + 500,
          'x-rate-limit-limit': 1000,
          'x-rate-limit-remaining': 0
        }
      }
      const error = { response }
      simple.mock(media, 'getTwitterMediaId', () => Promise.reject(error))

      const err = new Error('oops')
      simple.mock(db, 'upsertRateLimit', () => Promise.reject(err))

      return twitter.sendDm(action).catch(error => {
        assert.equal(error, err)
      })
    })

    it('should delay action on daily update limit error', () => {
      const response = {
        statusCode: 403,
        body: {
          errors: [
            {
              code: 185,
              message: 'User is over daily status update limit'
            }
          ]
        }
      }
      const error = { response }
      simple.mock(media, 'getTwitterMediaId', () => Promise.reject(error))

      return twitter.sendDm(action).then(result => {
        assert.deepEqual(result, { action, delay: ONE_HOUR_DELAY })
      })
    })

    it('should reject on generic error', () => {
      const errorMessage = 'insert funny error message here'
      const error = new Error(errorMessage)
      simple.mock(media, 'getTwitterMediaId', () => Promise.reject(error))

      return twitter.sendDm(action).catch(error => {
        expect(error.message).to.equal('Error obtaining media: ' + errorMessage)
      })
    })

    it('should retry on connection error', () => {
      const err = new Error('media connect error')
      simple.mock(media, 'getTwitterMediaId').rejectWith(err)
      simple.mock(utils, 'isConnectionError').returnWith(true)

      const postCalled = nock('https://api.twitter.com/1.1')
        .post('/direct_messages/events/new.json')
        .reply(200)

      return twitter.sendDm(action).then(result => {
        expect(postCalled.isDone()).to.equal(false)
        expect(logger.warn.lastCall.args).to.deep.equal([
          {
            err,
            action: utils.sanitizeAction(action, ['token', 'secret'])
          },
          `Error connecting to media service: ${err.message}`
        ])
        expect(result).to.deep.equal({
          retry: true,
          retryRemaining: 1000,
          error: err.message
        })
      })
    })

    it('should retry on media uploading error', () => {
      const err = new Error('423 - "Media id \'media-id\' is uploading"')
      simple.mock(media, 'getTwitterMediaId').rejectWith(err)
      simple.mock(utils, 'isConnectionError').returnWith(false)
      simple.mock(utils, 'isMediaUploadingError').returnWith(true)

      const postCalled = nock('https://api.twitter.com/1.1')
        .post('/direct_messages/events/new.json')
        .reply(200)

      return twitter.sendDm(action).then(result => {
        expect(postCalled.isDone()).to.equal(false)
        expect(logger.debug.lastCall.args).to.deep.equal([
          {
            err,
            action: utils.sanitizeAction(action, ['token', 'secret'])
          },
          `Error obtaining media: ${err.message}`
        ])
        expect(result).to.deep.equal({
          retry: true,
          retryRemaining: 1000,
          error: err.message
        })
      })
    })
  })
})
