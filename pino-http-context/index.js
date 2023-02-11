const express = require("express");
const httpContext = require("express-http-context");
const cuid = require("cuid");

const logger = require("./log");

const app = express();

app.use(httpContext.middleware);
app.use((req, res, next) => {
  httpContext.set("req_id", cuid());
  httpContext.set("wid", process.pid);

  next();
}); // Set Request id

app.disable("x-powered-by");

app.get('/', (req, res) => {
  logger.info('request for hello');
  res.send('Hello World!')
})

app.listen(3000, () => {
  logger.info('expressjs server listening on port 3000');
  logger.info('click on url http://localhost:3000');
})
