const { logger, metrics } = require('@bluerobot/monitoring')
const R = require('ramda')

const actionProcessor = require('./action-processor')
const utils = require('./utils')
const { requeueIfValid } = require('./errors')
const { checkAndHandleFailureActions } = utils

const exchangeName = process.env.AMQP_EXCHANGE || 'bluerobot'

/**
 * Parses message received from AMQP
 *
 * @param {object} message Message as received from AMQP
 * @returns {object} Parsed message
 */
function parseMessage (message) {
  const [, , type, userId] = message.fields.routingKey.split('.')
  logger.debug(
    {
      routingFields: message.fields.routingKey.split('.')
    },
    'temp: Routing fields'
  )

  const messageContentString = message.content.toString()
  const messageContent = JSON.parse(messageContentString)
  logger.debug({ messageContent }, 'temp: Message content')

  if (!messageContent.type) {
    logger.debug({ type }, 'temp: Type to be added to message content')
    return {
      userId, // NB! messageContent may contain userId which should not be overwritten
      ...messageContent,
      type
    }
  }

  return {
    userId, // NB! messageContent may contain userId which should not be overwritten
    ...messageContent
  }
}

/**
 * Processes message received from AMQP
 *
 * @param {object} options Configuration options
 * @param {object} options.channel AMQP channel
 * @param {object} options.message AMQP message
 * @param {object=} deps Dependencies
 * @param {Function=} deps.parseMessage Parses the AMQP message
 * @param {Function=} deps.isExpired Checks if an action is expired
 * @param {Buffer=} deps.buffer Converts an object into a JSON Buffer
 * @param {Function=} deps.processAction Processes an action
 * @returns {Promise<undefined>} Resolves when message processed
 */
async function handleMessage (
  { channel, message },
  // istanbul ignore next
  {
    parse = parseMessage,
    isExpired = utils.isExpired,
    buffer = utils.bufferFromPayload,
    processAction = actionProcessor.processAction
  } = {}
) {
  let action
  let priority

  try {
    action = parse(message)
    priority = message.properties.priority

    const sanitizedAction = utils.sanitizeAction(action)
    const expired = isExpired(action)
    if (expired) {
      const type = action && action.type ? action.type : 'UNKNOWN'
      logger.debug(
        {
          action: sanitizedAction
        },
        `${type} action expired, action has been discarded`
      )
      metrics.increment(`actions.process.expired.${type}`)
      return
    }

    logger.debug({ action: sanitizedAction }, 'Valid action received')

    const result = await processAction(action, channel)
    logger.debug({ result }, 'Action process result')

    const { type, userId } = action
    const routingKey = `actions.throttle.${type}.${userId}`

    if (result && result.retry) {
      // create retry action request and acknowledge old request
      const options = {
        priority
      }
      const retryAction = {
        ...action,
        retryRemaining: R.toString(--result.retryRemaining)
      }

      channel.publish(exchangeName, routingKey, buffer(retryAction), options)

      logger.debug(
        {
          result,
          action: sanitizedAction
        },
        `${type} action retry requested`
      )
      metrics.increment(`actions.retry.${type}`)
      return
    }

    if (result && result.delay) {
      // create delayed action request and acknowledge old request
      const options = {
        headers: {
          'x-delay': result.delay
        },
        priority
      }
      channel.publish(exchangeName, routingKey, buffer(action), options)
      logger.debug(
        {
          result,
          action: sanitizedAction
        },
        `${type} action delay requested`
      )
      metrics.increment(`actions.rate_limit.${type}`)
      return
    }

    if (result && result.feedbackFailed) {
      // create dm action request for rate limited feedback requests and acknowledge old request
      const options = {
        priority
      }

      channel.publish(exchangeName, routingKey, buffer(result.action), options)
      logger.error(
        {
          result,
          action: sanitizedAction
        },
        `Feedback limit reached for ${type} action. Fallback requested...`
      )
      metrics.increment('actions.process.discarded')
      return
    }

    if (result && result.lookupFailed) {
      checkAndHandleFailureActions(action, {
        actionType: type,
        buffer,
        channel,
        exchangeName
      })

      return
    }

    if (result && result.status >= 400) {
      if (result.status === 409) {
        logger.info(
          {
            result,
            action: sanitizedAction
          },
          `Duplicate ${type} action. Discarding...`
        )
        metrics.increment(`actions.process.duplicate.${type}`)
        return
      }

      checkAndHandleFailureActions(action, {
        actionType: type,
        buffer,
        channel,
        exchangeName
      })

      const error = result.body
      throw new Error(error)
    }

    if (result?.success === false) {
      logger.warn(
        {
          result,
          action: sanitizedAction
        },
        `${type} action failed. Checking for inner failure actions...`
      )
      checkAndHandleFailureActions(action, {
        actionType: type,
        buffer,
        channel,
        exchangeName
      })
      metrics.increment(`actions.process.${type}.failed`)
      return
    }

    if (result?.isHandled) {
      logger.debug(
        {
          result,
          action: sanitizedAction
        },
        `${type} action handled without processing`
      )
      metrics.increment(`actions.process.${type}.handled`)
      return
    }

    logger.debug(
      {
        result,
        action: sanitizedAction,
        widgetId: action.widgetId
      },
      `${type} action processed`
    )

    /* istanbul ignore next */
    if (action.success && action.success.length > 0) {
      action.success.forEach(successAction => {
        channel.publish(
          exchangeName,
          `actions.throttle.${successAction.type}.${userId}`,
          buffer(successAction),
          { priority: 1 }
        )
      })
    }

    metrics.increment(`actions.process.${type}`)
  } catch (error) {
    const type = action && action.type ? action.type : 'UNKNOWN'
    requeueIfValid({
      action,
      type,
      error,
      channel,
      message,
      exchangeName,
      buffer
    })
  } finally {
    channel.ack(message)
  }
}

module.exports = { parseMessage, handleMessage }
