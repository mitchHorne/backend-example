const env = process.env.NODE_ENV || 'development'

// istanbul ignore next
if (env !== 'test') {
  require('dotenv-safe').config({
    silent: true
  }) // eslint-disable-line
}

const v8 = require('v8')
const { logger } = require('@bluerobot/monitoring')
const Koa = require('koa')

const app = (module.exports = new Koa())
const port = process.env.PORT || 8080

app.use(async function healthCheck (ctx, next) {
  if (ctx.url === '/' && ctx.method === 'GET') {
    ctx.status = 200
    return
  }
  await next()
})

const Amqp = require('@bluerobot/amqp')
const { handleMessage } = require('./amqp')

const exchangeName = process.env.AMQP_EXCHANGE || 'bluerobot'

const queueName = process.env.AMQP_QUEUE || 'actions.process'
const queueOptions = { durable: true, maxPriority: 10 }

const bindingKey = process.env.AMQP_BINDING_KEY || 'actions.process.*.*'

const amqp = Amqp({
  exchangeName,
  queueName,
  queueOptions,
  bindingKey,
  handleMessage
})

// istanbul ignore next
if (!module.parent) {
  app.listen(port)
  amqp
    .connect()
    .catch(error => logger.error(error, `AMQP connect error: ${error.message}`))

  const totalHeapSize = v8.getHeapStatistics().total_available_size
  const totalHeapSizeInGb = (totalHeapSize / 1024 / 1024 / 1024).toFixed(2)
  logger.info(
    `App is running under env '${env}' and has an available heap size of ${totalHeapSize} bytes(~${totalHeapSizeInGb}GB)`
  )
}
