const createMysql = require('@bluerobot/mysql')

const mysqlInstance = createMysql()

/**
 * @typedef UpsertRateLimitOptions
 * @property {string} userId Twitter User ID
 * @property {string} platform Social platform
 * @property {string} method HTTP method
 * @property {string} endpoint HTTP endpoint path
 * @property {number} limitResetAt Time when rate limit resets in unix epoch ms
 */

/**
 * Calls DB to upsert a rate limit entry.
 *
 * @param {UpsertRateLimitOptions} options Upsert options
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql Mysql instance
 * @returns {Promise<object>} Resolves with mysql response
 */
function upsertRateLimit (
  options,
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  const { userId, platform, method, endpoint, limitResetAt } = options

  const sql =
    'INSERT INTO rate_limit (user_id, platform, method, endpoint, limit_reset_at ) VALUES (?, ?, ?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE ' +
    'user_id = VALUES(user_id), ' +
    'platform = VALUES(platform), ' +
    'method = VALUES(method), ' +
    'endpoint = VALUES(endpoint), ' +
    'limit_reset_at = VALUES(limit_reset_at);'

  return mysql.query({ sql }, [
    userId,
    platform,
    method,
    endpoint,
    limitResetAt
  ])
}

/**
 * Insert into data set table.
 *
 * @param {object} options Configuration options
 * @param {string} options.dataset Table to insert into
 * @param {object} options.data Data to insert
 * @returns {Promise<object>} Resolves with mysql response
 */
function insert (
  { dataset: table, data },
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  const sql = `INSERT INTO ${table} (data) VALUES (?);`

  return mysql.query({ sql }, [data])
}

/**
 * Update data set table.
 *
 * @param {object} options Configuration options
 * @param {string} options.dataset Table to insert into
 * @param {string} options.column Column to update
 * @param {*} options.value Value to set
 * @param {string} options.searchColumn Where clause column
 * @param {*} options.searchKey Where clause value
 * @returns {Promise<object>} Resolves with mysql response
 */
function update (
  { dataset: table, column, value, searchColumn, searchKey },
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  const sql = `UPDATE \`${table}\` SET \`${column}\` = ? WHERE \`${searchColumn}\` = ${searchKey};`

  return mysql.query({ sql }, [value])
}

/**
 * @typedef GetRateLimitOptions
 * @property {string} userId Twitter User ID
 * @property {string} platform Social platform
 * @property {string} method HTTP method
 * @property {string} endpoint HTTP endpoint path
 */

/**
 * Calls DB to get a rate limit entry.
 *
 * @param {GetRateLimitOptions} options Upsert options
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql Mysql instance
 * @returns {Promise<object>} Resolves with mysql response
 */
async function getUserRateLimit (
  { userId, platform, method, endpoint },
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  const params = [userId, platform, method, endpoint]
  const sql = 'CALL getRateLimitReset(?, ?, ?, ?);'

  const [rows] = await mysql.query({ sql }, params)

  const [[{ limitResetAt: result }]] = rows

  return result
}

/**
 * @typedef StoreTweetOptions
 * @property {string} widgetId Widget ID
 * @property {string} tweetId Tweet ID
 * @property {string} senderId Twitter sender user ID
 * @property {string} senderHandle Twitter sender user handle
 * @property {number} createdAt Tweet event created at timestamp in milliseconds
 * @property {object} tweet Tweet object as recevied from Twitter
 */

/**
 * @typedef StoreHiddenTweetOptions
 * @property {string} widgetId Widget ID
 * @property {string} tweetId Tweet ID
 * @property {string} userId User's ID whose tweet is being hidden
 * @property {string} userHandle User's handle whose tweet is being hidden
 * @property {number} createdAt Tweet event created at timestamp in milliseconds
 * @property {number} hiddenAt The time the processor is hiding it in milliseconds
 * @property {string} replyText The text of the reply to the hidden tweet
 * @property {number} autoHidden Whether the tweet was auto hidden (done by processor) or not
 */

/**
 * Stores a given Tweet in the database
 *
 * @param {StoreTweetOptions} options Store Tweet options
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql Mysql instance
 * @returns {Promise<object>} Resolves with mysql response
 */
