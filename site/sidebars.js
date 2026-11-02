const sections = require('./generated/sections.json');
module.exports = {
  docs: Object.entries(sections).map(([label, ids]) => ({
    type: 'category', label, collapsed: !['Start here'].includes(label), items: ids,
  })),
};
