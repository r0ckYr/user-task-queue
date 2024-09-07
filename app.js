const express = require("express");
const cluster = require("cluster");
const redis = require("redis");
const { promisify } = require("util");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redisClient;

function setupRedis() {
  redisClient = redis.createClient(REDIS_URL);

  redisClient.on("error", (err) => {
    console.error("Redis Client Error", err);
  });

  redisClient.on("connect", () => {
    console.log("Connected to Redis");
  });
}

setupRedis();

const redisIncrAsync = promisify(redisClient.incr).bind(redisClient);
const redisExpireAsync = promisify(redisClient.expire).bind(redisClient);
const redisGetAsync = promisify(redisClient.get).bind(redisClient);
const redisKeysAsync = promisify(redisClient.keys).bind(redisClient);
const redisLpopAsync = promisify(redisClient.lpop).bind(redisClient);
const redisRpushAsync = promisify(redisClient.rpush).bind(redisClient);
const redisSetAsync = promisify(redisClient.set).bind(redisClient);

app.use(express.json());

async function task(user_id) {
  const logMessage = `${user_id}-task completed at-${Date.now()}\n`;
  await fs.appendFile(path.join(__dirname, "tasks.log"), logMessage);
  console.log(logMessage);
}

async function checkRateLimit(user_id) {
  const secondKey = `rate_limit:${user_id}:second`;
  const minuteKey = `rate_limit:${user_id}:minute`;

  try {
    const [secondCount, minuteCount] = await Promise.all([
      redisIncrAsync(secondKey),
      redisIncrAsync(minuteKey),
    ]);

    if (secondCount === 1) await redisExpireAsync(secondKey, 1); // expire in 1 second
    if (minuteCount === 1) await redisExpireAsync(minuteKey, 60); // expire in 60 seconds

    return secondCount <= 1 && minuteCount <= 20;
  } catch (error) {
    console.error("Error checking rate limit:", error);
    return false;
  }
}

app.post("/task", async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: "User ID is required" });
  }

  try {
    const canProcess = await checkRateLimit(user_id);

    if (canProcess) {
      await task(user_id);
      res.json({ message: "Task processed successfully" });
    } else {
      // Queue the task
      await redisRpushAsync(
        `task_queue:${user_id}`,
        JSON.stringify({ user_id }),
      );
      res.json({ message: "Task queued for later processing" });
    }
  } catch (error) {
    console.error("Error processing task:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function processQueuedTasks() {
  try {
    const users = await redisKeysAsync("task_queue:*");
    if (!Array.isArray(users) || users.length === 0) {
      return;
    }

    for (const userQueue of users) {
      const user_id = userQueue.split(":")[1];

      // Use a Redis lock to ensure only one worker processes the tasks for this user
      const lockKey = `lock:${user_id}`;
      const lockAcquired = await redisSetAsync(
        lockKey,
        "locked",
        "NX",
        "EX",
        1,
      ); // Lock for 1 second

      if (lockAcquired === "OK") {
        const canProcess = await checkRateLimit(user_id);
        if (canProcess) {
          const queuedTask = await redisLpopAsync(userQueue);
          if (queuedTask) {
            const { user_id } = JSON.parse(queuedTask);
            await task(user_id);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error processing queued tasks:", error);
  }
}

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  // Fork workers
  for (let i = 0; i < 2; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.log(
      `Worker ${worker.process.pid} died with code: ${code}, and signal: ${signal}`,
    );
    console.log("Starting a new worker");
    cluster.fork();
  });

  cluster.on("error", (error) => {
    console.error("Cluster error:", error);
  });
} else {
  process.on("uncaughtException", (error) => {
    console.error(`Uncaught Exception in worker ${process.pid}:`, error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error(`Unhandled Rejection in worker ${process.pid}:`, reason);
  });

  app.listen(PORT, () => {
    console.log(`Worker ${process.pid} started and listening on port ${PORT}`);
  });

  setInterval(processQueuedTasks, 1000);
}

process.on("SIGINT", () => {
  console.log("Received SIGINT. Closing gracefully.");
  redisClient.quit(() => {
    console.log("Redis client closed.");
    process.exit(0);
  });
});
