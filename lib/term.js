// Copyright (C) 2015, 2016  nnnn20430 (nnnn20430@mindcraft.si.eu.org)
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

/*jshint node: true*/
/*jshint evil: true*/

"use strict";
//variables
var util = require(__dirname+'/util');

//export the constructor
module.exports = ConstructTerminalInstance;

function ConstructTerminalInstance(nBot) {
	//force 'new' object keyword
	if(!(this instanceof ConstructTerminalInstance)) {
		return new ConstructTerminalInstance(nBot);
	}
	
	//term object
	var term = this;
	
	term.currentConnection = 0;
	term.lastChannel = nBot.connSettings[term.currentConnection].channels[0];
	term.buffer = [""];
	term.bufferCurrent = 0;
	term.bufferMax = 10;
	term.cursorPositionAbsolute = 1;
	term.bufferCurrentUnModifiedState = "";
	
	term.log = function (data) {
		process.stdout.write("\x1b[1G\x1b[K");
		process.stdout.write(data);
		process.stdout.write('\x0a');
		term.terminalUpdateBuffer();
	};
	
	term.terminalUpdateBuffer = function (){
		var tColumns = (+process.stdout.columns-nBot.settings.terminalInputPrefix.length);
		process.stdout.write("\x1b[1G\x1b[2K");
		process.stdout.write(nBot.settings.terminalInputPrefix);
		process.stdout.write(term.buffer[term.bufferCurrent].substr(term.terminalGetCursorPos()[1], tColumns));
		process.stdout.write("\x1b["+(+term.terminalGetCursorPos()[0])+"G");
	};
	
	term.terminalGetCursorPos = function (){
		var tColumns = (+process.stdout.columns-nBot.settings.terminalInputPrefix.length);
		var positionAbsolute = term.cursorPositionAbsolute-1;
		var offsetCount = Math.floor(positionAbsolute/tColumns);
		var adjustedOffsetCount = Math.floor((positionAbsolute+offsetCount)/tColumns);
		var offsetRemainder = (positionAbsolute+adjustedOffsetCount)%tColumns;
		var postionOffset = adjustedOffsetCount*tColumns-adjustedOffsetCount;
		offsetRemainder+=(1+nBot.settings.terminalInputPrefix.length);
		return [offsetRemainder, postionOffset];
	};
	
	term.terminalProcessLine = function (data) {
		var commandArgs = util.getArgsFromString(data)[0];
		var cConnsettings = nBot.connSettings[term.currentConnection];
		var connectionName = cConnsettings.connectionName||term.currentConnection;
		var bot;
		if (nBot.connObjArr[term.currentConnection]) {
			bot = nBot.connObjArr[term.currentConnection];
		}
		if (commandArgs[0] && commandArgs[0].charAt(0) == '/') {
			switch (commandArgs[0].split('').slice(1).join('')) {
				case 'raw':
					(function () {
						if (bot && !bot.ircConnection.destroyed) {
							bot.ircWriteData(commandArgs[1]);
						} else {
							term.log('Current connection is dead.');
						}
					})();
					break;
				case 'join':
					(function () {
						var botIsInChannel = false;
						for (var channel in cConnsettings.channels) {
							if (cConnsettings.channels[channel] == commandArgs[1]) {
								botIsInChannel = true;
							}
						}
						if (!botIsInChannel) {
							cConnsettings.channels.push(commandArgs[1]);
						}
					})();
					break;
				case 'part':
					(function () {
						var partReason = "Leaving";
						if (commandArgs[2] !== undefined) {partReason=commandArgs[2];}
						cConnsettings.channels.arrayValueRemove(commandArgs[1]);
						if (bot && !bot.ircConnection.destroyed) {
							bot.ircSendCommandPART(commandArgs[1], partReason);
						}
					})();
					break;
				case 'say':
					(function () {
						if (commandArgs[2] !== undefined) {
							if (bot && !bot.ircConnection.destroyed) {
								term.log('['+connectionName+':'+commandArgs[1]+'] '+cConnsettings.botName+': '+commandArgs[2]);
								bot.ircSendCommandPRIVMSG(commandArgs[2], commandArgs[1]);
							} else {
								term.log('Current connection is dead');
							}
						}
						term.lastChannel = commandArgs[1];
					})();
					break;
				case 'quit':
					(function () {
						var quitReason = commandArgs[1]||"Leaving";
						term.log('> quitting...');
						setTimeout(function () {
							term.botKillAllInstances(null, true);
							process.exit();
						}, 1000);
						term.botKillAllInstances(quitReason);
					})();
					break;
				case 'connection':
					(function () {
						var bot;
						if (commandArgs[1] !== undefined) {
							var connection;
							if (commandArgs[1].toUpperCase() == 'SET') {
								var connectionId = commandArgs[2];
								for (connection in nBot.connSettings) {
									if (nBot.connSettings[connection].connectionName == connectionId) {connectionId = connection;}
								}
								if (nBot.connObjArr[connectionId] !== undefined) {
									term.currentConnection = connectionId;
								}
							}
							if (commandArgs[1].toUpperCase() == 'LIST') {
								for (connection in nBot.connSettings) {
									bot = nBot.connObjArr[connection];
									term.log('> id: '+connection+', name: "'+nBot.connSettings[connection].connectionName+'", status: '+(bot?(bot.ircConnection.destroyed?'dead':'alive'):'dead'));
								}
							}
						} else {
							bot = nBot.connObjArr[term.currentConnection];
							term.log('> Current connection id: '+term.currentConnection+', name: "'+connectionName+'", status: '+(bot?(bot.ircConnection.destroyed?'dead':'alive'):'dead')+'.');
						}
					})();
					break;
				case 'fakemsg':
					(function () {
						if (bot && !bot.ircConnection.destroyed) {
							bot.emitBotEvent('botReceivedPRIVMSG', ['terminal', 'terminal', 'terminal', 'terminal', 'terminal', commandArgs[1]]);
						} else {
							term.log('Current connection is dead.');
						}
					})();
					break;
				case 'evaljs':
					(function () {
						eval("(function () {"+commandArgs[1]+"})")();
					})();
					break;
				case 'help':
					(function () {
						term.log('> Commands are prefixed with "/", arguments must be in form of strings "" seperated by a space');
						term.log('> arguments in square brackets "[]" are optional, Vertical bar "|" means "or"');
						term.log('> /raw "data": write data to current irc connection');
						term.log('> /join "#channel": join channel on current connection');
						term.log('> /part "#channel": part channel on current connection');
						term.log('> /say "#channel" "message": send message to channel on current connection');
						term.log('> /quit ["reason"]: terminate the bot');
						term.log('> /connection [LIST|SET ["name"|"id"]]: change current connection using name from settings or id starting from 0');
						term.log('> /fakemsg "message": emit fake PRIVMSG bot event');
						term.log('> /evaljs "code": evaluates node.js code');
						term.log('> /help: print this message');
						term.log('> /pluginreload "id": reload plugin with id');
						term.log('> /pluginreloadall: reload all plugins');
						term.log('> /pluginload "plugin": load a plugin');
						term.log('> /plugindisable "plugin": disable a loaded plugin');
						term.log('> /savesettings: save current settings to file');
						term.log('> /loadsettings: load settings from file (reloads all plugins on all current connections)');
						term.log('> /connectioncreate: creates new connection entry in settings');
						term.log('> /connectiondelete ["name"|"id"]: deletes connection entry from settings');
						term.log('> /connectioninit ["name"|"id"]: starts new bot connection from settings');
						term.log('> /connectionkill ["name"|"id"]: kills running bot instance');
					})();
					break;
				case 'pluginreload':
					(function () {
						var plugin = commandArgs[1];
						if (bot) {
							if (bot.plugins[plugin]) {
								bot.botPluginDisable(plugin);
								bot.botPluginLoad(plugin, cConnsettings.pluginDir+'/'+plugin+'.js');
							}
						} else {
							term.log('Current connection is dead.');
						}
					})();
					break;
				case 'pluginreloadall':
					(function () {
						function pluginReload(plugin) {
							bot.botPluginDisable(plugin);
							bot.botPluginLoad(plugin, cConnsettings.pluginDir+'/'+plugin+'.js');
						}
						if (bot) {
							for (var plugin in bot.plugins) {
								pluginReload(plugin);
							}
						} else {
							term.log('Current connection is dead.');
						}
					})();
					break;
				case 'pluginload':
					(function () {
						var plugin = commandArgs[1];
						if (bot) {
							bot.botPluginLoad(plugin, cConnsettings.pluginDir+'/'+plugin+'.js');
							cConnsettings.plugins.push(commandArgs[1]);
						} else {
							term.log('Current connection is dead.');
						}
					})();
					break;
				case 'plugindisable':
					(function () {
						var plugin = commandArgs[1];
						if (bot) {
							bot.botPluginDisable(plugin);
							cConnsettings.plugins.arrayValueRemove(plugin);
						} else {
							term.log('Current connection is dead.');
						}
					})();
					break;
				case 'savesettings':
					(function () {
						term.botSettingsSave(null, null, function () {
							term.log('> Settings saved!');
						});
					})();
					break;
				case 'loadsettings':
					(function () {
						term.botSettingsLoad(null, function (data) {
							nBot.settings = data;
							nBot.connSettings = nBot.settings.connections;
							function pluginReload(bot, plugin) {
								var settings = bot.options;
								bot.botPluginDisable(plugin);
								bot.botPluginLoad(plugin, settings.pluginDir+'/'+plugin+'.js');
							}
							for (var connection in nBot.connObjArr) {
								if (nBot.connObjArr[connection]) {
									var bot = nBot.connObjArr[connection];
									bot.options = nBot.connSettings[connection];
									for (var plugin in bot.plugins) {
										pluginReload(bot, plugin);
									}
								}
							}
							term.log('> Settings loaded!');
						});
					})();
					break;
				case 'connectioncreate':
					(function () {
						nBot.connSettings.splice(nBot.connSettings.length, 0, 
							new term.SettingsConstructor.connection({
								connectionName: 'Connection'+nBot.connSettings.length
							})
						);
						term.botSettingsSave(null, null, function () {
							term.log('> Connection created and written to settings');
							term.log('> modify the connection and load the changes using /loadsettings');
							term.log('> then initialize the connection using /connectioninit');
						});
					})();
					break;
				case 'connectiondelete':
					(function () {
						var connectionId = commandArgs[1];
						for (var connection in nBot.connSettings) {
							if (nBot.connSettings[connection].connectionName == connectionId) {
								connectionId = connection;
							}
						}
						nBot.connSettings.splice(connectionId, 1);
						term.log('> Connection deleted');
						term.log('> confirm this by saving settings using /savesettings');
					})();
					break;
				case 'connectioninit':
					(function () {
						var connectionId = commandArgs[1];
						for (var connection in nBot.connSettings) {
							if (nBot.connSettings[connection].connectionName == connectionId) {
								connectionId = connection;
								}
						}
						if (nBot.connObjArr[connectionId]) {
							var bot = nBot.connObjArr[connectionId];
							for (var plugin in bot.plugins) {
								bot.botPluginDisable(plugin);
							}
							nBot.connObjArr[connectionId].kill();
							nBot.connObjArr[connectionId] = null;
						}
						term.botCreateInstance(connectionId);
					})();
					break;
				case 'connectionkill':
					(function () {
						var connectionId = commandArgs[1];
						for (var connection in nBot.connSettings) {
							if (nBot.connSettings[connection].connectionName == connectionId) {connectionId = connection;}
						}
						if (nBot.connObjArr[connectionId]) {
							var bot = nBot.connObjArr[connectionId];
							for (var plugin in bot.plugins) {
								bot.botPluginDisable(plugin);
							}
							nBot.connObjArr[connectionId].kill();
							nBot.connObjArr[connectionId] = null;
						}
					})();
					break;
			}
		}
		if (data && data.charAt(0) != '/') {
			if (bot && !bot.ircConnection.destroyed) {
				term.log('['+connectionName+':'+term.lastChannel+'] '+nBot.connSettings[term.currentConnection].botName+': '+data);
				bot.ircSendCommandPRIVMSG(data, term.lastChannel);
			} else {
				term.log('Current connection is dead.');
			}
		}
	};
	
	term.terminalProcessInput = function (data) {
		if (data == "\x0d") {
			//enter
			if (term.buffer[term.bufferCurrent]) {
				process.stdout.write('\x0a');
				var BufferData = term.buffer[term.bufferCurrent];
				if (term.buffer[term.bufferCurrent] !== "") {
					term.buffer.splice(1, 0, term.buffer[term.bufferCurrent]);
					if (term.bufferCurrent > 0) {
						term.buffer[term.bufferCurrent+1]=term.bufferCurrentUnModifiedState;
					}
					term.buffer.splice((term.bufferMax+1), 1);
				}
				term.bufferCurrent=0;
				term.buffer[0]="";
				term.cursorPositionAbsolute=1;
				term.terminalUpdateBuffer();
				term.terminalProcessLine(BufferData);
			}
		}else if (data == "\x7f") {
			//backspace
			term.buffer[term.bufferCurrent]=
			term.buffer[term.bufferCurrent].substr(0, (term.cursorPositionAbsolute-2))+
			term.buffer[term.bufferCurrent].substr((term.cursorPositionAbsolute-1));
			if (term.cursorPositionAbsolute > 1) {
				term.cursorPositionAbsolute--;
			}
			term.terminalUpdateBuffer();
		}else if (data == "\x1b\x5b\x33\x7e") {
			//del
			term.buffer[term.bufferCurrent]=
			term.buffer[term.bufferCurrent].substr(0, (term.cursorPositionAbsolute-1))+
			term.buffer[term.bufferCurrent].substr((term.cursorPositionAbsolute));
			term.terminalUpdateBuffer();
		}else if (data == "\x1b\x5b\x41") {
			//up arrow
			if (term.bufferCurrent < term.bufferMax && term.buffer[term.bufferCurrent+1] !== undefined) {
				term.bufferCurrent++;
				term.bufferCurrentUnModifiedState = term.buffer[term.bufferCurrent];
				term.cursorPositionAbsolute=term.buffer[term.bufferCurrent].length+1;
				term.terminalUpdateBuffer();
			}
		}else if (data == "\x1b\x5b\x42") {
			//down arrow
			if (term.bufferCurrent > 0) {
				term.bufferCurrent--;
				term.bufferCurrentUnModifiedState = term.buffer[term.bufferCurrent];
				term.cursorPositionAbsolute=term.buffer[term.bufferCurrent].length+1;
				term.terminalUpdateBuffer();
			}
		}else if (data == "\x1b\x5b\x43") {
			//right arrow
			if (term.buffer[term.bufferCurrent].length >= term.cursorPositionAbsolute) {
				term.cursorPositionAbsolute++;
			}
			term.terminalUpdateBuffer();
		}else if (data == "\x1b\x5b\x44") {
			//left arrow
			if (term.cursorPositionAbsolute > 1) {
				term.cursorPositionAbsolute--;
			}
			term.terminalUpdateBuffer();
		}else if (data == "\x03") {
			//^C
			term.log('quitting...');
			setTimeout(function () {term.botKillAllInstances(null, true);process.exit();}, 1000);
			term.botKillAllInstances('stdin received ^C');
		}else{
			data=data.replace(new RegExp('(\\x1b|\\x5b\\x42|\\x5b\\x41|\\x5b\\x44|\\x5b\\x43|\\x03|\\x18|\\x1a|\\x02|\\x01)', 'g'), '');
			
			term.buffer[term.bufferCurrent]=
			term.buffer[term.bufferCurrent].substr(0, (term.cursorPositionAbsolute-1))+
			data+
			term.buffer[term.bufferCurrent].substr((term.cursorPositionAbsolute-1));
			
			term.cursorPositionAbsolute+=data.length;
			term.terminalUpdateBuffer();
		}
	};
	
	term.terminalReadInput = function () {
		var data = process.stdin.read();
		if (data !== null) {
			term.terminalProcessInput(data);
		}
	};
	
	(function () {
		process.stdin.setEncoding('utf8');
		
		if (process.stdin.setRawMode) {
			process.stdin.setRawMode(true);
		}
		
		process.on('exit', function (code) {
			process.stdout.write("\x1b[1G\x1b[2K");
			console.log('Goodbye');
		});
		
		term.terminalUpdateBuffer();
		
		process.stdin.on('readable', term.terminalReadInput);
	})();
}
