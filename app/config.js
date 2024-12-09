const { logger } = require('@bluerobot/monitoring')

/**
 * This file just loads the app's config from the environment variables specified in the spec
 */

const config = {
  amqp: {
    url: process.env.AMQP_URL,
    heartbeat: Number(process.env.AMQP_HEARTBEAT || 2), // in seconds
    delay: {
      intial: Number(process.env.AMQP_RECONNECT_BACKOFF_TIME || 1000),
      limit: Number(process.env.AMQP_RECONNECT_BACKOFF_LIMIT || 30000)
    },
    prefetch: Number(process.env.AMQP_PREFETCH)
  },
  twitter: {
    key: process.env.TWITTER_CONSUMER_KEY,
    secret: process.env.TWITTER_CONSUMER_SECRET
  },
  email: {
    from: process.env.SENDGRID_EMAIL_FROM,
    sendgridAPI: process.env.SENDGRID_API_KEY
  },
  mysql: {
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  }
}

logger.debug('Configuration loaded')

module.exports = config
