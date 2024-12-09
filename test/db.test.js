const { assert, expect } = require('chai')
const simple = require('simple-mock')

const db = require('../app/db')

/**
 * Replaces all spacing characters (tabs, newlines, and multiple spaces)
 * with a single space, and trims the string so that you can write strings
 * with variable spaces between the words but still be able to compare them see
 * the SQL queries for some sexy examples.
 *
 * @param {string} string Text to normalize
 * @returns {string} Normalized text
 */
const normalizeSpaces = string => string.replace(/\s\s+/g, ' ').trim()

describe('db', () => {
  const mysql = {}

  describe('upsertRateLimit', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should do a query to upsert the data into database', () => {
      simple.mock(mysql, 'query').resolveWith('rows')

      const userId = 'user_id'
      const limitResetAt = '12345'
      const platform = 'platform'
      const method = 'method'
      const endpoint = 'endpoint'

      return db
        .upsertRateLimit(
          { userId, platform, method, endpoint, limitResetAt },
          { mysql }
        )
        .then(result => {
          const sql =
            'INSERT INTO rate_limit (user_id, platform, method, endpoint, limit_reset_at ) VALUES (?, ?, ?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE ' +
            'user_id = VALUES(user_id), platform = VALUES(platform), ' +
            'method = VALUES(method), endpoint = VALUES(endpoint), ' +
            'limit_reset_at = VALUES(limit_reset_at);'

          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            [userId, platform, method, endpoint, limitResetAt]
          ])

          expect(result).to.equal('rows')
        })
    })

    it('should reject with the error', () => {
      const error = new Error('oops')
      simple.mock(mysql, 'query').rejectWith(error)

      return db.upsertRateLimit({}, { mysql }).catch(e => {
        assert.deepEqual(e, error)
      })
    })
  })

  describe('insert', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should do a query to insert the data into mysql', () => {
      simple.mock(mysql, 'query').resolveWith('rows')

      const dataset = 'dataset'
      const data = 'data'

      return db.insert({ dataset, data }, { mysql }).then(result => {
        const sql = `INSERT INTO ${dataset} (${data}) VALUES (?);`

        assert(mysql.query.called)
        expect(mysql.query.lastCall.args).to.deep.equal([
          {
            sql
          },
          [data]
        ])

        expect(result).to.equal('rows')
      })
    })

    it('should reject with the error', () => {
      const error = new Error('oops')
      simple.mock(mysql, 'query').rejectWith(error)

      return db.insert({}, { mysql }).catch(e => {
        assert.deepEqual(e, error)
      })
    })
  })

  describe('update', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should do a query to update the data in mysql', () => {
      simple.mock(mysql, 'query').resolveWith('rows')

      const dataset = 'dataset'
      const column = 'column'
      const value = 'value'
      const data = 'data'
      const searchColumn = 'searchColumn'
      const searchKey = 'searchKey'

      return db
        .update(
          {
            dataset,
            column,
            value,
            data,
            searchColumn,
            searchKey
          },
          { mysql }
        )
        .then(result => {
          const sql = `UPDATE \`${dataset}\` SET \`${column}\` = ? WHERE \`${searchColumn}\` = ${searchKey};`

          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            [value]
          ])

          expect(result).to.equal('rows')
        })
    })

    it('should reject with the error', () => {
      const error = new Error('oops')
      simple.mock(mysql, 'query').rejectWith(error)

      return db.update({}, { mysql }).catch(e => {
        assert.deepEqual(e, error)
      })
    })
  })

  describe('getUserRateLimit', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should run the getTwitterUserRateLimitReset Stored Procedure', () => {
      simple.mock(mysql, 'query').resolveWith([[[{ limitResetAt: '0' }]]])

      const userId = 'userId'
      const platform = 'twitter'
      const method = 'post'
      const endpoint = 'statuses/update'

      return db
        .getUserRateLimit(
          {
            userId,
            platform,
            method,
            endpoint
          },
          { mysql }
        )
        .then(result => {
          const sql = 'CALL getRateLimitReset(?, ?, ?, ?);'

          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            [userId, platform, method, endpoint]
          ])

          expect(result).to.equal('0')
        })
    })

    it('should reject with the error', () => {
      const error = new Error('oops')
      simple.mock(mysql, 'query').rejectWith(error)

      return db.getUserRateLimit({}, { mysql }).catch(e => {
        assert.deepEqual(e, error)
      })
    })
  })

  describe('storeTweet', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should add tweet to db', () => {
      simple.mock(mysql, 'query').resolveWith()

      const widgetId = 'widget-id'
      const tweetId = 'tweet-id'
      const senderId = 'sender-id'
      const senderHandle = 'SenderHandle'
      const mentionedUserId = 'mentioned-user-id'
      const mentionedHandle = 'MentionedHandle'
      const createdAt = 1234567890
      const tweet = { id_str: tweetId, created_at: createdAt }
      const responseHash = 'hashed-response'
      const tweetContentHash = 'AwesomeHashOfAwesomeNess'

      return db
        .storeTweet(
          {
            widgetId,
            tweetId,
            senderId,
            senderHandle,
            mentionedUserId,
            mentionedHandle,
            createdAt,
            tweet,
            responseHash,
            tweetContentHash
          },
          { mysql }
        )
        .then(() => {
          const sql =
            'INSERT INTO tweet_cache ' +
            '(widget_id, tweet_id, sender_id, sender_handle, mentioned_user_id, mentioned_handle, created_at, tweet, response_hash, tweet_content_hash) ' +
            'VALUES ' +
            '(:widgetId, :tweetId, :senderId, :senderHandle, :mentionedUserId, :mentionedHandle, :createdAt, :tweet, :responseHash, :tweetContentHash); '

          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            {
              widgetId,
              tweetId,
              senderId,
              senderHandle,
              mentionedUserId,
              mentionedHandle,
              createdAt,
              tweet: JSON.stringify(tweet),
              responseHash,
              tweetContentHash
            }
          ])
        })
    })

    it('should add random response pool recipient', () => {
      simple.mock(mysql, 'query').resolveWith()
      const poolId = 'pool-id'
      const mentionedUserId = 'recipient-id'

      return db
        .updatePoolRecipients(
          {
            poolId,
            mentionedUserId
          },
          { mysql }
        )
        .then(() => {
          const sql =
            'INSERT INTO pool_recipients ' +
            '(pool_id, mentioned_user_id) ' +
            'VALUES ' +
            '(:poolId, :mentionedUserId); '

          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            {
              poolId,
              mentionedUserId
            }
          ])
        })
    })

    it('should reject on db error', () => {
      const error = new Error('oops')
      simple.mock(mysql, 'query').rejectWith(error)

      return db.storeTweet({}, { mysql }).catch(e => {
        expect(e).to.deep.equal(error)
      })
    })
  })

  describe('storeHiddenTweet', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should add hidden tweet to db', () => {
      simple.mock(mysql, 'query').resolveWith()

      const widgetId = 'widget-id'
      const tweetId = 'tweet-id'
      const userId = 'reply-user-id'
      const userHandle = 'handle-of-reply-user'
      const createdAt = 1234567890
      const replyText = 'fuckey mc fuckface'
      const hiddenAt = '1234'

      return db
        .storeHiddenTweet(
          {
            widgetId,
            userId,
            userHandle,
            tweetId,
            createdAt,
            replyText,
            hiddenAt
          },
          { mysql }
        )
        .then(() => {
          const sql =
            'INSERT INTO hidden_tweets ' +
            '(widget_id, tweet_id, user_id, user_handle, created_at, hidden_at, reply_text, auto_hidden) ' +
            'VALUES ' +
            '(:widgetId, :tweetId, :userId, :userHandle, :createdAt, :hiddenAt, :replyText, :autoHidden); '

          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            {
              widgetId,
              userId,
              userHandle,
              tweetId,
              createdAt,
              replyText,
              hiddenAt,
              autoHidden: 1
            }
          ])
        })
    })

    it('should reject on db error', () => {
      const error = new Error('oops')
      simple.mock(mysql, 'query').rejectWith(error)

      return db.storeHiddenTweet({}, { mysql }).catch(e => {
        expect(e).to.deep.equal(error)
      })
    })
  })

  describe('deleteTweet', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should set deleted_at', () => {
      simple.mock(mysql, 'query').resolveWith()

      const tweetId = 'tweet-id'

      return db.deleteTweet(tweetId, { mysql }).then(() => {
        const sql =
          'UPDATE tweet_cache SET deleted_at=UNIX_TIMESTAMP() * 1000 WHERE tweet_id=?;'

        assert(mysql.query.called)
        expect(mysql.query.lastCall.args).to.deep.equal([
          {
            sql
          },
          [tweetId]
        ])
      })
    })
  })

  describe('getMetaPageAccessToken', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should fetch encrypted Meta page access token from database', () => {
      simple.mock(mysql, 'query').resolveWith()

      const ownerId = '1234'

      return db.getMetaPageAccessToken(ownerId, { mysql }).then(() => {
        const sql =
          '(SELECT page_access_token FROM users where id = :ownerId) UNION (SELECT page_access_token FROM users where instagram_business_id = :ownerId) LIMIT 1;'

        assert(mysql.query.called)
        expect(mysql.query.lastCall.args).to.deep.equal([
          {
            sql
          },
          { ownerId: '1234' }
        ])
      })
    })

    it('should reject if function is called with no owner ID', () => {
      return db.getMetaPageAccessToken(null, { mysql }).catch(e => {
        expect(e.message).to.deep.equal('No owner ID specified')
      })
    })
  })

  describe('getIgPageAccessToken', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should fetch encrypted meta page access token from database', () => {
      simple.mock(mysql, 'query').resolveWith()

      const IgBusinessId = '1234'

      return db.getIgPageAccessToken(IgBusinessId, { mysql }).then(() => {
        const sql =
          'SELECT page_access_token FROM users where instagram_business_id = :IgBusinessId;'

        assert(mysql.query.called)
        expect(mysql.query.lastCall.args).to.deep.equal([
          {
            sql
          },
          { IgBusinessId: '1234' }
        ])
      })
    })

    it('should reject if function is called with no ig business id', () => {
      return db.getIgPageAccessToken(null, { mysql }).catch(e => {
        expect(e.message).to.deep.equal('No Ig business ID specified')
      })
    })
  })

  describe('getTweetDuplicates', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should fetch cached tweets based on widget Id and the mentioned handle', () => {
      simple.mock(mysql, 'query').resolveWith()

      const widgetId = '1234'
      const mentionedHandle = 'mentionedHandle'

      return db
        .getTweetDuplicates(widgetId, mentionedHandle, { mysql })
        .then(() => {
          const sql = `SELECT tweet_content_hash AS tweetContentHash
  FROM tweet_cache
  WHERE widget_id = :widgetId
  AND mentioned_handle = :mentionedHandle
  ORDER BY created_at DESC;`

          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            { widgetId: '1234', mentionedHandle: 'mentionedHandle' }
          ])
        })
    })
  })

  describe('getFbParticipants', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should fetch participants based on widgetId and userPsid', () => {
      simple.mock(mysql, 'query').resolveWith()

      const widgetId = '1234'
      const userPsid = '4321'

      return db.getFbParticipants(widgetId, userPsid, { mysql }).then(() => {
        const sql = `SELECT * FROM facebook_participants WHERE widget_id = :widgetId AND user_psid = :userPsid;`

        assert(mysql.query.called)
        expect(mysql.query.lastCall.args).to.deep.equal([
          {
            sql
          },
          { widgetId: '1234', userPsid: '4321' }
        ])
      })
    })
  })

  describe('speed thread participants', () => {
    describe('getSpeedThreadParticipant', () => {
      it('should return 1 entry if participant exists', () => {
        simple
          .mock(mysql, 'query')
          .resolveWith([[{ user_id: 1, last_interaction_time: null }]])

        const params = {
          widgetId: '1234',
          userId: 'twitter-user-id'
        }

        return db.getSpeedThreadParticipant(params, { mysql }).then(result => {
          const sql = `SELECT user_id, last_interaction_time FROM speed_thread_participants WHERE widget_id = ? AND user_id = ?;`
          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            [params.widgetId, params.userId]
          ])
          expect(result).to.deep.equal([
            { user_id: 1, last_interaction_time: null }
          ])
        })
      })

      it('should return empty result if participant does not exist', () => {
        simple.mock(mysql, 'query').resolveWith([[]])

        const params = {
          widgetId: '1234',
          userId: 'twitter-user-id'
        }

        return db.getSpeedThreadParticipant(params, { mysql }).then(result => {
          const sql = `SELECT user_id, last_interaction_time FROM speed_thread_participants WHERE widget_id = ? AND user_id = ?;`
          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            [params.widgetId, params.userId]
          ])
          expect(result).to.deep.equal([])
        })
      })

      it('should reject if function is called with no widgetId', () => {
        return db.getSpeedThreadParticipant({}, { mysql }).catch(e => {
          expect(e.message).to.deep.equal('Widget ID is required.')
        })
      })

      it('should reject if function is called with no userId', () => {
        const params = {
          widgetId: '1234'
        }

        return db.getSpeedThreadParticipant(params, { mysql }).catch(e => {
          expect(e.message).to.deep.equal('User ID is required.')
        })
      })
    })

    describe('startSpeedThreadParticipant', () => {
      afterEach(() => {
        simple.restore()
      })
      it('should insert a new participant with timeout', () => {
        simple.mock(mysql, 'query').resolveWith()
        const params = {
          widgetId: '1234',
          userId: 'twitter-user-id',
          userHandle: 'twitter-user-handle',
          firstInteractionTime: 1234567890,
          optinId: 'optin-id',
          timeout: 30
        }

        return db.startSpeedThreadParticipant(params, { mysql }).then(() => {
          const sql = `INSERT INTO speed_thread_participants (widget_id, user_id, handle, first_interaction_time, optin_id, timeout_at) VALUES (?, ?, ?, ?, ?, ?);`
          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            [
              params.widgetId,
              params.userId,
              params.userHandle,
              params.firstInteractionTime,
              params.optinId,
              1234567920
            ]
          ])
        })
      })

      it('should insert a new participant without a timeout', () => {
        simple.mock(mysql, 'query').resolveWith()
        const params = {
          widgetId: '1234',
          userId: 'twitter-user-id',
          userHandle: 'twitter-user-handle',
          firstInteractionTime: 1234567890,
          optinId: 'optin-id'
        }

        return db.startSpeedThreadParticipant(params, { mysql }).then(() => {
          const sql = `INSERT INTO speed_thread_participants (widget_id, user_id, handle, first_interaction_time, optin_id, timeout_at) VALUES (?, ?, ?, ?, ?, ?);`
          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            [
              params.widgetId,
              params.userId,
              params.userHandle,
              params.firstInteractionTime,
              params.optinId,
              null
            ]
          ])
        })
      })

      it('should reject if no widgetId is provided', () => {
        return db.startSpeedThreadParticipant({}, { mysql }).catch(e => {
          expect(e.message).to.equal('Widget ID is required.')
        })
      })

      it('should reject if no userId is provided', () => {
        return db
          .startSpeedThreadParticipant({ widgetId: '1234' }, { mysql })
          .catch(e => {
            expect(e.message).to.equal('User ID is required.')
          })
      })

      it('should reject if no userHandle is provided', () => {
        return db
          .startSpeedThreadParticipant(
            { widgetId: 'widget-id', userId: 'user-id' },
            { mysql }
          )
          .catch(e => {
            expect(e.message).to.equal('User handle is required.')
          })
      })

      it('should reject if no firstInteractionTime is provided', () => {
        return db
          .startSpeedThreadParticipant(
            {
              widgetId: 'widget-id',
              userId: 'user-id',
              userHandle: 'user-handle'
            },
            { mysql }
          )
          .catch(e => {
            expect(e.message).to.equal('First interaction time is required.')
          })
      })

      it('should reject if no optinId is provided', () => {
        return db
          .startSpeedThreadParticipant(
            {
              widgetId: 'widget-id',
              userId: 'user-id',
              userHandle: 'user-handle',
              firstInteractionTime: 1234567890
            },
            { mysql }
          )
          .catch(e => {
            expect(e.message).to.equal('Optin ID is required.')
          })
      })
    })

    describe('stopSpeedThreadParticipant', () => {
      afterEach(() => {
        simple.restore()
      })
      it('should call SQL for updating the `last_interaction_time` for a given participant', () => {
        simple.mock(mysql, 'query').resolveWith()
        const params = {
          widgetId: '1234',
          userId: 'twitter-user-id',
          finalInteractionTime: 1234567890
        }

        return db.stopSpeedThreadParticipant(params, { mysql }).then(() => {
          const sql = `UPDATE speed_thread_participants SET last_interaction_time = ? WHERE widget_id = ? AND user_id = ? AND first_interaction_time IS NOT NULL;`
          assert(mysql.query.called)
          expect(mysql.query.lastCall.args).to.deep.equal([
            {
              sql
            },
            [params.finalInteractionTime, params.widgetId, params.userId]
          ])
        })
      })

      it('should reject if no widgetId is provided', () => {
        return db.stopSpeedThreadParticipant({}, { mysql }).catch(e => {
          expect(e.message).to.equal('Widget ID is required.')
        })
      })

      it('should reject if no userId is provided', () => {
        return db
          .stopSpeedThreadParticipant({ widgetId: '1234' }, { mysql })
          .catch(e => {
            expect(e.message).to.equal('User ID is required.')
          })
      })

      it('should reject if no finalInteractionTime is provided', () => {
        return db
          .stopSpeedThreadParticipant(
            { widgetId: 'widget-id', userId: 'user-id' },
            { mysql }
          )
          .catch(e => {
            expect(e.message).to.equal('Final interaction time is required.')
          })
      })

      it('should handle any caught errors', () => {
        simple.mock(mysql, 'query').rejectWith('error')
        const params = {
          widgetId: '1234',
          userId: 'twitter-user-id',
          finalInteractionTime: 1234567890
        }

        return db.stopSpeedThreadParticipant(params, { mysql }).catch(e => {
          expect(e.message).to.equal(
            'Error updating final time elapsed for speed thread participant'
          )
        })
      })
    })

    describe('getInteractionDurationForParticipant', () => {
      afterEach(() => {
        simple.restore()
      })
      it('should return the final time elapsed for a given participant', () => {
        simple
          .mock(mysql, 'query')
          .resolveWith([[{ interaction_duration: 1234 }]])
        const params = {
          widgetId: '1234',
          userId: 'twitter-user-id'
        }

        return db
          .getInteractionDurationForParticipant(params, { mysql })
          .then(result => {
            const sql = `SELECT interaction_duration FROM speed_thread_participants WHERE widget_id = ? AND user_id = ?;`
            assert(mysql.query.called)
            expect(mysql.query.lastCall.args).to.deep.equal([
              {
                sql
              },
              [params.widgetId, params.userId]
            ])
            const expectedQueryResult = 1234
            expect(result).to.deep.equal(expectedQueryResult)
          })
      })

      it('should reject if no widgetId is provided', () => {
        return db
          .getInteractionDurationForParticipant({}, { mysql })
          .catch(e => {
            expect(e.message).to.equal('Widget ID is required.')
          })
      })

      it('should reject if no userId is provided', () => {
        return db
          .getInteractionDurationForParticipant({ widgetId: '1234' }, { mysql })
          .catch(e => {
            expect(e.message).to.equal('User ID is required.')
          })
      })

      it('should handle any caught errors', () => {
        simple.mock(mysql, 'query').rejectWith('error')
        const params = {
          widgetId: '1234',
          userId: 'twitter-user-id'
        }

        return db
          .getInteractionDurationForParticipant(params, { mysql })
          .catch(e => {
            expect(e.message).to.equal(
              'Error retrieving final time elapsed for speed thread participant'
            )
          })
      })
    })
  })
  describe('add participant', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should return the participant that was added to the database', () => {
      const options = {
        userId: 'user id',
        widgetId: 'widget id',
        handle: 'handle',
        responseType: 'repsonse_type',
        optinId: 'optin id',
        consentResponseTweetId: 'consent-response-tweet-id',
        status: 'status'
      }

      simple.mock(mysql, 'query').resolveWith(null)

      return db.addParticipant(options, { mysql }).then(result => {
        const [actualQuery, actualValues] = mysql.query.lastCall.args

        const expectedQuery = `
        INSERT INTO
          participants
          (
            widget_id,
            user_id,
            handle,
            response_type,
            optin_id,
            consent_response_tweet_id,
            status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?);
          `

        const {
          widgetId,
          userId,
          handle,
          responseType,
          optinId,
          consentResponseTweetId,
          status
        } = options
        const expectedValues = [
          widgetId,
          userId,
          handle,
          responseType,
          optinId,
          consentResponseTweetId,
          status
        ]

        assert(mysql.query.called, 'add participant query was not called')
        expect(normalizeSpaces(actualQuery.sql)).to.be.equal(
          normalizeSpaces(expectedQuery)
        )
        expect(actualValues).to.deep.equal(expectedValues)

        expect(result).to.deep.equal({
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
      })
    })

    it('should return the participant with duplicate flag when entry is a duplicate', () => {
      const options = {
        userId: 'user id',
        widgetId: 'widget id',
        handle: 'handle',
        responseType: 'repsonse_type',
        optinId: 'optin id',
        consentResponseTweetId: 'consent-response-tweet-id',
        status: 'status'
      }

      const error = new Error('Oops!')
      error.code = 'ER_DUP_ENTRY'
      simple.mock(mysql, 'query').rejectWith(error)

      return db.addParticipant(options, { mysql }).then(result => {
        const [actualQuery, actualValues] = mysql.query.lastCall.args

        const expectedQuery = `
        INSERT INTO
          participants
          (
            widget_id,
            user_id,
            handle,
            response_type,
            optin_id,
            consent_response_tweet_id,
            status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?);
          `

        const {
          widgetId,
          userId,
          handle,
          responseType,
          optinId,
          consentResponseTweetId,
          status
        } = options
        const expectedValues = [
          widgetId,
          userId,
          handle,
          responseType,
          optinId,
          consentResponseTweetId,
          status
        ]

        assert(mysql.query.called, 'add participant query was not called')
        expect(normalizeSpaces(actualQuery.sql)).to.be.equal(
          normalizeSpaces(expectedQuery)
        )
        expect(actualValues).to.deep.equal(expectedValues)

        expect(result).to.deep.equal({
          participant: {
            widgetId,
            userId,
            handle,
            responseType,
            optinId,
            consentResponseTweetId,
            status
          },
          duplicate: true
        })
      })
    })

    it('should reject with the error', () => {
      const error = new Error('oops')
      simple.mock(mysql, 'query').rejectWith(error)

      return db.addParticipant({}, { mysql }).catch(e => {
        assert.deepEqual(e, error)
      })
    })
  })

  describe('add timed thread activity', () => {
    afterEach(() => {
      simple.restore()
    })

    it('should return the timed thread activity that was added to the database', () => {
      const options = {
        widgetId: 'widget id',
        userId: 'user id',
        tweetId: 'tweet id',
        timestamp: 12345678000,
        userHandle: 'user handle'
      }

      simple.mock(mysql, 'query').resolveWith(null)

      return db.addTimedThreadActivity(options, { mysql }).then(result => {
        const [actualQuery, actualValues] = mysql.query.lastCall.args

        const expectedQuery = `
        INSERT INTO timed_thread_activity (widget_id, twitter_user_id, twitter_user_handle, tweet_id, created_at)
        VALUES (:widgetId, :userId, :userHandle, :tweetId, :timestamp);`

        const { widgetId, userId, userHandle, tweetId, timestamp } = options
        const expectedValues = {
          widgetId,
          userId,
          userHandle,
          tweetId,
          timestamp
        }

        assert(
          mysql.query.called,
          'add timed thread activity query was not called'
        )
        expect(normalizeSpaces(actualQuery.sql)).to.be.equal(
          normalizeSpaces(expectedQuery)
        )
        expect(actualValues).to.deep.equal(expectedValues)
      })
    })

    it('should throw an error if widget ID is not provided', async () => {
      const options = {
        userId: 'user id',
        tweetId: 'tweet id',
        timestamp: 12345678000,
        userHandle: 'user handle'
      }
      let errorCaught = false

      await db.addTimedThreadActivity(options, { mysql }).catch(e => {
        expect(e.message).to.equal('Widget ID is required.')
        errorCaught = true
      })

      expect(errorCaught).to.equal(true)
    })

    it('should throw an error if user ID is not provided', async () => {
      const options = {
        widgetId: 'widget id',
        tweetId: 'tweet id',
        timestamp: 12345678000,
        userHandle: 'user handle'
      }
      let errorCaught = false

      await db.addTimedThreadActivity(options, { mysql }).catch(e => {
        expect(e.message).to.equal('User ID is required.')
        errorCaught = true
      })

      expect(errorCaught).to.equal(true)
    })

    it('should throw an error if user handle is not provided', async () => {
      const options = {
        widgetId: 'widget id',
        userId: 'user id',
        tweetId: 'tweet id',
        timestamp: 12345678000
      }
      let errorCaught = false

      await db.addTimedThreadActivity(options, { mysql }).catch(e => {
        expect(e.message).to.equal('User handle is required.')
        errorCaught = true
      })

      expect(errorCaught).to.equal(true)
    })

    it('should throw an error if tweet ID is not provided', async () => {
      const options = {
        widgetId: 'widget id',
        userId: 'user id',
        timestamp: 12345678000,
        userHandle: 'user handle'
      }
      let errorCaught = false

      await db.addTimedThreadActivity(options, { mysql }).catch(e => {
        expect(e.message).to.equal('Tweet ID is required.')
        errorCaught = true
      })

      expect(errorCaught).to.equal(true)
    })

    it('should throw an error if timestamp is not provided', async () => {
      const options = {
        widgetId: 'widget id',
        userId: 'user id',
        tweetId: 'tweet id',
        userHandle: 'user handle'
      }
      let errorCaught = false

      await db.addTimedThreadActivity(options, { mysql }).catch(e => {
        expect(e.message).to.equal('Timestamp is required.')
        errorCaught = true
      })

      expect(errorCaught).to.equal(true)
    })
  })

  describe('trackInteraction', () => {
    beforeEach(() => {
      simple.mock(mysql, 'query')
    })

    afterEach(() => {
      simple.restore()
    })

    const widgetId = 'widget_id'
    const action = {
      eventId: 'event id 1234',
      trackingId: 'tracking id 1234',
      trackingDescription: 'An awesome description',
      interaction: { data1: 'data 1', data2: 'data 2' }
    }

    it('should save the interaction in the tracking table', async () => {
      await db.trackInteraction(widgetId, action, { mysql })
      const [actualQuery, actualValues] = mysql.query.lastCall.args

      const expectedQuery = `INSERT INTO interaction_tracking
        (eventId, widget_id, tracking_id, tracking_descr, data)
        VALUES (?, ?, ?, ?, ?);`

      const { eventId, trackingId, trackingDescription, interaction } = action
      const expectedValues = [
        eventId,
        widgetId,
        trackingId,
        trackingDescription,
        JSON.stringify(interaction)
      ]

      assert(
        mysql.query.called,
        'store tracking interaction query was not called'
      )
      expect(normalizeSpaces(actualQuery.sql)).to.be.equal(
        normalizeSpaces(expectedQuery)
      )
      expect(actualValues).to.deep.equal(expectedValues)
    })

    it('should throw an error if widgetId is not provided', async () => {
      try {
        await db.trackInteraction(null, action, { mysql })
        assert.Throw('Error not thrown')
      } catch (e) {
        expect(e.message).to.equal('Widget ID is required')
      }
    })

    it('should throw an error if trackingId is not provided', async () => {
      const specificAction = { ...action, trackingId: null }
      try {
        await db.trackInteraction(widgetId, specificAction, { mysql })
        assert.Throw('Error not thrown')
      } catch (e) {
        expect(e.message).to.equal('Tracking ID is required')
      }
    })

    it('should throw an error if trackingDescription is not provided', async () => {
      const specificAction = { ...action, trackingDescription: null }
      try {
        await db.trackInteraction(widgetId, specificAction, { mysql })
        assert.Throw('Error not thrown')
      } catch (e) {
        expect(e.message).to.equal('Tracking Description is required')
      }
    })

    it('should throw an error if interaction data is not provided', async () => {
      const specificAction = {
        eventId: 'event id 1234',
        trackingId: 'tracking id 1234',
        trackingDescription: 'An awesome description',
        interaction: {}
      }
      try {
        await db.trackInteraction(widgetId, specificAction, { mysql })
        assert.Throw('Error not thrown')
      } catch (e) {
        expect(e.message).to.equal('Interaction data is required')
      }
    })

    it('should throw an error if interaction data is undefined', async () => {
      const specificAction = {
        eventId: 'event id 1234',
        trackingId: 'tracking id 1234',
        trackingDescription: 'An awesome description',
        interaction: null
      }
      try {
        await db.trackInteraction(widgetId, specificAction, { mysql })
        assert.Throw('Error not thrown')
      } catch (e) {
        expect(e.message).to.equal('Interaction data is required')
      }
    })

    it('should throw an error if the database insert fails', async () => {
      simple.mock(mysql, 'query').rejectWith(new Error('Database error'))
      try {
        await db.trackInteraction(widgetId, action, { mysql })
        assert.Throw('Error not thrown')
      } catch (e) {
        expect(e.message).to.equal('Database error')
      }
    })
  })

  describe('cacheMetaMessageResponse', () => {
    const messageId = '1234'
    const recipientId = '5678'
    const widgetId = 'Awesome_widget'

    beforeEach(() => {
      simple.restore()
    })

    it('should store the response from a FB send message action', async () => {
      const query = simple.mock()
      await db.cacheMetaMessageResponse(
        messageId,
        recipientId,
        widgetId,
        'facebook',
        { mysql: { query } }
      )

      const sql = `
  INSERT INTO facebook_messages
    (id, psid, widget_id)
    VALUES (?, ?, ?);
  `

      expect(query.called).to.equal(true)
      expect(query.lastCall.args[0].sql).to.equal(sql)
      expect(query.lastCall.args[1]).to.deep.equal([
        '1234',
        '5678',
        'Awesome_widget'
      ])
    })

    it('should store the response from a IG send message action', async () => {
      const query = simple.mock()
      await db.cacheMetaMessageResponse(
        messageId,
        recipientId,
        widgetId,
        'instagram',
        { mysql: { query } }
      )

      const sql = `
  INSERT INTO instagram_messages
    (id, igsid, widget_id)
    VALUES (?, ?, ?);
  `

      expect(query.called).to.equal(true)
      expect(query.lastCall.args[0].sql).to.equal(sql)
      expect(query.lastCall.args[1]).to.deep.equal([
        '1234',
        '5678',
        'Awesome_widget'
      ])
    })

    it('should throw an error when messageID is not passed', async () => {
      try {
        await db.cacheMetaMessageResponse()
        expect.Throw('should throw an error')
      } catch (err) {
        expect(err.message).to.equal('Message Id is required')
      }
    })

    it('should throw an error when recipientId is not passed', async () => {
      try {
        await db.cacheMetaMessageResponse(messageId)
        expect.Throw('should throw an error')
      } catch (err) {
        expect(err.message).to.equal('Recipient Id is required')
      }
    })

    it('should throw an error when widgetId is not passed', async () => {
      try {
        await db.cacheMetaMessageResponse(messageId, recipientId)
        expect.Throw('should throw an error')
      } catch (err) {
        expect(err.message).to.equal('Widget Id is required')
      }
    })
  })

  describe('cacheMetaCommentResponse', () => {
    const messageId = '1234'
    const recipientId = '5678'
    const commentId = '4536'
    const widgetId = 'Awesome_widget'

    beforeEach(() => {
      simple.restore()
    })

    it('should store the response from a FB send comment action', async () => {
      const query = simple.mock()
      await db.cacheMetaCommentResponse(
        messageId,
        recipientId,
        commentId,
        widgetId,
        'facebook',
        { mysql: { query } }
      )

      const sql = `
  INSERT INTO facebook_comments
    (id, psid, post_id, widget_id)
    VALUES (?, ?, ?, ?);
  `

      expect(query.called).to.equal(true)
      expect(query.lastCall.args[0].sql).to.equal(sql)
      expect(query.lastCall.args[1]).to.deep.equal([
        messageId,
        recipientId,
        commentId,
        widgetId
      ])
    })

    it('should store the response from a IG send message action', async () => {
      const query = simple.mock()
      await db.cacheMetaCommentResponse(
        messageId,
        recipientId,
        commentId,
        widgetId,
        'instagram',
        { mysql: { query } }
      )

      const sql = `
  INSERT INTO instagram_comments
    (id, igsid, post_id, widget_id)
    VALUES (?, ?, ?, ?);
  `

      expect(query.called).to.equal(true)
      expect(query.lastCall.args[0].sql).to.equal(sql)
      expect(query.lastCall.args[1]).to.deep.equal([
        messageId,
        recipientId,
        commentId,
        widgetId
      ])
    })

    it('should throw an error when messageID is not passed', async () => {
      try {
        await db.cacheMetaCommentResponse()
        expect.Throw('should throw an error')
      } catch (err) {
        expect(err.message).to.equal('Message Id is required')
      }
    })

    it('should throw an error when recipientId is not passed', async () => {
      try {
        await db.cacheMetaCommentResponse(messageId)
        expect.Throw('should throw an error')
      } catch (err) {
        expect(err.message).to.equal('Recipient Id is required')
      }
    })

    it('should throw an error when commentId is not passed', async () => {
      try {
        await db.cacheMetaCommentResponse(messageId, recipientId)
        expect.Throw('should throw an error')
      } catch (err) {
        expect(err.message).to.equal('Comment Id is required')
      }
    })

    it('should throw an error when widgetId is not passed', async () => {
      try {
        await db.cacheMetaCommentResponse(messageId, recipientId, commentId)
        expect.Throw('should throw an error')
      } catch (err) {
        expect(err.message).to.equal('Widget Id is required')
      }
    })
  })
})
