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
var Shell = require(__dirname+'/lib/shell');

//instance manager object
var im = {};

//im variables
im.options = {};
im.iOpts = [];
im.iArr = [];
im.shell = {};

//settings constructor
im.SettingsConstructor = {
	main: function (modified) {
		//force 'new' object keyword
		if(!(this instanceof im.SettingsConstructor.main)) {
			return new im.SettingsConstructor.main(modified);
		}
		var attrname;
		this.shellEnabled = true;
		this.shellPrompt = '> ';
		this.logs = true;
		this.ignoreUncaughtExceptions = false;
		for (attrname in modified) {this[attrname]=modified[attrname];}
	},
	connection: function (modified) {
		//force 'new' object keyword
		if(!(this instanceof im.SettingsConstructor.connection)) {
			return new im.SettingsConstructor.connection(modified);
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
			'cron',
			'reconnect',
			'simpleMsg',
			'commands'
		];
		this.pluginsSettings = {};
		for (attrname in modified) {this[attrname]=modified[attrname];}
	}
};

im.uncaughtExceptionHandle = function (err) {
	console.log(err.stack);
	console.log('An uncaught exception occurred please report this.');
	if (im.options.ignoreUncaughtExceptions) {
		console.log('WARNING: Ignoring of uncaught exceptions enabled!');
	} else {
		process.exit(1);
	}
};

im.settingsLoad = function (file, callback) {
	file = file||"settings.json";
	var s, c;
	if (callback !== undefined) {
		fs.access(file, fs.F_OK, function (err) {
			if (!err) {
				try {
					fs.readFile(file, {"encoding": "utf8"}, function (err, data) {
						if (err) throw err;
						s = JSON.parse(data);
						s = new im.SettingsConstructor.main(s);
						for (c in s.connections) {
							s.connections[c] = new im.SettingsConstructor.connection(s.connections[c]);
						}
						callback(s);
					});
				} catch (e) {
						im.log('Error happened when loading settings:\n'+e.stack);
				}
			} else if (err.code == "ENOENT") {
				s = new im.SettingsConstructor.main({
					connections: [new im.SettingsConstructor.connection({})]
				});
				im.settingsSave(null, s, function () {callback(s);});
			}
		});
	}
};

im.settingsSave = function (file, data, callback) {
	file = file||"settings.json";
	data = data||im.options;
	try {
		fs.writeFile(file, JSON.stringify(data, null, '\t'), function (err) {
			if (err) throw err;
			if (callback !== undefined) {
				callback();
			}
		});
	} catch (e) {
			im.log('Error happened when saving settings:\n'+e.stack);
	}
};

im.killInstance = function (iId, reason, force) {
	force = (reason)?
		((force)?true:false):
		((force===false)?false:true);
	reason = reason||'Leaving';
	var bot = im.iArr[iId];
	if (bot) {
		for (var plugin in bot.plugins) {
			bot.pluginDisable(plugin);
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
};

im.killAllInstances = function (reason, force) {
	for (var iId in im.iArr) {
		im.killInstance(iId, reason, force);
	}
};

im.log = function (data) {
	if (im.options.logs) {
		if (im.options.shellEnabled) {
			im.shell.log(data);
		} else {
			process.stdout.write(data+'\n');
		}
	}
};

im.botEventHandle_botReceivedPRIVMSG = function (iId, data) {
	var nick = data[1][0],
		to = data[4][0],
		message = data[5]||data[4][1];
	var connectionName = im.iOpts[iId].connectionName||iId;
	im.log('['+connectionName+':'+to+'] <'+nick+'>: '+message);
};

im.botEventHandle_botReceivedNOTICE = function (iId, data) {
	var nick = data[1][0],
		to = data[4][0],
		message = data[5]||data[4][1];
	var connectionName = im.iOpts[iId].connectionName||iId;
	im.log('[NOTICE('+connectionName+':'+to+')] <'+nick+'>: '+message);
};

im.botEventHandle = function (iId, event) {
	if (im['botEventHandle_'+event.eventName] !== undefined) {
		im['botEventHandle_'+event.eventName](iId, event.eventData);
	}
};

//misc functions: handle debug message event from bot instance
im.botLogMessageHandle = function (iId, data) {
	var connectionName = im.iOpts[iId].connectionName||iId;
	im.log(connectionName+"-> "+data);
};

im.initShell = function () {
	im.shell = new Shell(im);
	im.shell.init();
};

//misc functions: start a nBot connection from settings using sequential id
im.createInstance = function (iId) {
	var bot = new Bot(im.iOpts[iId]);
	var options = bot.options;
	
	function botEventHandle(event) {
		im.botEventHandle(iId, event);
	}
	
	function botLogMessageHandle(data) {
		im.botLogMessageHandle(iId, data);
	}
	
	im.iArr[iId] = bot;
	
	//expose instance manager
	bot.im = im;
	
	//listen for events
	bot.eventsAdd('botEvent', botEventHandle);
	bot.eventsAdd('botLogMessage', botLogMessageHandle);
	
	//load plugins from settings
	for (var plugin in im.iOpts[iId].plugins) {
		bot.pluginLoad(options.plugins[plugin],
			options.pluginDir+'/'+options.plugins[plugin]+'.js');
	}
	
	bot.init();
};

(function main(){
	//handle uncaught errors
	process.on('uncaughtException', im.uncaughtExceptionHandle);
	
	//load settings and start the bot
	im.settingsLoad(null, function (data) {
		im.options = data;
		im.iOpts = im.options.connections;
		if(im.options.shellEnabled){im.initShell();}
		for (var iId in im.iOpts) {
			im.createInstance(iId);
		}
	});
})();
