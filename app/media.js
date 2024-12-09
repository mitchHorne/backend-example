const { MEDIA_URL } = process.env
const request = require('@bluerobot/request')
const { logger } = require('@bluerobot/monitoring')
const R = require('ramda')

const media = {
  /**
   * Match GCS media ids, such as '118f0061-c489-11e7-8330-0242ac190002'
   */
  isGcsMediaId: R.test(
    /^[a-z0-9_]{8}-[a-z0-9_]{4}-[a-z0-9_]{4}-[a-z0-9_]{4}-[a-z0-9_]{12}$/g
  ),

  /**
   * @typedef TwitterMediaIdsOptions
   * @property {string[]} gcsMediaIds IDs returned upon media upload to GCS
   * @property {string} userId Twitter user ID
   * @property {string} destination 'tweet' or 'dm' to indicate what the media will be included with
   */

  /**
   * Obtain Twitter media IDs based on GCS media IDs
   *
   * @param {TwitterMediaIdsOptions} options Get Twitter Media IDs options
   * @returns {Promise<string[]>} Resolves with Twitter media IDs
   */
  async getTwitterMediaIds (options = {}) {
    const { gcsMediaIds, userId, destination } = options

    if (!Array.isArray(gcsMediaIds)) {
      throw new Error("Param 'gcsMediaIds' should be an array")
    }

    if (typeof userId !== 'string') {
      throw new Error("Param 'userId' should be a string")
    }

    if (destination !== 'tweet' && destination !== 'dm') {
      throw new Error("Param 'destination' should be either 'tweet' or 'dm'")
    }

    return Promise.all(
      gcsMediaIds.map(gcsMediaId =>
        this.getTwitterMediaId({
          gcsMediaId,
          userId,
          destination
        })
      )
    )
  },

  /**
   * @typedef TwitterMediaIdOptions
   * @property {string} gcsMediaId IDs returned upon media upload to GCS
   * @property {string} userId Twitter user ID
   * @property {string} destination 'tweet' or 'dm' to indicate what the media will be included with
   */

  /**
   * Obtain Twitter media ID based on GCS media ID
   *
   * @param {TwitterMediaIdOptions} options Get Twitter Media ID options
   * @param {object=} deps Dependencies
   * @param {string=} deps.mediaUri A URL to the media service
   * @returns {Promise<string>} Resolves with Twitter media ID
   */
  async getTwitterMediaId (
    { gcsMediaId, userId, destination },
    { mediaUri = MEDIA_URL } = {}
  ) {
    if (typeof gcsMediaId !== 'string') {
      throw new Error("Param 'gcsMediaId' should be a string")
    }

    if (!this.isGcsMediaId(gcsMediaId)) {
      logger.debug(
        `Incorrect gcs media id format, assuming media id ('${gcsMediaId}') is in twitter format...`
      )
      return gcsMediaId
    }

    if (typeof userId !== 'string') {
      throw new Error("Param 'userId' should be a string")
    }

    if (destination !== 'tweet' && destination !== 'dm') {
      throw new Error("Param 'destination' should be either 'tweet' or 'dm'")
    }

    logger.debug(
      `Calling media service to obtain twitter media id (${destination}) for gcs media id '${gcsMediaId}'...`
    )

    let response = await request({
      url: `${mediaUri}/twitter/${gcsMediaId}`,
      searchParams: {
        destination
      },
      responseType: 'json'
    })

    if (response.body && response.body.id) {
      logger.debug(`Obtained twitter media id '${response.body.id}'`)
      return response.body.id
    }

    logger.debug(
      `No twitter media id available, calling media service to upload media to twitter for gcs media id '${gcsMediaId}'...`
    )

    response = await request({
      url: `${mediaUri}/twitter/upload/${userId}/${gcsMediaId}`,
      searchParams: {
        destination
      },
      responseType: 'json'
    })

    if (response.body && response.body.id) {
      logger.debug(`Obtained twitter media id '${response.body.id}'`)
      return response.body.id
    }

    logger.debug('No twitter media id available')
  }
}

module.exports = media
