const Redis = require('ioredis');

let publisher = null;
let subscriber = null;

function createRedisClient() {
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    }
  });
}

function getPublisher() {
  if (!publisher) {
    publisher = createRedisClient();
    console.log('Redis publisher connected');
  }
  return publisher;
}

function getSubscriber() {
  if (!subscriber) {
    subscriber = createRedisClient();
    console.log('Redis subscriber connected');
  }
  return subscriber;
}

module.exports = { getPublisher, getSubscriber };
