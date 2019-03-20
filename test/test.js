module.exports = async function({ nc }) {
  nc.publish('greeting', '');
  return {
    body: 'Hello, world!\n'
  };
};
