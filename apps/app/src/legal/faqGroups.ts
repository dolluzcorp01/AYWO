// The FAQ's groups and built-in questions, in the order shown. The words are in the locale files
// (legal.faq.<group>.<question>Q / A). Staff can hide any of these and add their own in Admin > App settings.
export const FAQ_GROUPS: { id: string; questions: string[] }[] = [
  { id: 'start', questions: ['what', 'free', 'signIn', 'devices', 'language', 'importing'] },
  { id: 'tree', questions: ['whoSees', 'roles', 'noAccount', 'wrong', 'outsider', 'download'] },
  { id: 'safety', questions: ['number', 'remove', 'sos', 'sell', 'children'] },
  { id: 'plus', questions: ['includes', 'price', 'trial', 'family', 'pay', 'cancel', 'refund', 'failed'] },
  { id: 'orders', questions: ['what', 'delivery', 'damaged'] },
  { id: 'account', questions: ['delete', 'help'] },
];
