import { event } from '@pagerduty/pdjs'

export default class PagerDuty {
  constructor (key, { env }) {
    this.key = key
    this.env = env
  }

  trigger ({ ruleId, alertId, name, tags, action, timestamp, context }) {
    return event({
      data: {
        event_action: 'trigger',
        routing_key: this.key,
        dedup_key: `${ruleId}:${alertId}`,
        payload: {
          timestamp,
          summary: `[${this.env}] ${name} (${alertId})`,
          source: 'elasticsearch',
          severity: 'error',
          custom_details: { ...context }
        }
      }
    }).then((res) => {
      if (res.status >= 400) throw new Error(`Unexpected status code ${res.status} - ${res}`)
      else return res
    })
  }

  resolve ({ ruleId, alertId, name, tags, action, timestamp, context }) {
    return event({
      data: {
        event_action: 'resolve',
        routing_key: this.key,
        dedup_key: `${ruleId}:${alertId}`,
        payload: {
          timestamp,
          summary: `[${this.env}] ${name} (${alertId})`,
          source: 'elasticsearch',
          severity: 'error'
        }
      }
    }).then((res) => {
      if (res.status >= 400) throw new Error(`Unexpected status code ${res.status} - ${res}`)
      else return res
    })
  }
}
