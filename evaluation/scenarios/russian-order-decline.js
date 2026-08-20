export default {
  id: 'russian-order-decline',
  name: 'Russian Order Decline',
  question: 'Why did orders from Russia stop recently?',

  groundTruth: {
    description: 'Customers 9 (Ivan Petrov, Russia) and 14 (Nadia Kozlov, Russia) placed orders normally up to day 22. After day 22, no more orders from Russian customers appear. This simulates a payment gateway blocking Russian transactions.',
    affectedCustomers: ['Ivan Petrov', 'Nadia Kozlov'],
    affectedCountry: 'Russia',
    cutoffDay: 22,
    rootCause: 'Payment gateway block on Russian transactions',
  },

  acceptableFindings: [
    ['russia', 'russian', 'ivan', 'nadia', 'petrov', 'kozlov'],
    ['stopped', 'ceased', 'dropped', 'decline', 'no orders', 'absent'],
    ['payment', 'gateway', 'blocked', 'transaction'],
  ],

  requiredKeywords: [
    'russia',
  ],

  minSqlQueries: 1,
  minSteps: 2,
};
