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

"use strict";
//variables
var util = require(__dirname+'/util');

//export the constructor
module.exports = ConstructShellInstance;

function ConstructShellInstance(im) {
	//force 'new' object keyword
	if(!(this instanceof ConstructShellInstance)) {
		return new ConstructShellInstance(im);
	}
	
	//shell object
	var shell = this;
	
	shell.currentInstance = 0;
	shell.lastChannel = im.iOpts[shell.currentInstance].channels[0];
	shell.promptInputPrefix = im.options.shellPrompt||'> ';
	shell.promptBufferArr = [""];
	shell.promptBufferCurrent = 0;
	shell.promptBufferMax = 10;
	shell.cursorPositionAbsolute = 1;
	shell.promptBufferCurrentUnModifiedState = "";
	shell.inputCharKeyCodeMap = {//VT220
		"\x0d": "Return",
		"\x7f": "Delete",
		"\x1b[3~": "Remove",
		"\x1b[A": "Up",
		"\x1b[B": "Down",
		"\x1b[C": "Right",
		"\x1b[D": "Left",
		"\x03": "Control_c"
	};
	
	shell.write = function (data) {
		process.stdout.write(data);
	};
	
	shell.log = function (data) {
		shell.write("\x1b[1G\x1b[K");
		shell.write(data);
		shell.write('\x0a');
		shell.updatePrompt();
	};
	
	shell.updatePrompt = function (){
		var promptPrefix = shell.promptInputPrefix;
		var promptPrefixLen = +promptPrefix.length;
		var termColumns = +process.stdout.columns;
		var availColumns = termColumns-promptPrefixLen;
		var promptCursorPos = shell.getPromptCursorPos();
		var promptBuffer = shell.promptBufferArr[shell.promptBufferCurrent];
		var promptData = promptBuffer.substr(promptCursorPos[1], availColumns);
		shell.write("\x1b[1G\x1b[2K");
		shell.write(promptPrefix);
		shell.write(promptData);
		shell.write("\x1b["+promptCursorPos[0]+"G");
	};
	
	shell.getPromptCursorPos = function (){
		var promptPrefixLen = +shell.promptInputPrefix.length;
		var termColumns = +process.stdout.columns;
		var availColumns = termColumns-promptPrefixLen;
		var positionAbsolute = shell.cursorPositionAbsolute-1;
		var offsetCount = Math.floor(positionAbsolute/availColumns);
		var adjustedOffsetCount = Math.floor((positionAbsolute+offsetCount)/availColumns);
		var offsetRemainder = (positionAbsolute+adjustedOffsetCount)%availColumns;
		var postionOffset = adjustedOffsetCount*availColumns-adjustedOffsetCount;
		offsetRemainder+=(1+promptPrefixLen);
		return [offsetRemainder, postionOffset];
	};
	
	shell.processLine = function (data) {
		var commandArgs = util.getArgsFromString(data)[0];
		var options = im.iOpts[shell.currentInstance];
		var connectionName = options.connectionName||shell.currentInstance;
		var bot;
		if (im.iArr[shell.currentInstance]) {
			bot = im.iArr[shell.currentInstance];
		}
		if (commandArgs[0] && commandArgs[0].charAt(0) == '/') {
			switch (commandArgs[0].split('').slice(1).join('')) {
				case 'raw':
					(function () {
						if (bot && !bot.ircConnection.destroyed) {
							bot.ircWriteData(commandArgs[1]);
						} else {
							shell.log('Current connection is dead.');
						}
					})();
					break;
				case 'join':
					(function () {
						var botIsInChannel = false;
						for (var channel in options.channels) {
							if (options.channels[channel] == commandArgs[1]) {
								botIsInChannel = true;
							}
						}
						if (!botIsInChannel) {
							options.channels.push(commandArgs[1]);
						}
					})();
					break;
				case 'part':
					(function () {
						var partReason = "Leaving";
						if (commandArgs[2] !== undefined) {partReason=commandArgs[2];}
						options.channels.remove(commandArgs[1]);
						if (bot && !bot.ircConnection.destroyed) {
							bot.ircSendCommandPART(commandArgs[1], partReason);
						}
					})();
					break;
				case 'say':
					(function () {
						if (commandArgs[2] !== undefined) {
							if (bot && !bot.ircConnection.destroyed) {
								shell.log('['+connectionName+':'+commandArgs[1]+'] '+options.botName+': '+commandArgs[2]);
								bot.ircSendCommandPRIVMSG(commandArgs[2], commandArgs[1]);
							} else {
								shell.log('Current connection is dead');
							}
						}
						shell.lastChannel = commandArgs[1];
					})();
					break;
				case 'quit':
					(function () {
						var quitReason = commandArgs[1]||"Leaving";
						shell.log('> quitting...');
						setTimeout(function () {
							im.killAllInstances();
							process.exit();
						}, 1000);
						im.killAllInstances(quitReason);
					})();
					break;
				case 'connection':
					(function () {
						var bot;
						if (commandArgs[1] !== undefined) {
							var instance;
							if (commandArgs[1].toUpperCase() == 'SET') {
								var iId = commandArgs[2];
								for (instance in im.iOpts) {
									if (im.iOpts[instance].connectionName == iId) {iId = instance;}
								}
								if (im.iArr[iId] !== undefined) {
									shell.currentInstance = iId;
								}
							}
							if (commandArgs[1].toUpperCase() == 'LIST') {
								for (instance in im.iOpts) {
									bot = im.iArr[instance];
									shell.log('> id: '+instance+', name: "'+im.iOpts[instance].connectionName+'", status: '+(bot?(bot.ircConnection.destroyed?'dead':'alive'):'dead'));
								}
							}
						} else {
							bot = im.iArr[shell.currentInstance];
							shell.log('> Current connection id: '+shell.currentInstance+', name: "'+connectionName+'", status: '+(bot?(bot.ircConnection.destroyed?'dead':'alive'):'dead')+'.');
						}
					})();
					break;
				case 'fakemsg':
					(function () {
						if (bot && !bot.ircConnection.destroyed) {
							bot.emitBotEvent('botReceivedPRIVMSG', [
								'shell!shell@shell PRIVMSG shell :'+commandArgs[1],
								['shell', 'shell', 'shell'],
								'PRIVMSG',
								['shell', commandArgs[1]],
								['shell'], commandArgs[1]
							]);
						} else {
							shell.log('Current connection is dead.');
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
						shell.log('> Commands are prefixed with "/", arguments must be in form of strings "" seperated by a space');
						shell.log('> arguments in square brackets "[]" are optional, Vertical bar "|" means "or"');
						shell.log('> /raw "data": write data to current irc connection');
						shell.log('> /join "#channel": join channel on current connection');
						shell.log('> /part "#channel": part channel on current connection');
						shell.log('> /say "#channel" "message": send message to channel on current connection');
						shell.log('> /quit ["reason"]: terminate the bot');
						shell.log('> /connection [LIST|SET ["name"|"id"]]: change current connection using name from settings or id starting from 0');
						shell.log('> /fakemsg "message": emit fake PRIVMSG bot event');
						shell.log('> /evaljs "code": evaluates node.js code');
						shell.log('> /help: print this message');
						shell.log('> /pluginreload "id": reload plugin with id');
						shell.log('> /pluginreloadall: reload all plugins');
						shell.log('> /pluginload "plugin": load a plugin');
						shell.log('> /plugindisable "plugin": disable a loaded plugin');
						shell.log('> /savesettings: save current settings to file');
						shell.log('> /loadsettings: load settings from file (reloads all plugins on all current connections)');
						shell.log('> /connectioncreate: creates new connection entry in settings');
						shell.log('> /connectiondelete ["name"|"id"]: deletes connection entry from settings');
						shell.log('> /connectioninit ["name"|"id"]: starts new bot connection from settings');
						shell.log('> /connectionkill ["name"|"id"]: kills running bot instance');
					})();
					break;
				case 'pluginreload':
					(function () {
						var plugin = commandArgs[1];
						if (bot) {
							if (bot.plugins[plugin]) {
								bot.pluginDisable(plugin);
								bot.pluginLoad(plugin, options.pluginDir+'/'+plugin+'.js');
							}
						} else {
							shell.log('Current connection is dead.');
						}
					})();
					break;
				case 'pluginreloadall':
					(function () {
						function pluginReload(plugin) {
							bot.pluginDisable(plugin);
							bot.pluginLoad(plugin, options.pluginDir+'/'+plugin+'.js');
						}
						if (bot) {
							for (var plugin in bot.plugins) {
								pluginReload(plugin);
							}
						} else {
							shell.log('Current connection is dead.');
						}
					})();
					break;
				case 'pluginload':
					(function () {
						var plugin = commandArgs[1];
						if (bot) {
							bot.pluginLoad(plugin, options.pluginDir+'/'+plugin+'.js');
							options.plugins.push(commandArgs[1]);
						} else {
							shell.log('Current connection is dead.');
						}
					})();
					break;
				case 'plugindisable':
					(function () {
						var plugin = commandArgs[1];
						if (bot) {
							bot.pluginDisable(plugin);
							options.plugins.remove(plugin);
						} else {
							shell.log('Current connection is dead.');
						}
					})();
					break;
				case 'savesettings':
					(function () {
						im.settingsSave(null, null, function () {
							shell.log('> Settings saved!');
						});
					})();
					break;
				case 'loadsettings':
					(function () {
						im.settingsLoad(null, function (data) {
							im.options = data;
							im.iOpts = im.options.connections;
							function pluginReload(bot, plugin) {
								var settings = bot.options;
								bot.pluginDisable(plugin);
								bot.pluginLoad(plugin, settings.pluginDir+'/'+plugin+'.js');
							}
							for (var iId in im.iArr) {
								if (im.iArr[iId]) {
									var bot = im.iArr[iId];
									bot.options = im.iOpts[iId];
									for (var plugin in bot.plugins) {
										pluginReload(bot, plugin);
									}
								}
							}
							shell.log('> Settings loaded!');
						});
					})();
					break;
				case 'connectioncreate':
					(function () {
						im.iOpts.splice(im.iOpts.length, 0,
							new im.SettingsConstructor.connection({
								connectionName: 'Connection'+im.iOpts.length
							})
						);
						im.settingsSave(null, null, function () {
							shell.log('> Connection created and written to settings');
							shell.log('> modify the connection and load the changes using /loadsettings');
							shell.log('> then initialize the connection using /connectioninit');
						});
					})();
					break;
				case 'connectiondelete':
					(function () {
						var iId = commandArgs[1];
						for (var instance in im.iOpts) {
							if (im.iOpts[instance].connectionName == iId) {
								iId = instance;
							}
						}
						im.iOpts.splice(iId, 1);
						shell.log('> Connection deleted');
						shell.log('> confirm this by saving settings using /savesettings');
					})();
					break;
				case 'connectioninit':
					(function () {
						var iId = commandArgs[1];
						for (var instance in im.iOpts) {
							if (im.iOpts[instance].connectionName == iId) {
								iId = instance;
							}
						}
						if (im.iArr[iId]) {
							var bot = im.iArr[iId];
							for (var plugin in bot.plugins) {
								bot.pluginDisable(plugin);
							}
							im.iArr[iId].kill();
							im.iArr[iId] = null;
						}
						im.createInstance(iId);
					})();
					break;
				case 'connectionkill':
					(function () {
						var iId = commandArgs[1];
						for (var instance in im.iOpts) {
							if (im.iOpts[instance].connectionName == iId) {iId = instance;}
						}
						if (im.iArr[iId]) {
							var bot = im.iArr[iId];
							for (var plugin in bot.plugins) {
								bot.pluginDisable(plugin);
							}
							im.iArr[iId].kill();
							im.iArr[iId] = null;
						}
					})();
					break;
			}
		}
		if (data && data.charAt(0) != '/') {
			if (bot && !bot.ircConnection.destroyed) {
				shell.log('['+connectionName+':'+shell.lastChannel+'] '+im.iOpts[shell.currentInstance].botName+': '+data);
				bot.ircSendCommandPRIVMSG(data, shell.lastChannel);
			} else {
				shell.log('Current connection is dead.');
			}
		}
	};
	
	shell.processInput = function (data) {
		if (data == "\x0d") {
			//enter
			if (shell.promptBufferArr[shell.promptBufferCurrent]) {
				shell.write('\x0a');
				var BufferData = shell.promptBufferArr[shell.promptBufferCurrent];
				if (shell.promptBufferArr[shell.promptBufferCurrent] !== "") {
					shell.promptBufferArr.splice(1, 0, shell.promptBufferArr[shell.promptBufferCurrent]);
					if (shell.promptBufferCurrent > 0) {
						shell.promptBufferArr[shell.promptBufferCurrent+1]=shell.promptBufferCurrentUnModifiedState;
					}
					shell.promptBufferArr.splice((shell.promptBufferMax+1), 1);
				}
				shell.promptBufferCurrent=0;
				shell.promptBufferArr[0]="";
				shell.cursorPositionAbsolute=1;
				shell.updatePrompt();
				shell.processLine(BufferData);
			}
		}else if (data == "\x7f") {
			//backspace
			shell.promptBufferArr[shell.promptBufferCurrent]=
			shell.promptBufferArr[shell.promptBufferCurrent].substr(0, (shell.cursorPositionAbsolute-2))+
			shell.promptBufferArr[shell.promptBufferCurrent].substr((shell.cursorPositionAbsolute-1));
			if (shell.cursorPositionAbsolute > 1) {
				shell.cursorPositionAbsolute--;
			}
			shell.updatePrompt();
		}else if (data == "\x1b\x5b\x33\x7e") {
			//del
			shell.promptBufferArr[shell.promptBufferCurrent]=
			shell.promptBufferArr[shell.promptBufferCurrent].substr(0, (shell.cursorPositionAbsolute-1))+
			shell.promptBufferArr[shell.promptBufferCurrent].substr((shell.cursorPositionAbsolute));
			shell.updatePrompt();
		}else if (data == "\x1b\x5b\x41") {
			//up arrow
			if (shell.promptBufferCurrent < shell.promptBufferMax && shell.promptBufferArr[shell.promptBufferCurrent+1] !== undefined) {
				shell.promptBufferCurrent++;
				shell.promptBufferCurrentUnModifiedState = shell.promptBufferArr[shell.promptBufferCurrent];
				shell.cursorPositionAbsolute=shell.promptBufferArr[shell.promptBufferCurrent].length+1;
				shell.updatePrompt();
			}
		}else if (data == "\x1b\x5b\x42") {
			//down arrow
			if (shell.promptBufferCurrent > 0) {
				shell.promptBufferCurrent--;
				shell.promptBufferCurrentUnModifiedState = shell.promptBufferArr[shell.promptBufferCurrent];
				shell.cursorPositionAbsolute=shell.promptBufferArr[shell.promptBufferCurrent].length+1;
				shell.updatePrompt();
			}
		}else if (data == "\x1b\x5b\x43") {
			//right arrow
			if (shell.promptBufferArr[shell.promptBufferCurrent].length >= shell.cursorPositionAbsolute) {
				shell.cursorPositionAbsolute++;
			}
			shell.updatePrompt();
		}else if (data == "\x1b\x5b\x44") {
			//left arrow
			if (shell.cursorPositionAbsolute > 1) {
				shell.cursorPositionAbsolute--;
			}
			shell.updatePrompt();
		}else if (data == "\x03") {
			//^C
			shell.log('quitting...');
			setTimeout(function () {im.killAllInstances();process.exit();}, 1000);
			im.killAllInstances('stdin received ^C');
		}else{
			data=data.replace(new RegExp('(\\x1b|\\x5b\\x42|\\x5b\\x41|\\x5b\\x44|\\x5b\\x43|\\x03|\\x18|\\x1a|\\x02|\\x01)', 'g'), '');
			
			shell.promptBufferArr[shell.promptBufferCurrent]=
			shell.promptBufferArr[shell.promptBufferCurrent].substr(0, (shell.cursorPositionAbsolute-1))+
			data+
			shell.promptBufferArr[shell.promptBufferCurrent].substr((shell.cursorPositionAbsolute-1));
			
			shell.cursorPositionAbsolute+=data.length;
			shell.updatePrompt();
		}
	};
	
	shell.readInput = function () {
		var data = process.stdin.read();
		if (data !== null) {
			shell.processInput(data);
		}
	};
	
	shell.init = function () {
		process.stdin.setEncoding('utf8');
		
		if (process.stdin.setRawMode) {
			process.stdin.setRawMode(true);
		}
		
		process.on('exit', function (code) {
			shell.write("\x1b[1G\x1b[2K");
			console.log('Goodbye');
		});
		
		shell.updatePrompt();
		
		process.stdin.on('readable', shell.readInput);
	};
}