function storeTweet (
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
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  const sql =
    'INSERT INTO tweet_cache ' +
    '(widget_id, tweet_id, sender_id, sender_handle, mentioned_user_id, mentioned_handle, created_at, tweet, response_hash, tweet_content_hash) ' +
    'VALUES ' +
    '(:widgetId, :tweetId, :senderId, :senderHandle, :mentionedUserId, :mentionedHandle, :createdAt, :tweet, :responseHash, :tweetContentHash); '

  return mysql.query(
    { sql },
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
  )
}

/**
 * Stores a hidden Tweet in the database
 *
 * @param {StoreHiddenTweetOptions} options Store hidden tweet options
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql Mysql instance
 * @returns {Promise<object>} Resolves with mysql response
 */
function storeHiddenTweet (
  {
    widgetId,
    tweetId,
    userId,
    userHandle,
    createdAt,
    hiddenAt = Date.now(),
    replyText,
    autoHidden = 1
  },
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  const sql =
    'INSERT INTO hidden_tweets ' +
    '(widget_id, tweet_id, user_id, user_handle, created_at, hidden_at, reply_text, auto_hidden) ' +
    'VALUES ' +
    '(:widgetId, :tweetId, :userId, :userHandle, :createdAt, :hiddenAt, :replyText, :autoHidden); '

  return mysql.query(
    { sql },
    {
      widgetId,
      tweetId,
      userId,
      userHandle,
      createdAt,
      hiddenAt,
      replyText,
      autoHidden
    }
  )
}

/**
 * Stores pool ID and recipient ID of a random response dark tweet
 *
 * @param {object} options recipient pool options
 * @param {string} options.poolId pool ID
 * @param {string} options.mentionedUserId recipient id
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql Mysql instance
 * @returns {Promise<object>} Resolves with mysql response
 */
function updatePoolRecipients (
  { poolId, mentionedUserId },
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  const sql =
    'INSERT INTO pool_recipients ' +
    '(pool_id, mentioned_user_id) ' +
    'VALUES ' +
    '(:poolId, :mentionedUserId); '

  return mysql.query(
    { sql },
    {
      poolId,
      mentionedUserId
    }
  )
}

/**
 * Sets the `deleted_at` field in the Tweet Cache
 *
 * @param {string} tweetId the id of the deleted tweet
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql Mysql instance
 * @returns {Promise<object>} Resolves with mysql response
 */
function deleteTweet (
  tweetId, // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  const sql =
    'UPDATE tweet_cache SET deleted_at=UNIX_TIMESTAMP() * 1000 WHERE tweet_id=?;'

  return mysql.query({ sql }, [tweetId])
}

/**
 * Returns whether a given user is a participant in a given speed thread experience.
 *
 * @param {object=} params Configuration options
 * @param {string} params.widgetId Widget ID
 * @param {string} params.userId Twitter user ID
 * @param {object=} deps Dependencies
 * @param {object} deps.mysql Mysql instance
 * @returns {Promise<boolean>} Resolves with true if the user is a participant, false otherwise
 */
async function getSpeedThreadParticipant (
  { widgetId, userId },
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  if (!widgetId) throw new Error('Widget ID is required.')
  if (!userId) throw new Error('User ID is required.')

  const sql = `SELECT user_id, last_interaction_time FROM speed_thread_participants WHERE widget_id = ? AND user_id = ?;`

  const [rows] = await mysql.query({ sql }, [widgetId, userId])

  return rows
}

/**
 * Inserts a new row into the `speed_thread_participants` table with a given timestamp for the first interaction.
 *
 * @param {object} params Configuration options
 * @param {string} params.widgetId Widget ID of the speed thread experience
 * @param {string} params.userId Twitter user ID
 * @param {string} params.userHandle Twitter user handle
 * @param {number} params.firstInteractionTime Timestamp of the first interaction
 * @param {string} params.optinId ID that identifies the related event from Twitter
 * @param {number} params.timeout Timeout value in milliseconds
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql Mysql instance
 * @returns {Promise<object>} Resolves with mysql response
 */
