export default {
  id: 'enterprise-bulk-cancellation',
  name: 'Enterprise Bulk Cancellation',
  question: 'Were there any unusual cancellation patterns recently?',

  groundTruth: {
    description: 'Customer 16 (Priya Sharma, India, enterprise) placed 3 Enterprise License orders 5 days ago at $4,999.99 each, all with status cancelled. Their payments were updated to status refunded with amount $0.00.',
    affectedCustomer: 'Priya Sharma',
    affectedSegment: 'enterprise',
    affectedCountry: 'India',
    cancelledOrders: 3,
    product: 'Enterprise License',
    totalValue: 14999.97,
    rootCause: 'Enterprise customer bulk cancellation (3 orders, same customer)',
  },

  acceptableFindings: [
    ['enterprise', 'priya', 'sharma'],
    ['cancelled', 'cancellation', 'refund'],
    ['bulk', '3 orders', 'three orders', 'simultaneous'],
  ],

  requiredKeywords: [
    'enterprise',
    'cancel',
  ],

  minSqlQueries: 1,
  minSteps: 2,
};
