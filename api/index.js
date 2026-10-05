const { handleRequest } = require('../server.js');

module.exports = (req, res) => {
  return handleRequest(req, res);
};
