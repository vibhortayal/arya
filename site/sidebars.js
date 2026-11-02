const sections = require('./generated/sections.json');
module.exports = {
  docs: Object.entries(sections).map(([label, ids]) => ({
    type: 'category', label, collapsed: label !== 'Start here', items: ids,
  })),
};
