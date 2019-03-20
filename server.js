'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const { App } = require('uWebSockets.js');
const { connect } = require('ts-nats');
const app = App();
const argv = require('minimist')(process.argv.slice(1)); // Command line opts

if (!argv.port) {
  argv.port = 8888;
}

// User function.  Starts out undefined.
let userFunction;

function loadFunction(modulepath, funcname) {
  // Read and load the code. It's placed there securely by the fission runtime.
  try {
    let startTime = process.hrtime();
    // support v1 codepath and v2 entrypoint like 'foo', '', 'index.hello'
    let userFunction = funcname
      ? require(modulepath)[funcname]
      : require(modulepath);
    let elapsed = process.hrtime(startTime);
    console.log(
      `user code loaded in ${elapsed[0]}sec ${elapsed[1] / 1000000}ms`
    );
    return userFunction;
  } catch (e) {
    console.error(`user code load error: ${e}`);
    return e;
  }
}

function withEnsureGeneric(func) {
  return function(req, res) {
    // Make sure we're a generic container.  (No reuse of containers.
    // Once specialized, the container remains specialized.)
    if (userFunction) {
      res.status(400).send('Not a generic container');
      return;
    }

    func(req, res);
  };
}

function isFunction(func) {
  return func && func.constructor && func.call && func.apply;
}

function specializeV2(res, req) {
  // for V2 entrypoint, 'filename.funcname' => ['filename', 'funcname']
  const entrypoint = req.body.functionName
    ? req.body.functionName.split('.')
    : [];
  // for V2, filepath is dynamic path
  const modulepath = path.join(req.body.filepath, entrypoint[0] || '');
  const result = loadFunction(modulepath, entrypoint[1]);

  if (isFunction(result)) {
    userFunction = result;
    res.writeStatus('202');
    res.send();
  } else {
    res.writeStatus('500');
    res.end(JSON.stringify(result));
  }
}

function specialize(res) {
  // Specialize this server to a given user function.  The user function
  // is read from argv.codepath; it's expected to be placed there by the
  // fission runtime.
  //
  const modulepath = argv.codepath || '/userfunc/user';

  // Node resolves module paths according to a file's location. We load
  // the file from argv.codepath, but tell users to put dependencies in
  // the server's package.json; this means the function's dependencies
  // are in /usr/src/app/node_modules.  We could be smarter and have the
  // function deps in the right place in argv.codepath; b ut for now we
  // just symlink the function's node_modules to the server's
  // node_modules.
  process.env.NODE_ENV !== 'test' &&
    fs.symlinkSync(
      '/usr/src/app/node_modules',
      `${path.dirname(modulepath)}/node_modules`
    );

  const result = loadFunction(modulepath);

  if (isFunction(result)) {
    userFunction = result;
    res.writeStatus('202');
    res.end();
  } else {
    res.writeStatus('500');
    res.end(JSON.stringify(result));
  }
}

app.post('/specialize', withEnsureGeneric(specialize));
app.post('/v2/specialize', withEnsureGeneric(specializeV2));

// Generic route -- all http requests go to the user function.
app.any('/', function(res, req) {
  if (!userFunction) {
    res.writeStatus('500');
    res.end('Generic container: no requests supported');
    return;
  }

  const context = {
    nc: app.nc,
    request: req,
    response: res
    // TODO: context should also have: URL template params, query string
  };

  function callback(
    status = 200,
    body,
    headers = { 'Content-Type': 'application/json' }
  ) {
    if (!status) return;
    if (headers) {
      for (let name of Object.keys(headers)) {
        res.writeHeader(name, headers[name]);
      }
    }
    res.writeStatus(status.toString());
    res.end(body);
  }

  //
  // Customizing the request context
  //
  // If you want to modify the context to add anything to it,
  // you can do that here by adding properties to the context.
  //
  if (userFunction.length <= 1) {
    // One argument (context)
    // Make sure their function returns a promise
    Promise.resolve(userFunction(context))
      .then(function({ status, body, headers }) {
        callback(status, body, headers);
      })
      .catch(function(err) {
        console.log(`Function error: ${err}`);
        callback(500, 'Internal server error');
      });
  } else {
    // 2 arguments (context, callback)
    try {
      userFunction(context, callback);
    } catch (err) {
      console.log(`Function error: ${err}`);
      callback(500, 'Internal server error');
    }
  }
});

async function start() {
  let nc = null;
  try {
    if (process.env.NODE_ENV !== 'test') {
      nc = await connect({
        url: 'nats://defaultFissionAuthToken@nats-streaming.default:4222'
      });
    }
    app.nc = nc;
    app.listen(argv.port, token => {
      if (token) {
        console.log('Server listening on port', argv.port);
      } else {
        console.error('Failed to listen...');
      }
    });
  } catch (error) {
    console.error('Failed to start...', error);
  }
}

start();
