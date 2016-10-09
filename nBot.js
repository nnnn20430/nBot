#!/usr/bin/env node
// nBot, stupid irc bot made for fun
// Copyright (C) 2015, 2016  nnnn20430 (nnnn20430@mindcraft.si.eu.org)
//
// nBot is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// nBot is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

"use strict";
//variables
var net = require('net');
var tls = require('tls');
var fs = require('fs');
var events = require('events');
var path = require('path');

var Bot = require(__dirname+'/lib/bot');
var Term = require(__dirname+'/lib/term');

var nBot = {
	settings: {},
	connSettings: [],
	connObjArr: [],
	term: {}
};

//handle uncaught errors
process.on('uncaughtException', function (err) {
	console.log(err.stack);
	console.log('An uncaught exception occurred please report this.');
	if (nBot.settings.ignoreUncaughtExceptions) {
		console.log('WARNING: Ignoring of uncaught exceptions enabled!');
	} else {
		process.exit(1);
	}
});

//settings
var SettingsConstructor = {
	main: function (modified) {
		//force 'new' object keyword
		if(!(this instanceof SettingsConstructor.main)) {
			return new SettingsConstructor.main(modified);
		}
		var attrname;
		this.terminalSupportEnabled = true;
		this.terminalInputPrefix = '> ';
		this.debugMessages = false;
		this.ignoreUncaughtExceptions = false;
		for (attrname in modified) {this[attrname]=modified[attrname];}
	},
	connection: function (modified) {
		//force 'new' object keyword
		if(!(this instanceof SettingsConstructor.connection)) {
			return new SettingsConstructor.connection(modified);
		}
		var attrname;
		this.connectionName = 'Connection0';
		this.botName = 'nBot';
		this.botMode = '0';
		this.botUpdateInterval = 10000;
		this.ircServer = 'localhost';
		this.ircServerPort = 6667;
		this.ircServerPassword = '';
		this.localBindAddress = null;
		this.localBindPort = null;
		this.ipFamily = 4;
		this.tls = false;
		this.tlsRejectUnauthorized = false;
		this.socks5_host = '';
		this.socks5_port = 1080;
		this.socks5_username = '';
		this.socks5_password = '';
		this.channels = [ '#nBot' ];
		this.ircRelayServerEnabled = true;
		this.ircResponseListenerLimit = 30;
		this.ircMultilineMessageMaxLines = 300;
		this.errorsIncludeStack = false;
		this.pluginDir = './plugins';
		this.plugins = [ 
			'simpleMsg',
			'commands',
			'reconnect'
		];
		this.pluginsSettings = {};
		for (attrname in modified) {this[attrname]=modified[attrname];}
	}
};

function botSettingsLoad(file, callback) {
	file = file||"settings.json";
	fs.access(file, fs.F_OK, function (err) {
		if (!err) {
			fs.readFile(file, {"encoding": "utf8"}, function (err, data) {
				if (err) throw err;
				if (callback !== undefined) {
					try {
						callback(JSON.parse(data));
					} catch (e) {
						debugLog('Error happened when loading settings:\n'+e.stack);
					}
				}
			});
		} else if (err.code == "ENOENT"){
			var newSettings = new SettingsConstructor.main({
				connections: [new SettingsConstructor.connection({})]
			});
			fs.writeFile(file, JSON.stringify(newSettings, null, '\t'),
				function (err) {
					if (err) throw err; callback(newSettings);
				});
		}
	});
}

function botSettingsSave(file, data, callback) {
	file = file||"settings.json";
	data = data||nBot.settings;
	fs.writeFile(file, JSON.stringify(data, null, '\t'), function (err) {
		if (err) throw err;
		if (callback !== undefined) {
			callback();
		}
	});
}

