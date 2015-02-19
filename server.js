// globals
var PORT = 10080;
var DEBUG = true;
var VIEW_DIR = './view/'
var STATIC_DIR = './static/'
var DATA_DIR = './.data/'

// requires
var fs = require('fs');
var ejs = require('ejs');
var qs = require('querystring');

// initialize
(function() {
	try {
		var stats = fs.statSync(DATA_DIR);
	} catch (e) {}
	if (!!stats && stats.isFile()) throw DATA_DIR + ' must be directory.';
	if (!!stats && stats.isDirectory()) return;
	fs.mkdirSync(DATA_DIR);
	fs.mkdirSync(DATA_DIR + 'match');
	fs.mkdirSync(DATA_DIR + 'player');
})();

// common
var log = function() {console.log.apply(console, arguments)};

var debug = (function() {
	if (DEBUG) {
		return log;
	} else {
		return function(){};
	}
})();

String.prototype.endsWith = function(suffix) {
	return this.indexOf(suffix, this.length - suffix.length) !== -1;
};

var isStatic = function(path) {
	return path.match(/\.(html|css|js|json)$/);
}

var isEmpty = function(str) {
	return !str || str.length == 0;
}

var isValidInt = function(str) {
	return str.match(/^[0-9]+$/);
}

var isValidPlayer = function(str) {
	return str.match(/^[a-zA-Z0-9 _-]+$/);
}

// http response
var return200 = function(res, text, type) {
	var type = (type == undefined) ? 'text/html' : type;
	res.writeHead(200, {
		'Content-Type': type,
		'Content-Length': Buffer.byteLength(text, 'utf8')
	});
	res.write(text);
	res.end();
}

var redirect302 = function(res, location) {
	res.writeHead(302, {'Location': location});
	res.write('302 Found');
	res.end();
};

var error404 = function(res) {
	res.writeHead(404, {'Content-Type': 'text/plain'});
	res.write('404 Not Found');
	res.end();
};

var error500 = function(res) {
	res.writeHead(500, {'Content-Type': 'text/plain'});
	res.write('500 Internal Server Error');
	res.end();
}

// views
var View = function(path) {
	var self = this;
	self.path = path;
	self.template = fs.readFileSync(VIEW_DIR + path, 'utf8');
	self.render = function(data) {
		return ejs.render(
			self.template, 
			data,
			{filename: VIEW_DIR + path}
		);
	};
	self.write = function(res, data, type) {
		var text = self.render(data);
		return200(res, text, type);
	};
};
var views = (function(){
	var views = {};
	fs.readdir(VIEW_DIR, function(err, files) {
		if (err) throw err;
		files.filter(function(file) {
			return file.endsWith('.ejs');
		}).forEach(function(file) {
			var key = file.substr(0, file.length - 4);
			views[key] = new View(file);
		})
	});
	return views;
})();

// JsonFile
var JsonFile = function(path, defaultData) {
	var self = this;
	self.path = DATA_DIR + path + '.json';
	try {
		self.data = JSON.parse(fs.readFileSync(self.path), 'utf8');
	} catch (e) {
		self.data = defaultData;
	}
	self.save = function() {
		fs.writeFile(self.path, JSON.stringify(self.data), function(err) {
			if (err) throw err;
			debug('Save to ' + self.path);
		});
	};
}

// controllers
var handleStatic = function(context) {
	var res = context.res;
	var path = context.path;
	var dir = STATIC_DIR;
	var type = (function() {
		if (path.endsWith('.html')) {
			return 'text/html';
		}
		if (path.endsWith('.css')) {
			return 'text/css';
		}
		if (path.endsWith('.js')) {
			return 'text/javascript';
		}
		if (path.endsWith('.json')) {
			dir = DATA_DIR;
			return 'application/json';
		}
	})();
	fs.readFile(dir + path, 'utf8', function(err, text) {
		if (err) {
			log(err);
			error404(res);
			return;
		}
		return200(res, text, type);
	});
};

var handleIndex = function(context) {
	views['index'].write(context.res);
}

