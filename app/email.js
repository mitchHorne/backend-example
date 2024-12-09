const { email: config } = require('./config')

const { from: fromEmailAddress, sendgridAPI } = config

const { logger } = require('@bluerobot/monitoring')
const sendgrid = require('sendgrid')(sendgridAPI)

/**
 * Converts a comma delimited string of emails to an array of email addresses.
 *
 * @param {string} recipientList The comma delimited string of emails
 * @returns {string[]} Array of email addresses
 */
const buildEmails = (
  // istanbul ignore next
  recipientList = ''
) =>
  recipientList.split(',').map(recipient => ({
    email: recipient
  }))

/**
 * Formats a list of provided media URLs underneath a 'media' heading
 *
 * @param {string[]} media - Array of media URLs
 * @returns {string} Formatted text with list of media URLs
 */
const buildMediaValue = (
  // istanbul ignore next
  media = []
) => `media:\n\n${media.join('\n')}`

/**
 * @typedef SendGridContentEntry
 * @property {string} type Content type
 * @property {string} value Content value
 */

/**
 * Builds the content array in the format required by SendGrid's API.
 *
 * @param {string} text Content text to which to append the media URLs
 * @param {string[]} media The array of media URLs to append to the content
 * @returns {SendGridContentEntry[]} SendGrid content entries.
 */
const buildContent = (
  // istanbul ignore next
  text = '',
  media = []
) => [
  {
    type: 'text/plain',
    value: media.length ? `${text}\n\n`.concat(buildMediaValue(media)) : text
  }
]

/**
 * @typedef EmailOptions
 * @property {string} text Body of the email
 * @property {string[]} attachments List of media URLs
 * @property {string} subject Subject of the email
 * @property {string} to Comma delimited list of recipients to put in the to field
 * @property {string} cc Comma delimited list of recipients to put in the cc field
 * @property {string} bcc Comma delimited list of recipients to put in the bcc field
 */

const email = {
  /**
   * Constructs the request and calls the SendGrid API to send an email.
   *
   * @param {EmailOptions} options Email options
   * @param {object} [sg] SendGrid API to use (used for testing)
   * @param {string} [from] Email address to populate in the from field (used for testing)
   * @returns {Promise} Resolves with SendGrid API response
   */
  send (
    options,
    // istanbul ignore next
    sg = sendgrid,
    // istanbul ignore next
    from = fromEmailAddress
  ) {
    const { text, attachments, subject, to, cc, bcc } = options
    const personalizations = [
      {
        subject
      }
    ]

    if (to) personalizations[0].to = buildEmails(to)
    if (cc) personalizations[0].cc = buildEmails(cc)
    if (bcc) personalizations[0].bcc = buildEmails(bcc)

    const content = buildContent(text, attachments)

    const request = sg.emptyRequest({
      method: 'POST',
      path: '/v3/mail/send',
      body: {
        personalizations,
        from: {
          email: from
        },
        content
      }
    })

    return sg.API(request).catch(error => {
      logger.error(error, `SendGrid error: ${error.message}`)
      throw error
    })
  }
}

module.exports = email
