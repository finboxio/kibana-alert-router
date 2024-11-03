import fs from 'fs'

import env from 'envvar'
import ms from 'ms'
import Elasticsearch from '@elastic/elasticsearch'
import PagerDuty from './plugins/pagerduty.js'
import OpsGenie from './plugins/opsgenie.js'

const NODE_ENV = env.string('NODE_ENV')
const ROUTER_ID = env.string('ROUTER_ID', 'pagerduty')
const POLL_INTERVAL = env.string('POLL_INTERVAL', '1m')

const ELASTICSEARCH_URL = env.string('ELASTICSEARCH_URL')
const ELASTICSEARCH_USERNAME = env.string('ELASTICSEARCH_USERNAME')
const ELASTICSEARCH_PASSWORD = env.string('ELASTICSEARCH_PASSWORD')
const ELASTICSEARCH_CA_FILE = env.string('ELASTICSEARCH_CA_FILE', '')
const ELASTICSEARCH_ALERT_INDEX = env.string('ELASTICSEARCH_ALERT_INDEX')

const PAGERDUTY_ROUTING_KEY = env.string('PAGERDUTY_ROUTING_KEY', '')
const OPSGENIE_API_KEY = env.string('OPSGENIE_API_KEY', '')

const es = new Elasticsearch.Client({
  log: 'trace',
  apiVersion: '7.x',
  node: ELASTICSEARCH_URL,
  auth: {
    username: ELASTICSEARCH_USERNAME,
    password: ELASTICSEARCH_PASSWORD
  },
  ...(ELASTICSEARCH_CA_FILE ? {
    ssl: {
      ca: fs.readFileSync(ELASTICSEARCH_CA_FILE),
      rejectUnauthorized: true
    }
  } : {})
})

const start = Date.now() - ms('24h')

const Plugins = {
  pagerduty: (key) => new PagerDuty(key, { env: NODE_ENV }),
  opsgenie: (key) => new OpsGenie(key, { env: NODE_ENV }),
}

const run = async () => {
  const unroutedAlerts = await es.search({
    index: ELASTICSEARCH_ALERT_INDEX,
    size: 10000,
    body: {
      sort: [{ "@timestamp" : "asc" }],
      query: { 
        bool: { 
          filter: { range: { '@timestamp': { gte: new Date(start).toISOString() } } },
          must_not: { exists: { field: `routed.by.${ROUTER_ID}` } } 
        } 
      }
    }
  })

  console.log(`Got ${unroutedAlerts.body.hits.hits.length} unrouted alerts`)

  for (const hit of unroutedAlerts.body.hits.hits) {
    const ruleId = hit._source.rule.id
    const alertId = hit._source.kibana.alert.id
    const name = hit._source.rule.name
    const tags = hit._source.tags || []
    const action = hit._source.kibana.alert.actionGroup
    const timestamp = hit._source['@timestamp']
    const context = hit._source.context

    const alert = { ruleId, alertId, name, tags, action, timestamp, context }

    console.log('Action Received', action)

    const rtags = [ ...tags ]
    if (PAGERDUTY_ROUTING_KEY) rtags.push(`pagerduty:${PAGERDUTY_ROUTING_KEY}`)
    if (OPSGENIE_API_KEY) rtags.push(`opsgenie:${OPSGENIE_API_KEY}`)

    const responders = rtags
      .map((t) => {
        const [ type, ...key ] = t.split(':')
        if (Plugins[type]) return Plugins[type](...key)
      })
      .filter(Boolean)

    if (action === 'logs.threshold.fired' || action === 'metrics.inventory_threshold.fired' || action === 'metrics.threshold.fired') {
      const triggers = await Promise.all(responders.map((r) => r.trigger(alert).catch((e) => e)))
      if (triggers.find((res) => res instanceof Error)) {
        console.error(triggers)
        return
      }
    } else if (action === 'recovered') {
      const resolves = await Promise.all(responders.map((r) => r.resolve(alert).catch((e) => e)))
      if (resolves.find((res) => res instanceof Error)) {
        console.error(resolves)
        return
      }
    }

    await es.update({
      index: hit._index,
      type: hit._type,
      id: hit._id,
      body: { doc: { [`routed.by.${ROUTER_ID}`]: new Date().toISOString() } }
    })
  }

  if (unroutedAlerts.body.hits.hits.length === 10000) run()
  else setTimeout(run, ms(POLL_INTERVAL))
}

run()