async function startSpeedThreadParticipant (
  { widgetId, userId, userHandle, firstInteractionTime, optinId, timeout },
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  if (!widgetId) throw new Error('Widget ID is required.')
  if (!userId) throw new Error('User ID is required.')
  if (!userHandle) throw new Error('User handle is required.')
  if (!firstInteractionTime)
    throw new Error('First interaction time is required.')
  if (!optinId) throw new Error('Optin ID is required.')

  const timeoutAt = timeout
    ? parseInt(firstInteractionTime) + parseInt(timeout)
    : null

  const sql = `INSERT INTO speed_thread_participants (widget_id, user_id, handle, first_interaction_time, optin_id, timeout_at) VALUES (?, ?, ?, ?, ?, ?);`

  return mysql.query({ sql }, [
    widgetId,
    userId,
    userHandle,
    firstInteractionTime,
    optinId,
    timeoutAt
  ])
}

/**
 * Populates the final interaction for a given user in a given speed thread experience,
 * and calculates the final time elapsed.
 *
 * @param {object} params Parameter object
 * @param {string} params.widgetId Widget ID of the speed thread experience
 * @param {string} params.userId Twitter user ID
 * @param {number} params.finalInteractionTime Timestamp of the final interaction
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql Mysql instance
 * @returns {Promise<object>} Resolves with mysql response
 */
async function stopSpeedThreadParticipant (
  { widgetId, userId, finalInteractionTime },
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  if (!widgetId) throw new Error('Widget ID is required.')
  if (!userId) throw new Error('User ID is required.')
  if (!finalInteractionTime)
    throw new Error('Final interaction time is required.')

  try {
    const sql = `UPDATE speed_thread_participants SET last_interaction_time = ? WHERE widget_id = ? AND user_id = ? AND first_interaction_time IS NOT NULL;`

    return await mysql.query({ sql }, [finalInteractionTime, widgetId, userId])
  } catch (err) {
    // cautious logging not to show database structure
    throw new Error(
      'Error updating final time elapsed for speed thread participant',
      { widgetId, userId, finalInteractionTime }
    )
  }
}

/**
 * Fetches the final time elapsed for a given user in a given speed thread experience.
 * If the user is not a participant, returns null.
 * If the user is a participant but has not yet completed the experience, returns null.
 * If the user is a participant and has completed the experience, returns the final time elapsed.
 *
 * @param {object} params Parameter object
 * @param {string} params.widgetId Widget ID of the speed thread experience
 * @param {string} params.userId Twitter user ID
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql Mysql instance
 * @returns {Promise<number|null>} Resolves with the final time elapsed, or null if the user is not a participant or has not yet completed the experience
 */
async function getInteractionDurationForParticipant (
  { widgetId, userId },
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  if (!widgetId) throw new Error('Widget ID is required.')
  if (!userId) throw new Error('User ID is required.')

  try {
    const sql = `SELECT interaction_duration FROM speed_thread_participants WHERE widget_id = ? AND user_id = ?;`

    const [[rows]] = await mysql.query({ sql }, [widgetId, userId])
    return rows.interaction_duration
  } catch (err) {
    // cautious logging not to show database structure
    throw new Error(
      'Error retrieving final time elapsed for speed thread participant',
      { widgetId, userId }
    )
  }
}

/**
 * Adds a new row to the `timed_thread_activity` table.
 * This table is used to track the activity of a user in a timed thread experience.
 *
 * @param {object} params Parameter object
 * @param {string} params.widgetId Widget ID of the timed thread experience
 * @param {string} params.userId Twitter user ID
 * @param {string} params.userHandle Twitter user handle
 * @param {string} params.tweetId Tweet ID that the user interacted with
 * @param {number} params.timestamp Timestamp of the activity
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql Mysql instance
 * @returns {Promise<object>} Resolves with mysql response
 */
async function addTimedThreadActivity (
  { widgetId, userId, userHandle, tweetId, timestamp },
  // istanbul ignore next
  { mysql = mysqlInstance } = {}
) {
  if (!widgetId) throw new Error('Widget ID is required.')
  if (!userId) throw new Error('User ID is required.')
  if (!userHandle) throw new Error('User handle is required.')
  if (!tweetId) throw new Error('Tweet ID is required.')
  if (!timestamp) throw new Error('Timestamp is required.')

  const sql = `
  INSERT INTO timed_thread_activity (widget_id, twitter_user_id, twitter_user_handle, tweet_id, created_at)
  VALUES (:widgetId, :userId, :userHandle, :tweetId, :timestamp);`

  return mysql.query(
    { sql },
    {
      widgetId,
      userId,
      userHandle,
      tweetId,
      timestamp
    }
  )
}

