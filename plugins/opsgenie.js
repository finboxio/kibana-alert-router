import opsgenie from 'opsgenie-sdk'

export default class OpsGenie {
  constructor (key, { env }) {
    this.key = key
    this.env = env
  }

  trigger ({ ruleId, alertId, name, tags, action, timestamp, context }) {
    return new Promise((resolve, reject) => {
      const alias = `${ruleId}:${alertId}`
      const alert = {
        alias,
        message: `[${this.env}] ${name} (${alertId})`,
        details: context,
        tags,
      }
      const opts = { headers: { Authorization: `GenieKey ${this.key}` } }
      opsgenie.alertV2.create(alert, opts, function (error, alert) {
        if (error && !(error instanceof Error)) reject(new Error(JSON.stringify(error)))
        else if (error) reject(error)
        else resolve(alert)
      })
    })
  }

  resolve ({ ruleId, alertId, name, tags, action, timestamp, context }) {
    return new Promise((resolve, reject) => {
      const identifier = { identifier: `${ruleId}:${alertId}`, identifierType: 'alias' }
      const opts = { headers: { Authorization: `GenieKey ${this.key}` } }
      opsgenie.alertV2.close(
        identifier, 
        {},
        opts, 
        function (error, alert) {
          if (error && !(error instanceof Error)) reject(new Error(JSON.stringify(error)))
          else if (error) reject(error)
          else resolve(alert)
        }
      )
    })
  }
}
