// Copyright (C) 2015  nnnn20430 (nnnn20430@mindcraft.si.eu.org)
//
// This file is part of nBot.
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
//reserved nBot variables
var bot;
var pId;
var options;
var pOpts;

//variables
var http = require('http');
var net = require('net');

var pluginDisabled = false;

//settings constructor
var SettingsConstructor = function (modified) {
	var settings, attrname;
	if (this!==SettingsConstructor) {
		settings = {
			mpdServer: 'localhost',
			mpdServerPort: 6600,
			mpdServerPassword: '',
			mpdCommandsOpOnly: true,
			icecastStatsUrl: 'http://localhost:8000/status-json.xsl',
			tuneinUrl: 'http://localhost/radio/'
		};
		for (attrname in modified) {settings[attrname]=modified[attrname];}
		return settings;
	}
};

//main plugin object
var plugin = {};

//misc plugin functions

//misc plugin functions: radio status
plugin.getNowPlaying = function (callback) {
	var currentsong, listeners;
	function getRadioStatus() {
		function getCurrentSong() {
			var mpdConnection = net.connect({port: pOpts.mpdServerPort, host: pOpts.mpdServer},
				function() { //'connect' listener
					mpdConnection.setEncoding('utf8');
					mpdConnection.on('data', function (data) {
						if (data == new RegExp('OK MPD [^\n]*\n').exec(data)){
							mpdConnection.write('currentsong\n');
						}else{
							currentsong=data;
							mpdConnection.end(); mpdConnection.destroy();
							getRadioStatus();
						}
					});
			});
			mpdConnection.setTimeout(10000);
			mpdConnection.on('error', function (e) {mpdConnection.end(); mpdConnection.destroy(); callback("Got error: "+e.message);});
			mpdConnection.on('timeout', function (e) {mpdConnection.end(); mpdConnection.destroy(); callback("Got error: Connection Timeout");});
		}
		function getListeners() {
			http.get(pOpts.icecastStatsUrl, function(res) {
				var data = '';
				res.setEncoding('utf8');
				res.on('data', function (chunk) {data += chunk;});
				res.on('end', function () {
					listeners=JSON.parse(data).icestats.source.listeners;
					getRadioStatus();
				});
			}).on('error', function(e) {callback("Got error: "+e.message);});
		}
		if (currentsong === undefined) {
			getCurrentSong();
		}else if (listeners === undefined) {
			getListeners();
		}else {
			var currentsongLines = currentsong.split('\n');
			var currentSongName = new RegExp('file: (?:[^\/]*\/)*(.*)').exec(currentsongLines[0]);
			var currentSongPos = currentsongLines.filter(function (element, index, array) {if (element.substr(0, 'Pos: '.length) == 'Pos: ') {return true;}})[0]; if (currentSongPos) {currentSongPos=+currentSongPos.substr('Pos: '.length)+1;}
			if (currentSongName !== null) {
				callback('Now Playing: '+currentSongName[1].replace(/\.[^.]*$/, '')+' (Pos: '+currentSongPos+') | Listeners: '+listeners+' | Tune in at '+pOpts.tuneinUrl);
			}
		}
	}
	getRadioStatus();
};

//send command to mpd
plugin.mpdSendCommand = function (command) {
	var mpdConnection = net.connect({port: pOpts.mpdServerPort, host: pOpts.mpdServer},
		function() { //'connect' listener
			mpdConnection.setEncoding('utf8');
			mpdConnection.on('data', function (data) {
				if (data == new RegExp('OK MPD [^\n]*\n').exec(data)){
					mpdConnection.write('password '+pOpts.mpdServerPassword+'\n');
					mpdConnection.write(command+'\n');
					mpdConnection.end(); mpdConnection.destroy();
				}
			});
	});
	mpdConnection.setTimeout(10000);
	mpdConnection.on('error', function (e) {mpdConnection.end();mpdConnection.destroy();});
	mpdConnection.on('timeout', function (e) {mpdConnection.end();mpdConnection.destroy();});
};

//check if plugin is ready
plugin.pluginReadyCheck = function () {
	if (bot.plugins.commands &&
	bot.plugins.commands.ready) {
		//plugin is ready
		exports.ready = true;
		bot.emitBotEvent('botPluginReadyEvent', pId);
	}
};

