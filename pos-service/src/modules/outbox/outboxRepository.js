const { randomUUID } = require('node:crypto');
const { getDatabase } = require('../../db/database');

function enqueue({ aggregateType, aggregateId, eventType, orderingKey, payload, metadata = {} }) {
  const now = new Date().toISOString();
  const event = {
    id: randomUUID(), aggregateType, aggregateId, eventType, orderingKey,
    payloadJson: JSON.stringify(payload), metadataJson: JSON.stringify(metadata), now
  };
  getDatabase().prepare(`
    INSERT INTO outbox_events (
      id, aggregate_type, aggregate_id, event_type, ordering_key,
      payload_json, metadata_json, available_at, created_at, updated_at
    ) VALUES (
      @id, @aggregateType, @aggregateId, @eventType, @orderingKey,
      @payloadJson, @metadataJson, @now, @now, @now
    )
  `).run(event);
  return { id: event.id, status: 'pending' };
}

function getSummary() {
  return getDatabase().prepare(`
    SELECT status, COUNT(*) AS count
    FROM outbox_events GROUP BY status ORDER BY status
  `).all();
}

module.exports = { enqueue, getSummary };
