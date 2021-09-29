import fs from 'fs'

import env from 'envvar'
import ms from 'ms'
import Elasticsearch from '@elastic/elasticsearch'
import { event } from '@pagerduty/pdjs'

const NODE_ENV = env.string('NODE_ENV')
const ROUTER_ID = env.string('ROUTER_ID', 'pagerduty')
const POLL_INTERVAL = env.string('POLL_INTERVAL', '1m')

const ELASTICSEARCH_URL = env.string('ELASTICSEARCH_URL')
const ELASTICSEARCH_USERNAME = env.string('ELASTICSEARCH_USERNAME')
const ELASTICSEARCH_PASSWORD = env.string('ELASTICSEARCH_PASSWORD')
const ELASTICSEARCH_CA_FILE = env.string('ELASTICSEARCH_CA_FILE')
const ELASTICSEARCH_ALERT_INDEX = env.string('ELASTICSEARCH_ALERT_INDEX')

const PAGERDUTY_ROUTING_KEY = env.string('PAGERDUTY_ROUTING_KEY')

const es = new Elasticsearch.Client({
  log: 'trace',
  apiVersion: '7.x',
  node: ELASTICSEARCH_URL,
  auth: {
    username: ELASTICSEARCH_USERNAME,
    password: ELASTICSEARCH_PASSWORD
  },
  ssl: {
    ca: fs.readFileSync(ELASTICSEARCH_CA_FILE),
    rejectUnauthorized: true
  }
});

const run = async () => {
  const unroutedAlerts = await es.search({
    index: ELASTICSEARCH_ALERT_INDEX,
    type: '_doc',
    size: 10000,
    body: {
      query: { bool: { must_not: { exists: { field: `routed.by.${ROUTER_ID}` } } } },
      sort: [{ "@timestamp" : "asc" }]
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

    console.log('Action Received', action)

    const sendTrigger = (key) => event({
      data: {
        event_action: 'trigger',
        routing_key: key,
        dedup_key: `${ruleId}:${alertId}`,
        payload: {
          timestamp,
          summary: `[${NODE_ENV}] ${name} (${alertId})`,
          source: 'elasticsearch',
          severity: 'error',
          custom_details: { ...hit._source.context }
        }
      }
    })

    const sendResolve = (key) => event({
      data: {
        event_action: 'resolve',
        routing_key: key,
        dedup_key: `${ruleId}:${alertId}`,
        payload: {
          timestamp,
          summary: `[${NODE_ENV}] ${name}`,
          source: 'elasticsearch',
          severity: 'error'
        }
      }
    })

    if (action === 'logs.threshold.fired' || action === 'metrics.inventory_threshold.fired' || action === 'metrics.threshold.fired') {
      const triggers = await Promise.all([
        sendTrigger(PAGERDUTY_ROUTING_KEY),
        ...tags.filter((t) => t.startsWith('pagerduty:')).map((t) => t.replace('pagerduty:', '')).map(sendTrigger)
      ])

      if (triggers.find((res) => res.status >= 400)) {
        console.error(triggers)
        return
      }
    } else if (action === 'recovered') {
      const resolves = await Promise.all([
        sendResolve(PAGERDUTY_ROUTING_KEY),
        ...tags.filter((t) => t.startsWith('pagerduty:')).map((t) => t.replace('pagerduty:', '')).map(sendResolve)
      ])

      if (resolves.find((res) => res.status >= 400)) {
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
