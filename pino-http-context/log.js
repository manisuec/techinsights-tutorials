const logger = require("pino");
const path = require("path");
const dateFns = require("date-fns");
const httpContext = require("express-http-context");

const logFilePath = path.resolve(__dirname, ".");

const defaultOpts = {
  singleLine  : true,
  mkdir       : true,
  hideObject  : false,
  base        : undefined,
  prettyPrint : true,
  ignore      : 'hostname'
};

const targets = [
  {
    level   : "info",
    target  : "pino/file",
    options : {
      ...defaultOpts,
      destination : path.resolve(logFilePath, "info.log"),
    },
  },
  {
    level   : "debug",
    target  : "pino/file",
    options : {
      ...defaultOpts,
      destination : path.resolve(logFilePath, "debug.log"),
    },
  },
  {
    level   : "error",
    target  : "pino/file",
    options : {
      ...defaultOpts,
      destination : path.resolve(logFilePath, "error.log"),
    },
  },
];

if (process.env.ENABLE_CONSOLE_LOG !== "true") {
  targets.push({
    target  : "pino-pretty",
    options : {
      colorize     : true,
      timestampKey : "time",
      singleLine   : true,
      hideObject   : false,
      ignore       : "hostname",
      base         : undefined,
    },
  });
}

const transport = logger.transport({
  targets,
});

module.exports = logger(
  {
    level     : process.env.PINO_LOG_LEVEL || "info",
    timestamp : () =>
      `,"time":"${dateFns.format(Date.now(), "dd-MMM-yyyy HH:mm:ss sss")}"`,
    mixin() {
      if (httpContext.get("req_id")) {
        return { req_id: httpContext.get("req_id") };
      } else {
        return {};
      }
    },
  },
  transport
);
