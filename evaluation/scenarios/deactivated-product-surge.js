export default {
  id: 'deactivated-product-surge',
  name: 'Deactivated Product',
  question: 'Are there any products we stopped selling recently? What happened to their sales?',

  groundTruth: {
    description: 'Product 9 (Legacy Adapter, hardware) has active = 0. Seed comments describe a deactivation ~15 days ago with a surge of returns; only the inactive flag is directly queryable.',
    product: 'Legacy Adapter',
    productId: 9,
    category: 'hardware',
    rootCause: 'Product deactivated while still referenced in sales history',
  },

  acceptableFindings: [
    ['legacy', 'adapter', 'product 9'],
    ['inactive', 'deactivated', 'not active', 'discontinued', 'no longer active'],
    ['sales', 'orders', 'revenue', 'sold'],
  ],

  requiredKeywords: [
    'legacy|adapter',
  ],

  minSqlQueries: 1,
  minSteps: 2,
};
