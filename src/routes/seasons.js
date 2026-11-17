const router = require('./seasons/router');
require('./seasons/info');
require('./seasons/registrations');
require('./seasons/draw');
require('./seasons/schedule');
require('./seasons/registrationsAdmin');
require('./seasons/results');
require('./seasons/manage');
require('./seasons/groups');
const { BLTA_CATEGORIES, matchCategoryOf, serializeSeason, readNewSeason, insertSeason, sanitizeHtml } = require('./seasons/shared');

module.exports = router;
module.exports.BLTA_CATEGORIES = BLTA_CATEGORIES;
module.exports.matchCategoryOf = matchCategoryOf;
module.exports.serializeSeason = serializeSeason;
module.exports.readNewSeason = readNewSeason;
module.exports.insertSeason = insertSeason;
module.exports.sanitizeHtml = sanitizeHtml;