var handleMatchNew = function(context) {
	var req = context.req;
	var players = new JsonFile('player/list', []);
	debug(players);
	if (req.method === 'GET') {
		views['match-edit'].write(context.res, {
			errors: {},
			params: {point: '11', deuce: '1', game: '1'},
			players: JSON.stringify(players.data.map(function(player) {return player.name}))
		});
		return;
	}
	var errors = {};
	var params = context.params;
	var hasError = false;
	['point', 'game', 'player-a', 'player-b'].forEach(function(key) {
		if (isEmpty(params[key])) {
			errors[key] = true;
		}
	});
	['point', 'game'].forEach(function(key) {
		if (!errors[key] && !isValidInt(params[key])) {
			errors[key] = 'Invalid value.';
		}
	});
	['player-a', 'player-b'].forEach(function(key) {
		if (!errors[key] && !isValidPlayer(params[key])) {
			errors[key] = 'Alphabets and digits are only allowed.';
		}
	});
	if (Object.keys(errors).length > 0) {
		views['match-edit'].write(context.res, {
			errors: errors,
			params: params,
			players: JSON.stringify(players.data.map(function(player) {return player.name}))
		});
		return;
	}
	var matches = new JsonFile('match/list', []);
	var aName = params['player-a'];
	var bName = params['player-b'];
	var match = {
		id: matches.data.length + 1,
		title: params['title'] ? params['title'] : params['player-a'] + ' vs. ' + params['player-b'],
		point: params['point'],
		duece: params['duece'] ? true : false,
		game: params['game'],
		'player-a': aName,
		'player-b': bName,
		status: 'pending'
	};
	matches.data.push({id: match.id, title: match.title});
	matches.save();
	(new JsonFile('match/' + match.id, match)).save();

	var playerNames = {};
	players.data.forEach(function(player) {
		playerNames[player.name] = true;
	});
	var newPlayer = false;
	[aName, bName].forEach(function(name) {
		if(!playerNames[name]) {
			var player = new JsonFile('player/' + name, {name: name});
			player.save();
			players.data.push(player.data);
			newPlayer = true;
		}
	});
	if (newPlayer) {
		players.data.sort(function(left, right) {
			var lName = left.name.toLowerCase();
			var rName = right.name.toLowerCase();
			if (lName > rName) return 1;
			if (lName < rName) return -1;
			return 0;
		});
		players.save();
	}
	redirect302(context.res, '/match/display/' + match.id + '/');
}

var handleMatchDisplay = function(context) {

}

// mapping
var mapping = {
	'/': {controller: handleIndex},
	'/match/new/': {controller: handleMatchNew}
};

// create server
require('http').createServer(function(req, res) {
	var path = req.url.split('?')[0];
	var handleRequest = function() {
		log(req.method, path);
		if (mapping[path]) {
			var context = {
				req: req,
				res: res,
				path: path,
				paths: path.split('/').filter(function(item) {return item.length > 0;}),
				params: req.params
			};
			mapping[path].controller(context);
		} else if (isStatic(path)) {
			var context = {
				req: req,
				res: res,
				path: path
			};
			handleStatic(context);
		} else {
			error404(res);
		}
	};
	if (req.method == 'GET') {
		var index = req.url.indexOf('?');
		if (index >= 0) {
			req.params = qs.parse(req.url.substr(index + 1));
		}
		handleRequest();
	} else if (req.method == 'POST') {
		var body = '';
		req.on('data', function (data) {
			body += data;
			if (body.length > 1e6) { 
				req.connection.destroy();
			}
		});
		req.on('end', function () {
			req.params = qs.parse(body);
			handleRequest();
		});
	}
}).listen(PORT);

// Let's start!
log('Open urls listed below in your browser.');
(function() {
	var interfaces = require('os').networkInterfaces();
	var results = [];
	for (var device in interfaces) {
		interfaces[device].forEach(function(info) {
			if (info.family != 'IPv4') {
				return;
			}
			results.push(info.address);
		});
	}
	return results;
})().forEach(function(ip) {
	log('http://' + ip + (PORT != 80 ? ':' + PORT : '') + '/');
});
log('Ctrl+C to stop this server.')
