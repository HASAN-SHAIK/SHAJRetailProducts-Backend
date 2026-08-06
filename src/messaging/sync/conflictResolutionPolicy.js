/**
 * Conflict resolution policies for offline → SQL synchronization.
 */

const RESOLUTION_OUTCOME = Object.freeze({
  APPLY: 'apply',
  SKIP_DUPLICATE: 'skip_duplicate',
  SERVER_WINS: 'server_wins',
  CLIENT_WINS: 'client_wins',
  CONFLICT: 'conflict',
  SKIP_DELETED: 'skip_deleted',
});

const MERGE_STRATEGY = Object.freeze({
  LAST_MODIFIED_WINS: 'last_modified_wins',
  VERSION_WINS: 'version_wins',
  SERVER_WINS: 'server_wins',
});

const CONFLICT_REASON = Object.freeze({
  LAST_MODIFIED: 'last_modified',
  VERSION: 'version',
  DELETED_ON_SERVER: 'deleted_on_server',
  DUPLICATE_SALE: 'duplicate_sale',
  INVENTORY_PROTECTION: 'inventory_protection',
  ALREADY_ABSENT: 'already_absent',
  CONCURRENT_MERGE: 'concurrent_merge',
});

const DEFAULT_ENTITY_RULE = Object.freeze({
  CREATE: {
    strategy: MERGE_STRATEGY.LAST_MODIFIED_WINS,
    inventoryProtection: false,
    preventDuplicateSales: false,
  },
  UPDATE: {
    strategy: MERGE_STRATEGY.LAST_MODIFIED_WINS,
    mergeFields: [],
    inventoryProtection: false,
  },
  DELETE: {
    strategy: MERGE_STRATEGY.SERVER_WINS,
    respectTombstone: true,
    inventoryProtection: false,
  },
});

const MODULE_ENTITY_RULES = Object.freeze({
  sales: {
    order: {
      CREATE: {
        strategy: MERGE_STRATEGY.LAST_MODIFIED_WINS,
        preventDuplicateSales: true,
        inventoryProtection: true,
      },
      UPDATE: {
        strategy: MERGE_STRATEGY.LAST_MODIFIED_WINS,
        mergeFields: ['payment_mode', 'payments', 'order_status', 'total_paid'],
        inventoryProtection: true,
      },
      DELETE: {
        strategy: MERGE_STRATEGY.SERVER_WINS,
        respectTombstone: true,
      },
    },
  },
  inventory: {
    product: {
      UPDATE: {
        strategy: MERGE_STRATEGY.LAST_MODIFIED_WINS,
        inventoryProtection: true,
      },
      DELETE: {
        strategy: MERGE_STRATEGY.SERVER_WINS,
        respectTombstone: true,
      },
    },
    stock_adjustment: {
      CREATE: {
        strategy: MERGE_STRATEGY.VERSION_WINS,
        inventoryProtection: true,
      },
      UPDATE: {
        strategy: MERGE_STRATEGY.VERSION_WINS,
        inventoryProtection: true,
      },
    },
  },
  products: {
    product: {
      UPDATE: {
        strategy: MERGE_STRATEGY.LAST_MODIFIED_WINS,
        inventoryProtection: true,
      },
      DELETE: {
        strategy: MERGE_STRATEGY.SERVER_WINS,
        respectTombstone: true,
      },
    },
  },
  purchases: {
    purchase: {
      CREATE: {
        strategy: MERGE_STRATEGY.LAST_MODIFIED_WINS,
        preventDuplicateSales: true,
      },
    },
  },
});

const getEntityRule = (module, entityType, action) => {
  const normalizedAction = String(action || 'UPDATE').toUpperCase();
  const moduleRules = MODULE_ENTITY_RULES[module] || {};
  const entityRules = moduleRules[entityType] || {};
  return {
    ...DEFAULT_ENTITY_RULE[normalizedAction] || DEFAULT_ENTITY_RULE.UPDATE,
    ...(entityRules[normalizedAction] || {}),
    action: normalizedAction,
  };
};

const TIMESTAMP_TOLERANCE_MS = 1000;

module.exports = {
  RESOLUTION_OUTCOME,
  MERGE_STRATEGY,
  CONFLICT_REASON,
  DEFAULT_ENTITY_RULE,
  MODULE_ENTITY_RULES,
  getEntityRule,
  TIMESTAMP_TOLERANCE_MS,
};
