const { connect } = require('ts-nats');

async function start() {
  try {
    const nc = await connect({
      name: 'fissionMQTrigger',
      url: 'nats://defaultFissionAuthToken@192.168.99.107:4222'
    });
    const subject = 'greeting';
    nc.publish(subject, '');
    console.log(`Published to [${subject}]`);
    process.exit(0);
  } catch (error) {
    console.error('Failed to start...', error);
    process.exit(-1);
  }
}

start();
