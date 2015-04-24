/*jshint node: true*/

"use strict";
//variables
var http = require('http');
var net = require('net');
var exec = require('child_process').exec;
var events = require('events');
var url = require('url');

var botObj;
var pluginId;
var botF;
var settings;
var pluginSettings;
var ircChannelUsers;
var plugin = module.exports;
var pluginFuncObj;

//settings constructor
var SettingsConstructor = function (modified) {
	var settings, attrname;
	if (this!==SettingsConstructor) {
		settings = {
			mpdServer: 'localhost',
			mpdServerPort: 6600,
			mpdServerPassword: '',
			mpdCommandsOpOnly: true,
			icecastStatsUrl: 'http://localhost:8000/status-json.xsl'
		};
		for (attrname in modified) {settings[attrname]=modified[attrname];}
		return settings;
	}
};

//misc plugin functions

//misc plugin functions: radio status
function getNowPlaying(callback) {
	var currentsong, listeners;
	function getRadioStatus() {
		function getCurrentSong() {
			var mpdConnection = net.connect({port: pluginSettings.mpdServerPort, host: pluginSettings.mpdServer},
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
			http.get(pluginSettings.icecastStatsUrl, function(res) {
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
				callback('Now Playing: '+currentSongName[1].replace(/\.[^.]*$/, '')+' (Pos: '+currentSongPos+') | Listeners: '+listeners+' | Tune in at http://mindcraft.si.eu.org/radio/');
			}
		}
	}
	getRadioStatus();
}

function mpdSendCommand(command) {
	var mpdConnection = net.connect({port: pluginSettings.mpdServerPort, host: pluginSettings.mpdServer},
		function() { //'connect' listener
			mpdConnection.setEncoding('utf8');
			mpdConnection.on('data', function (data) {
				if (data == new RegExp('OK MPD [^\n]*\n').exec(data)){
					mpdConnection.write('password '+pluginSettings.mpdServerPassword+'\n');
					mpdConnection.write(command+'\n');
					mpdConnection.end(); mpdConnection.destroy();
				}
			});
	});
	mpdConnection.setTimeout(10000);
	mpdConnection.on('error', function (e) {mpdConnection.end();mpdConnection.destroy();});
	mpdConnection.on('timeout', function (e) {mpdConnection.end();mpdConnection.destroy();});
}

//export functions
pluginFuncObj = {
	getNowPlaying: getNowPlaying,
	mpdSendCommand: mpdSendCommand
};
for (var name in pluginFuncObj) {module.exports[name] = pluginFuncObj[name];}

//reserved functions

//main function called when plugin is loaded
module.exports.main = function (passedData) {
	//update variables
	botObj = passedData.botObj;
	pluginId = passedData.id;
	botF = botObj.publicData.botFunctions;
	settings = botObj.publicData.settings;
	pluginSettings = settings.pluginsSettings[passedData.id];
	ircChannelUsers = botObj.publicData.ircChannelUsers;
	
	//if plugin settings are not defined, define them
	if (pluginSettings === undefined) {
		pluginSettings = new SettingsConstructor();
		settings.pluginsSettings[passedData.id] = pluginSettings;
		botF.botSettingsSave();
	}
	
	//add commands to core plugin
	var commandsPlugin = botObj.pluginData.commands.plugin;
	commandsPlugin.commandAdd('np', function (data) {
		getNowPlaying(function (response) {
			botF.ircSendCommandPRIVMSG(response, data.responseTarget);
		});
	}, 'np: shows currently playing song on the radio', pluginId);
	
	commandsPlugin.commandAdd('mpd_play', function (data) {
		if (commandsPlugin.isOp(data.ircData[1]) || !pluginSettings.mpdCommandsOpOnly) {
			mpdSendCommand('play '+(+data.messageARGS[1]-1));
			botF.ircSendCommandPRIVMSG('Playing song: "'+data.messageARGS[1]+'"', data.responseTarget);
		}
	}, 'mpd_play "pos": plays the song at position', pluginId);
	
	commandsPlugin.commandAdd('mpd_random', function (data) {
		if (commandsPlugin.isOp(data.ircData[1]) || !pluginSettings.mpdCommandsOpOnly) {
			mpdSendCommand('random '+data.messageARGS[1]);
			botF.ircSendCommandPRIVMSG('mpd: updated random mode', data.responseTarget);
		}
	}, 'mpd_random "state": sets random state to state (0 or 1)', pluginId);
	
	commandsPlugin.commandAdd('mpd_prio', function (data) {
		if (commandsPlugin.isOp(data.ircData[1]) || !pluginSettings.mpdCommandsOpOnly) {
			mpdSendCommand('prio '+data.messageARGS[1]+' '+(+data.messageARGS[2]-1));
			botF.ircSendCommandPRIVMSG('mpd: priority set', data.responseTarget);
		}
	}, 'mpd_prio "priority" "pos": sets priority (0 - 255) of song at pos in random mode', pluginId);
	
	commandsPlugin.commandAdd('mpd_queue_song', function (data) {
		if (commandsPlugin.isOp(data.ircData[1]) || !pluginSettings.mpdCommandsOpOnly) {
				var pos = +data.messageARGS[1]-1, endpos = +data.messageARGS[2], prio = 255;
				if (!data.messageARGS[2]) {
					mpdSendCommand('random 1\nprio 0 -1\nprio 255 '+pos);
					botF.ircSendCommandPRIVMSG('mpd: Song queued', data.responseTarget);
				} else {
					var commandString = 'random 0\nrandom 1\nprio 0 -1';
					while (pos < endpos && prio > 0) {
						commandString += '\nprio '+prio+' '+pos;
						pos++; prio--;
					}
					mpdSendCommand(commandString);
					botF.ircSendCommandPRIVMSG('mpd: Songs queued', data.responseTarget);
				}
		}
	}, 'mpd_queue_song "pos" ["endpos"]: queues song at pos if endpos is set then play queue from pos to endpos (enables random mode)', pluginId);
	
	commandsPlugin.commandAdd('mpd_queue_songs', function (data) {
		if (commandsPlugin.isOp(data.ircData[1]) || !pluginSettings.mpdCommandsOpOnly) {
				var posArray = data.messageARGS[1].split(' ');
				var commandString = 'random 0\nrandom 1\nprio 0 -1', pos, prio = 255;
				for (pos in posArray) {
					pos = +posArray[pos]-1;
					commandString += '\nprio '+prio+' '+pos;
					prio--;
				}
				console.log(commandString);
				mpdSendCommand(commandString);
				botF.ircSendCommandPRIVMSG('mpd: Songs queued', data.responseTarget);
		}
	}, 'mpd_queue_songs "pos list": queues songs using position, positions are seperated using a single space (enables random mode)', pluginId);
	
	commandsPlugin.commandAdd('mpd_raw', function (data) {
		if (commandsPlugin.isOp(data.ircData[1]) || !pluginSettings.mpdCommandsOpOnly) {
			mpdSendCommand(data.messageARGS[1]);
		}
	}, 'mpd_raw "command": send command to mpd)', pluginId);
};
