# Node.js Task Queuing with Rate Limiting

## Project Overview

This project is a Node.js API designed to handle tasks submitted by users while enforcing rate limiting and queuing. Each user is restricted to processing:

   - 1 task per second
   - 20 tasks per minute

If the rate limit is exceeded, tasks are automatically queued and processed later. The application uses Redis to manage the queuing system and handle rate limiting. The project also employs Node.js clustering to distribute the load across multiple worker processes.

## Getting Started

1. Clone the repo
```
git clone https://github.com/your-username/node-task-queuing-with-rate-limiting.git
cd node-task-queuing-with-rate-limiting
```
2. ```npm install```
3. Setup Redis(using docker)
```docker pull redis```
```docker run --name my-redis -p 6379:6379 -d redis```
4. Running the Application
```node app.js


## Testing

Use curl
```curl -X POST http://localhost:3000/task -H "Content-Type: application/json" -d '{"user_id": "123"}'```


Tasks are logged in the ```tasks.log``` file, located in the root directory of the project. Each log entry contains the user ID and the timestamp when the task was processed.