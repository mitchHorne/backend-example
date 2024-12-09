const chai = require('chai')
const simple = require('simple-mock')
const email = require('../app/email')
const { logger } = require('@bluerobot/monitoring')

const assert = chai.assert

describe('Email', () => {
  describe('send', () => {
    const method = 'POST'
    const path = '/v3/mail/send'
    const fromEmailAddress = 'themonster@lockness.com'
    const from = {
      email: fromEmailAddress
    }

    const subject = "How'd you like dem apples?"
    const text = 'My my, would you look at that!'
    const attachments = ['catpicone.jpg', 'catpictwo.jpg']

    const to = '1@to.com,2@to.com,3@to.com'
    const cc = '1@cc.com,2@cc.com,3@cc.com'
    const bcc = '1@bcc.com,2@bcc.com,3@bcc.com'

    const personalizations = [
      {
        subject,
        to: [
          {
            email: '1@to.com'
          },
          {
            email: '2@to.com'
          },
          {
            email: '3@to.com'
          }
        ],
        cc: [
          {
            email: '1@cc.com'
          },
          {
            email: '2@cc.com'
          },
          {
            email: '3@cc.com'
          }
        ],
        bcc: [
          {
            email: '1@bcc.com'
          },
          {
            email: '2@bcc.com'
          },
          {
            email: '3@bcc.com'
          }
        ]
      }
    ]

    let sendgrid

    beforeEach(() => {
      sendgrid = {
        emptyRequest: simple.mock(() => { })
      }

      simple.mock(logger, 'debug')
      simple.mock(logger, 'info')
      simple.mock(logger, 'warn')
      simple.mock(logger, 'error')
    })

    afterEach(() => {
      simple.restore()
    })

    it('should call sendgrid.emptyRequest', () => {
      sendgrid.API = simple.mock(() => Promise.resolve('success!'))

      return email
        .send(
          {
            text,
            attachments,
            subject,
            to,
            cc,
            bcc
          },
          sendgrid,
          fromEmailAddress
        )
        .then(() => {
          assert(sendgrid.emptyRequest.called)
          assert.deepEqual(sendgrid.emptyRequest.lastCall.args[0], {
            method,
            path,
            body: {
              personalizations,
              from,
              content: [
                {
                  type: 'text/plain',
                  value:
                    'My my, would you look at that!\n\nmedia:\n\ncatpicone.jpg\ncatpictwo.jpg'
                }
              ]
            }
          })
        })
    })

    it('should call sendgrid.emptyRequest', () => {
      sendgrid.API = simple.mock(() => Promise.resolve('success!'))

      return email
        .send(
          {
            text,
            attachments: [],
            subject,
            to,
            cc,
            bcc
          },
          sendgrid,
          fromEmailAddress
        )
        .then(() => {
          assert(sendgrid.emptyRequest.called)
          assert.deepEqual(sendgrid.emptyRequest.lastCall.args[0], {
            method,
            path,
            body: {
              personalizations,
              from,
              content: [
                {
                  type: 'text/plain',
                  value: 'My my, would you look at that!'
                }
              ]
            }
          })
        })
    })

    it('should resolve on successful call to sendgrid.API', () => {
      const responseMsg = 'Great success!'
      sendgrid.API = simple.mock(() => Promise.resolve(responseMsg))

      return email.send({}, sendgrid, fromEmailAddress).then(response => {
        assert(sendgrid.API.called)
        assert.equal(response, responseMsg)
      })
    })

    it('should reject on error calling sendgrid.API', () => {
      const errorMsg = "You've gone and don' it now!"
      sendgrid.API = simple.mock(() => Promise.reject(errorMsg))

      return email
        .send({}, sendgrid, fromEmailAddress)
        .then(() => {
          assert.fail(
            'Expected an error to occur as a result of a promise rejection.'
          )
        })
        .catch(error => {
          assert(sendgrid.API.called)
          assert.equal(error, errorMsg)
          assert.deepEqual(logger.error.lastCall.args, [
            error,
            `SendGrid error: ${error.message}`
          ])
        })
    })
  })
})
