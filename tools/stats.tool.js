import { z } from 'zod';
import {
  getDailyOrderStats,
  getPaymentFailureRate,
  getOrdersBySegment,
  getOrdersByCountry,
  getOrdersByDevice,
  getProductSalesBreakdown,
  getPaymentMethodFailures,
  getTableRowCounts,
} from '../database/queries.js';

const availableStats = {
  daily_orders: { fn: getDailyOrderStats, description: 'Daily order count, revenue, and unique customers over time' },
  payment_failures: { fn: getPaymentFailureRate, description: 'Daily payment failure rates' },
  orders_by_segment: { fn: getOrdersBySegment, description: 'Orders broken down by customer segment (enterprise/smb/consumer) over time' },
  orders_by_country: { fn: getOrdersByCountry, description: 'Orders broken down by customer country over time' },
  orders_by_device: { fn: getOrdersByDevice, description: 'Orders broken down by device preference (mobile/desktop/tablet) over time' },
  product_sales: { fn: getProductSalesBreakdown, description: 'Sales breakdown by product over time' },
  payment_methods: { fn: getPaymentMethodFailures, description: 'Payment method failure rates over time' },
  row_counts: { fn: getTableRowCounts, description: 'Current row counts for all tables' },
};

export const statsTool = {
  name: 'get_stats',
  description: `Retrieves pre-built statistical summaries from the database. Available stats: ${Object.keys(availableStats).join(', ')}. Use this for quick overviews before running custom SQL.`,
  parameters: {
    type: 'object',
    properties: {
      stat: {
        type: 'string',
        description: `Which statistic to retrieve. Options: ${Object.keys(availableStats).join(', ')}`,
        enum: Object.keys(availableStats),
      },
      days: {
        type: 'number',
        description: 'Number of days to look back (default: 30)',
      },
    },
    required: ['stat'],
  },

  async execute({ stat, days = 30 }) {
    const entry = availableStats[stat];
    if (!entry) {
      return { success: false, error: `Unknown stat: ${stat}. Available: ${Object.keys(availableStats).join(', ')}` };
    }

    try {
      const start = Date.now();
      const data = await entry.fn(days);
      const duration = Date.now() - start;
      return {
        success: true,
        stat,
        description: entry.description,
        data,
        rowCount: data.length,
        duration,
      };
    } catch (err) {
      return { success: false, error: err.message, stat };
    }
  },
};