//add commands to commands plugin
plugin.utilizeCommands = function () {
	var commandsPlugin = bot.plugins.commands.plugin;
	commandsPlugin.commandAdd('np', function (data) {
		plugin.getNowPlaying(function (response) {
			bot.ircSendCommandPRIVMSG(response, data.responseTarget);
		});
	}, 'np: shows currently playing song on the radio', pId);

	commandsPlugin.commandAdd('mpd_play', function (data) {
		if (commandsPlugin.isOp(data.nick) || !pOpts.mpdCommandsOpOnly) {
			plugin.mpdSendCommand('play '+(+data.messageARGS[1]-1));
			bot.ircSendCommandPRIVMSG('Playing song: "'+data.messageARGS[1]+'"', data.responseTarget);
		}
	}, 'mpd_play "pos": plays the song at position', pId);

	commandsPlugin.commandAdd('mpd_random', function (data) {
		if (commandsPlugin.isOp(data.nick) || !pOpts.mpdCommandsOpOnly) {
			plugin.mpdSendCommand('random '+data.messageARGS[1]);
			bot.ircSendCommandPRIVMSG('mpd: updated random mode', data.responseTarget);
		}
	}, 'mpd_random "state": sets random state to state (0 or 1)', pId);

	commandsPlugin.commandAdd('mpd_prio', function (data) {
		if (commandsPlugin.isOp(data.nick) || !pOpts.mpdCommandsOpOnly) {
			plugin.mpdSendCommand('prio '+data.messageARGS[1]+' '+(+data.messageARGS[2]-1));
			bot.ircSendCommandPRIVMSG('mpd: priority set', data.responseTarget);
		}
	}, 'mpd_prio "priority" "pos": sets priority (0 - 255) of song at pos in random mode', pId);

	commandsPlugin.commandAdd('mpd_queue_song', function (data) {
		if (commandsPlugin.isOp(data.nick) || !pOpts.mpdCommandsOpOnly) {
				var pos = +data.messageARGS[1]-1, endpos = +data.messageARGS[2], prio = 255;
				if (!data.messageARGS[2]) {
					plugin.mpdSendCommand('random 1\nprio 0 -1\nprio 255 '+pos);
					bot.ircSendCommandPRIVMSG('mpd: Song queued', data.responseTarget);
				} else {
					var commandString = 'random 0\nrandom 1\nprio 0 -1';
					while (pos < endpos && prio > 0) {
						commandString += '\nprio '+prio+' '+pos;
						pos++; prio--;
					}
					plugin.mpdSendCommand(commandString);
					bot.ircSendCommandPRIVMSG('mpd: Songs queued', data.responseTarget);
				}
		}
	}, 'mpd_queue_song "pos" ["endpos"]: queues song at pos if endpos is set then play queue from pos to endpos (enables random mode)', pId);

	commandsPlugin.commandAdd('mpd_queue_songs', function (data) {
		if (commandsPlugin.isOp(data.nick) || !pOpts.mpdCommandsOpOnly) {
				var posArray = data.messageARGS[1].split(' ');
				var commandString = 'random 0\nrandom 1\nprio 0 -1', pos, prio = 255;
				for (pos in posArray) {
					pos = +posArray[pos]-1;
					commandString += '\nprio '+prio+' '+pos;
					prio--;
				}
				console.log(commandString);
				plugin.mpdSendCommand(commandString);
				bot.ircSendCommandPRIVMSG('mpd: Songs queued', data.responseTarget);
		}
	}, 'mpd_queue_songs "pos list": queues songs using position, positions are seperated using a single space (enables random mode)', pId);

	commandsPlugin.commandAdd('mpd_raw', function (data) {
		if (commandsPlugin.isOp(data.nick) || !pOpts.mpdCommandsOpOnly) {
			plugin.mpdSendCommand(data.messageARGS[1]);
		}
	}, 'mpd_raw "command": send command to mpd)', pId);

	plugin.pluginReadyCheck();
};

//export functions
module.exports.plugin = plugin;
module.exports.ready = false;

//reserved functions

//reserved functions: handle "botEvent" from bot (botEvent is used for irc related activity)
module.exports.botEvent = function (event) {
	switch (event.eventName) {
		case 'botPluginDisableEvent':
			if (event.eventData == pId) {pluginDisabled = true;}
			break;
		case 'botPluginReadyEvent':
			if (event.eventData == 'commands') {plugin.utilizeCommands();}
			break;
	}
};

//reserved functions: main function called when plugin is loaded
module.exports.main = function (i, b) {
	//update variables
	bot = b;
	pId = i;
	options = bot.options;
	pOpts = options.pluginsSettings[pId];

	//if plugin settings are not defined, define them
	if (pOpts === undefined) {
		pOpts = new SettingsConstructor();
		options.pluginsSettings[pId] = pOpts;
		bot.im.settingsSave();
	}

	//check and utilize dependencies
	if (bot.plugins.commands &&
	bot.plugins.commands.ready) {
		plugin.utilizeCommands();
	}
};