//misc prototypes
Object.defineProperty(Array.prototype, "diff", { 
	value: function(a) {
		return this.filter(function(i) {return a.indexOf(i) < 0;});
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(Array.prototype, "arrayValueAdd", { 
	value: function(a) {
		this.splice(this.lastIndexOf(this.slice(-1)[0])+1, 0, a);
		return this;
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(Array.prototype, "arrayValueRemove", { 
	value: function(a) {
		if (this.lastIndexOf(a) !== -1) {
			return this.splice(this.lastIndexOf(a), 1);
		}
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(String.prototype, "toHex", { 
	value: function(a) {
		return new Buffer(this.toString(), 'utf8').toString('hex');
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(String.prototype, "fromHex", { 
	value: function(a) {
		return new Buffer(this.toString(), 'hex').toString('utf8');
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(String.prototype, "toUtf8Hex", { 
	value: function(a) {
		var hex, i;
		
		var result = "";
		for (i=0; i<this.length; i++) {
			hex = this.charCodeAt(i).toString(16);
			result += ("000"+hex).slice(-4);
		}
		
		return result;
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(String.prototype, "fromUtf8Hex", { 
	value: function(a) {
		var j;
		var hexes = this.match(/.{1,4}/g) || [];
		var back = "";
		for(j = 0; j<hexes.length; j++) {
			back += String.fromCharCode(parseInt(hexes[j], 16));
		}
		
		return back;
	},
	configurable: true,
	writable: true,
	enumerable: false
});

//misc functions

//misc functions: kill all nBot instances
function botKillAllInstances(reason, force) {
	reason = reason||'Leaving';
	force = force||false;
	var connection;
	var bot;
	for (connection in nBot.connObjArr) {
		if (nBot.connObjArr[connection]) {
			bot = nBot.connObjArr[connection];
			for (var plugin in bot.plugins) {
				bot.botPluginDisable(plugin);
			}
			if (force === true) {
				bot.kill();
			} else {
				if (!bot.ircConnection.destroyed) {
					bot.ircSendCommandQUIT(reason);
				} else {
					bot.kill();
				}
			}
		}
	}
}

//misc functions: handle irc bot event from bot instance
var botInstanceEventHandles = {
	PRIVMSG: function (connection, data) {
		var nick = data[1][0], 
			to = data[4][0], 
			message = data[5]||data[4][1];
		var connectionName = nBot.connSettings[connection].connectionName||connection;
		debugLog('['+connectionName+':'+to+'] <'+nick+'>: '+message);
	},
	NOTICE: function (connection, data) {
		var nick = data[1][0], 
			to = data[4][0], 
			message = data[5]||data[4][1];
		var connectionName = nBot.connSettings[connection].connectionName||connection;
		debugLog('[NOTICE('+connectionName+':'+to+')] <'+nick+'>: '+message);
	}
};

//misc functions: simple debug log
function debugLog(data) {
	if (nBot.settings.terminalSupportEnabled) {
		nBot.term.log(data);
	} else if (nBot.settings.debugMessages) {
		process.stdout.write(data+'\x0a');
	}
} 

//misc functions: handle debug message event from bot instance
function botInstanceDebugMessageEventHandle(connection, data) {
	var connectionName = nBot.connSettings[connection].connectionName||
		connection;
	debugLog(connectionName+"-> "+data);
}

function initTerminal() {
	nBot.term = new Term(nBot);
	nBot.term.SettingsConstructor = SettingsConstructor;
	nBot.term.botSettingsLoad = botSettingsLoad;
	nBot.term.botSettingsSave = botSettingsSave;
	nBot.term.botKillAllInstances = botKillAllInstances;
	nBot.term.botCreateInstance = botCreateInstance;
}

//misc functions: start a nBot connection from settings using sequential id
function botCreateInstance(connectionId) {
	var bot = new Bot(nBot.connSettings[connectionId]);
	var options = bot.options;
	
	function handleBotEvent(event) {
		switch (event.eventName) {
			case 'botReceivedPRIVMSG': 
				botInstanceEventHandles.PRIVMSG(connectionId, event.eventData);
				break;
			case 'botReceivedNOTICE':
				botInstanceEventHandles.NOTICE(connectionId, event.eventData);
				break;
			case 'botIrcConnectionRegistered':
				handleConnectionRegistration();
				break;
		}
	}
	function handleBotDebugMessage(data) {
		botInstanceDebugMessageEventHandle(connectionId, data);
	}
	function handleConnectionRegistration() {
		var ircIntervalUpdate;
		bot.ircBotUpdateSelf();
		ircIntervalUpdate = setInterval(function () {
			bot.ircBotUpdateSelf();
		}, options.botUpdateInterval||10000);
		bot.ircConnection.once('close', function() {
			clearInterval(ircIntervalUpdate);
		});
	}
	
	nBot.connObjArr[connectionId] = bot;
	
	//expose variables and functions
	bot.botInstanceEventHandles = botInstanceEventHandles;
	bot.botSettingsLoad = botSettingsLoad;
	bot.botSettingsSave = botSettingsSave;
	
	//listen for events
	bot.botEventsEmitter.on('botEvent', handleBotEvent);
	bot.botEventsEmitter.on('botDebugMessage', handleBotDebugMessage);
	
	//load plugins from settings
	for (var plugin in nBot.connSettings[connectionId].plugins) {
		bot.botPluginLoad(options.plugins[plugin], 
			options.pluginDir+'/'+options.plugins[plugin]+'.js');
	}
	
	bot.init();
}

//load settings and start the bot
botSettingsLoad(null, function (data) {
	nBot.settings = data;
	nBot.connSettings = nBot.settings.connections;
	if(nBot.settings.terminalSupportEnabled){initTerminal();}
	for (var connectionId in nBot.connSettings) {
		botCreateInstance(connectionId);
	}
});
