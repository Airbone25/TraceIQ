export default {
  id: 'mobile-payment-failures',
  name: 'Mobile Payment Failures',
  question: 'Why are we seeing a spike in payment failures recently? Are certain user groups affected more than others?',

  groundTruth: {
    description: 'Mobile users (customers 2,3,7,9,10,12,14,17,20) have a 40% payment failure rate in the last 10 days. The failure reason is CARD_DECLINED_MOBILE_BUG, indicating a checkout bug on mobile.',
    affectedDevice: 'mobile',
    failureReason: 'CARD_DECLINED_MOBILE_BUG',
    failureRate: '~40% for mobile users in last 10 days',
    rootCause: 'Mobile checkout bug',
  },

  acceptableFindings: [
    ['mobile', 'device'],
    ['payment', 'failure', 'failed'],
    ['card_declined', 'mobile_bug', 'checkout'],
  ],

  requiredKeywords: [
    'mobile',
    'payment',
    'failure',
  ],

  minSqlQueries: 1,
  minSteps: 2,
};