/**
 * Fetches Meta user's encrypted page access token  from the database
 *
 * @param {string} ownerId the owner's id
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql An instance of mysql
 * @returns {Promise} Pool query response
 */
async function getMetaPageAccessToken (
  ownerId,
  /* istanbul ignore next */
  { mysql = mysqlInstance } = {}
) {
  if (!ownerId) return Promise.reject(new Error('No owner ID specified'))

  const sql =
    '(SELECT page_access_token FROM users where id = :ownerId) UNION (SELECT page_access_token FROM users where instagram_business_id = :ownerId) LIMIT 1;'

  const result = mysql.query({ sql }, { ownerId })
  return result
}

/**
 * Fetches Ig user's encrypted page access token from the database using the instagram business id
 *
 * @param {string} IgBusinessId the owner's IG business id
 * @param {object=} deps Dependencies
 * @param {object=} deps.mysql An instance of mysql
 * @returns {Promise} Pool query response
 */
async function getIgPageAccessToken (
  IgBusinessId,
  /* istanbul ignore next */
  { mysql = mysqlInstance } = {}
) {
  if (!IgBusinessId)
    return Promise.reject(new Error('No Ig business ID specified'))

  const sql =
    'SELECT page_access_token FROM users where instagram_business_id = :IgBusinessId;'

  const result = mysql.query({ sql }, { IgBusinessId })
  return result
}

/**
 * Gets the matching tweets from this widget to a specific handle
 *
 * @param {string} widgetId - Id of widget
 * @param {string} mentionedHandle - Handle of user mentioned
 * @param {object} deps - dependencies
 * @param {string} deps.mysql - Mysql instance ofr mocking purposes
 * @returns {Array} - Array of matching cached tweets
 */
function getTweetDuplicates (
  widgetId,
  mentionedHandle,
  /* istanbul ignore next */
  { mysql = mysqlInstance } = {}
) {
  const sql = `SELECT tweet_content_hash AS tweetContentHash
  FROM tweet_cache
  WHERE widget_id = :widgetId
  AND mentioned_handle = :mentionedHandle
  ORDER BY created_at DESC;`

  const result = mysql.query({ sql }, { widgetId, mentionedHandle })
  return result
}

/**
 * Get all opted in participants for a widget
 *
 * @param {string} widgetId - widget Id
 * @param {string} userPsid - Facebook user psid
 * @param {object} deps - dependency injection
 * @param {Function} deps.mysql - mocked mysql
 * @returns {Promise} - mysql query response
 */
function getFbParticipants (
  widgetId,
  userPsid,
  /* istanbul ignore next */ { mysql = mysqlInstance } = {}
) {
  const sql = `SELECT * FROM facebook_participants WHERE widget_id = :widgetId AND user_psid = :userPsid;`
  return mysql.query({ sql }, { widgetId, userPsid })
}

/**
 * The addParticipant function is used for mosaics only.
 * This adds a participant to the database with status pending_explicit_consent
 * The status gets updated to ready when the user responds to the consent tweet
 *
 * @param {object} participant Participant to be subscribed to the experience
 * @param {string} participant.widgetId Widget ID that the participant is subscribed to
 * @param {string} participant.userId Participant ID
 * @param {string} participant.handle Participant handle
 * @param {string} participant.responseType Action used to send reminder to user (SEND_DARK_TWEET|SEND_DM)
 * @param {string} participant.optinId ID of the medium used to opt in
 * @param {string} participant.consentResponseTweetId ID of the consent tweet sent to the user
 * @param {string} participant.status has the user granted consent to participate in the experience (PENDING_EXPLICIT_CONSENT|READY)
 * @returns {Promise<object>} Promise that resolves with the participant object added when successful
 */
