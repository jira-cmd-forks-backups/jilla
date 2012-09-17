var fs = require('fs');
var readline = require('readline');
var request = require('superagent');
var ms = require('ms');

var cfg, db;

load(function(_cfg, _db) {
  cfg = _cfg;
  db = _db;
  var cmd = process.argv[2];
  if (cmd == 'ls')    ls();
  if (cmd == 'start') start(process.argv[3]);
  if (cmd == 'stop')  stop(process.argv[3]);
});

function ls() {
  request
    .get(cfg.url+'rest/api/2/search?jql=assignee='+cfg.user+'+AND+status+in+(Open,"In+Progress",Reopened)+order+by+due+ASC,+priority+DESC')
    .set('Content-Type', 'application/json')
    .auth(cfg.user, cfg.password)
    .end(function(res) {
      if (!res.ok) throw res.text;
      var issues = res.body.issues;
      console.log('');
      var table = [];
      for (var i=0; i<issues.length; i++) {
        table.push([
          issues[i].key,
          '<'+issues[i].fields.reporter.name+'>',
          {data: formatPrio(issues[i].fields.priority.name), right: true},
          issues[i].fields.summary
        ]);
      }
      console.log(formatTable(table));
    })
  ;
}

function start(issue) {
  request
    .post(cfg.url+'rest/api/2/issue/'+issue+'/transitions')
    .send({transition: {id: 4}})
    .auth(cfg.user, cfg.password)
    .end(function(res) {
      if (!res.ok) return console.log(
        '\n'+res.body.errorMessages.join('\n\n')+'\n'
      );

      db.set(issue, Date.now());
    })
  ;
}

function stop(issue) {
  request
    .post(cfg.url+'rest/api/2/issue/'+issue+'/transitions')
    .send({transition: {id: 301}})
    .auth(cfg.user, cfg.password)
    .end(function(res) {
      if (!res.ok) return console.log(
        '\n'+res.body.errorMessages.join('\n\n')+'\n'
      );

      // TODO: less exact time display
      console.log('\n  Time spent: '+ms(Date.now()-db.get(issue))+'.\n');
    })
  ;
}

function formatTable(cols) {
  var rowLengths = [];
  var output = '';

  for (var i=0; i<cols.length; i++) {
    for (var j=0; j<cols[i].length; j++) {
      if (!rowLengths[j]) rowLengths[j] = 0;
      if (typeof cols[i][j] == 'string') cols[i][j] = {data:cols[i][j]};
      if (cols[i][j].data.length > rowLengths[j]) {
        rowLengths[j] = cols[i][j].data.length;
      }
    }
  }

  for (var i=0; i<cols.length; i++) {
    var col = ' ';
    for (var j=0; j<cols[i].length; j++) {
      if (j == cols[i].length-1) {
        col += cols[i][j].data;
        continue;
      }
      col += pad(
        cols[i][j].data,
        rowLengths[j],
        {right: cols[i][j].right}
      ) + ' ';
    }
    output += truncate(col, 79)+'\n';
  }

  return output;

  function pad(str, len, cfg) {
    cfg = cfg || {};
    cfg.character = cfg.character || ' ';
    if (cfg.right) {
      while(str.length < len) str = cfg.character + str;
    } else {
      while(str.length < len) str += cfg.character;
    }
    return str;
  }

  function truncate(str, len) {
    if (str.length <= len) return str;
    while (str.length > len-3) str = str.slice(0, -1);
    str = pad(str, len, {character:'.'});
    return str;
  }
}

function formatPrio(name) {
  if (name == 'Trivial')  return '';
  if (name == 'Minor')    return '!';
  if (name == 'Major')    return '!!';
  if (name == 'Critical') return '!!!';
  if (name == 'Blocker')  return '!!!!';
}

function load(cb) {
  var home = (process.platform == 'win32') ? 'USERPROFILE' : 'HOME';
  var jillaPath = process.env[home]+'/.jilla/';
  var cfgPath = jillaPath+'cfg.json';
  var dbPath = jillaPath+'db.json';

  if (fs.existsSync(cfgPath) && fs.existsSync(dbPath)) {
    cb(require(cfgPath), Db(dbPath));
  } else {
    fs.mkdirSync(jillaPath);
    askFor(['Jira Url', 'Username', 'Password'], function(answers) {
      cfg = {
        url     : answers['Jira Url'],
        user    : answers['Username'],
        password: answers['Password']
      };
      if (cfg.url[cfg.url.length-1] != '/') cfg.url += '/';
      // TODO: Store password securely
      fs.writeFileSync(cfgPath, JSON.stringify(cfg));
      fs.writeFileSync(dbPath, JSON.stringify({}));
      cb(cfg, Db(dbPath));
    });
  }
}

function Db(path) {
  return new Database(path);
}

function Database(path) {
  this.path = path;
  this.db = require(path);
}

Database.prototype.get = function(key) {
  return this.db[key];
}

Database.prototype.set = function(key, value) {
  this.db[key] = value;
  fs.writeFileSync(this.path, JSON.stringify(this.db));
}

function askFor(questions, cb) {
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  var answers = {};
  console.log('');

  (function ask() {
    var question = questions.shift();
    rl.question('  '+question+': ', function(answer) {
      answers[question] = answer;
      if (!questions.length) {
        rl.close();
        console.log('\nGood to go!\n');
        return cb(answers);
      }
      ask();
    });
  })();
}