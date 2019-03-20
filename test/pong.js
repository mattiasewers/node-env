module.exports = async function() {
  console.log('Got new message!');
  return {
    body: 'PONG!\n'
  };
};
