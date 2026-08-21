export default {
  id: 'usa-mobile-checkout-drop',
  name: 'USA Mobile Checkout Drop',
  question: 'Did orders from mobile users in the USA change recently compared to earlier?',

  groundTruth: {
    description: 'Seed narrative: a failed A/B test on mobile checkout caused USA consumer mobile orders to decline in recent days. Observable fact: lower completed-order volume for USA mobile customers in the last ~9 days versus prior windows.',
    affectedCountry: 'USA',
    affectedDevice: 'mobile',
    segment: 'consumer',
    rootCause: 'Failed A/B test on mobile checkout',
  },

  acceptableFindings: [
    ['usa', 'united states'],
    ['mobile'],
    ['drop', 'dropped', 'decline', 'declined', 'decrease', 'decreased', 'fewer', 'lower', 'down'],
  ],

  requiredKeywords: [
    'mobile',
  ],

  minSqlQueries: 1,
  minSteps: 2,
};
