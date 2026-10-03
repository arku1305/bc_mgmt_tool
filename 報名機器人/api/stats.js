// The old public page exposed contact details. Statistics now require organizer login.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: 'https://arku1305.github.io/bc_mgmt_tool/ranking/?view=registration' });
  res.end();
};