async function addParticipant (
  /* istanbul ignore next */
  participant = {},
  /* istanbul ignore next */
  { mysql = mysqlInstance } = {}
) {
  const {
    widgetId,
    userId,
    handle,
    responseType,
    optinId,
    consentResponseTweetId,
    status
  } = participant

  const sql = `
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

  try {
    await mysql.query({ sql }, [
      widgetId,
      userId,
      handle,
      responseType,
      optinId,
      consentResponseTweetId,
      status
    ])
  } catch (error) {
    const { code } = error
    if (code === 'ER_DUP_ENTRY') {
      return { participant, duplicate: true }
    }
    throw error // reject on everything except duplicate insert
  }

  return { participant, duplicate: false }
}

/**
 * Adds the tracking interaction for a social media event
 *
 * @param {string} widgetId Id of the widget
 * @param {object} action Object with the action data
 * @param {object} action.interaction Object with the interaction data
 * @param {object} action.eventId Interaction event id
 * @param {object} action.tracking_id Interaction tracking id
 * @param {object} action.tracking_descr Interaction tracking description
 * @param {object} deps Dependency injection
 * @param {object} deps.mysql Mysql dependency injection
 */
async function trackInteraction (
  widgetId,
  action,
  /* istanbul ignore next */
  { mysql = mysqlInstance } = {}
) {
  const { eventId, trackingId, trackingDescription, interaction } = action

  if (!widgetId) throw new Error('Widget ID is required')
  if (!trackingId) throw new Error('Tracking ID is required')
  if (!trackingDescription) throw new Error('Tracking Description is required')
  if (!interaction || !Object.keys(interaction).length)
    throw new Error('Interaction data is required')

  const sql = `INSERT INTO interaction_tracking
    (eventId, widget_id, tracking_id, tracking_descr, data)
    VALUES (?, ?, ?, ?, ?);`

  await mysql.query({ sql }, [
    eventId,
    widgetId,
    trackingId,
    trackingDescription,
    JSON.stringify(interaction)
  ])
}

/**
 * Stores the response from meta on message success
 *
 * @param {string} messageId Meta message Id
 * @param {string} recipientId Meta user the message was sent to
 * @param {object} widgetId Id of the widget
 * @param {string} platform facebook | instagram
 * @param {object} deps Dependency injection
 * @param {object} deps.mysql Mysql dependency injection
 */
async function cacheMetaMessageResponse (
  messageId,
  recipientId,
  widgetId,
  platform,
  /* istanbul ignore next */
  { mysql = mysqlInstance } = {}
) {
  if (!messageId) throw new Error('Message Id is required')
  if (!recipientId) throw new Error('Recipient Id is required')
  if (!widgetId) throw new Error('Widget Id is required')

  const table = `${platform}_messages`
  const idColumn = platform === 'facebook' ? 'psid' : 'igsid'
  const sql = `
  INSERT INTO ${table}
    (id, ${idColumn}, widget_id)
    VALUES (?, ?, ?);
  `

  await mysql.query({ sql }, [messageId, recipientId, widgetId])
}

/**
 * Stores the response from meta on comment reply success
 *
 * @param {string} messageId Meta message Id
 * @param {string} recipientId Meta user the message was sent to
 * @param {string} commentId Meta comment id on which comment reply was made
 * @param {object} widgetId Id of the widget
 * @param {string} platform facebook | instagram
 * @param {object} deps Dependency injection
 * @param {object} deps.mysql Mysql dependency injection
 */
async function cacheMetaCommentResponse (
  messageId,
  recipientId,
  commentId,
  widgetId,
  platform,
  /* istanbul ignore next */
  { mysql = mysqlInstance } = {}
) {
  if (!messageId) throw new Error('Message Id is required')
  if (!recipientId) throw new Error('Recipient Id is required')
  if (!commentId) throw new Error('Comment Id is required')
  if (!widgetId) throw new Error('Widget Id is required')

  const table = `${platform}_comments`
  const idColumn = platform === 'facebook' ? 'psid' : 'igsid'
  const sql = `
  INSERT INTO ${table}
    (id, ${idColumn}, post_id, widget_id)
    VALUES (?, ?, ?, ?);
  `

  await mysql.query({ sql }, [messageId, recipientId, commentId, widgetId])
}

module.exports = {
  upsertRateLimit,
  insert,
  update,
  getUserRateLimit,
  storeTweet,
  storeHiddenTweet,
  deleteTweet,
  getSpeedThreadParticipant,
  startSpeedThreadParticipant,
  stopSpeedThreadParticipant,
  getInteractionDurationForParticipant,
  addTimedThreadActivity,
  getMetaPageAccessToken,
  getIgPageAccessToken,
  getTweetDuplicates,
  getFbParticipants,
  updatePoolRecipients,
  addParticipant,
  trackInteraction,
  cacheMetaMessageResponse,
  cacheMetaCommentResponse
}
