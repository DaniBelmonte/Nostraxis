const evaluators = {
  manual: {
    id: 'manual', name: 'Manual score', automatic: false,
    evaluate: () => null,
  },
  'contains-keywords': {
    id: 'contains-keywords', name: 'Contains keywords', automatic: true,
    evaluate(output, config = {}) {
      const keywords = Array.isArray(config.keywords) ? config.keywords.map(String) : [];
      if (!keywords.length) return null;
      const found = keywords.filter((keyword) => output.toLowerCase().includes(keyword.toLowerCase()));
      return { evaluatorId: 'contains-keywords', score: found.length / keywords.length, details: { keywords, found }, source: 'automatic' };
    },
  },
};

export const evaluatorCatalog = () => Object.values(evaluators).map(({ evaluate, ...item }) => item);
export const evaluatorFor = (id) => evaluators[id] || evaluators.manual;
