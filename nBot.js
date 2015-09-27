#!/usr/bin/env node
// nBot, stupid irc bot made for fun
// Copyright (C) 2015  nnnn20430 (nnnn20430@mindcraft.si.eu.org)
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
var http = require('http');
var net = require('net');
var readline = require('readline');
var fs = require('fs');
var util = require('util');
var events = require('events');
var sys = require('sys');
var exec = require('child_process').exec;
var path = require('path');
var vm = require('vm');

var settings;
var connections = [];
var connectionsTmp = [];
var terminalCurrentConnection = 0;

//handle wierd errors
process.on('uncaughtException', function (err) {
	console.log(err.stack);
});

//settings management
var SettingsConstructor = {
	main: function (modified) {
		//force 'new' object keyword
		if(!(this instanceof SettingsConstructor.main)) {
			return new SettingsConstructor.main(modified);
		}
		var attrname;
		this.terminalSupportEnabled = true;
		this.terminalInputPrefix = '>';
		this.ircRelayServerEnabled = true;
		this.ircRelayServerPort = 9977;
		this.debugMessages = false;
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
		this.socks5_host = '';
		this.socks5_port = 1080;
		this.socks5_username = '';
		this.socks5_password = '';
		this.channels = [ '#channel' ];
		this.ircRelayServerEnabled = true;
		this.ircResponseListenerLimit = 30;
		this.ircMultilineMessageMaxLines = 300;
		this.pluginDir = './plugins';
		this.plugins = [ 
			'simpleMsg',
			'commands',
			'connectionErrorResolver'
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
					callback(JSON.parse(data));
				}
			});
		} else if (err.code == "ENOENT"){
			var newSettings = new SettingsConstructor.main({
				connections: [new SettingsConstructor.connection({
					channels: [
						'#nBot',
						'#mindcraft'
					]
				})]
			});
			fs.writeFile(file, JSON.stringify(newSettings, null, '\t'), function (err) {if (err) throw err; callback(newSettings);});
		}
	});
}

function botSettingsSave(file, data, callback) {
	file = file||"settings.json";
	data = data||settings;
	fs.writeFile(file, JSON.stringify(data, null, '\t'), function (err) {
		if (err) throw err;
		if (callback !== undefined) {
			callback();
		}
	});
}

//handle terminal
var terminalLastChannel, terminalBuffer, terminalBufferCurrent, terminalBufferMax, terminalCursorPositionAbsolute, terminalBufferCurrentUnModifiedState;
function terminalLog(data) {
	process.stdout.write("\x1b[1G\x1b[K");
	process.stdout.write(data);
	process.stdout.write('\x0a');
	terminalUpdateBuffer();
}

function terminalUpdateBuffer(){
	var tColumns = (+process.stdout.columns-settings.terminalInputPrefix.length);
	process.stdout.write("\x1b[1G\x1b[2K");
	process.stdout.write(settings.terminalInputPrefix);
	process.stdout.write(terminalBuffer[terminalBufferCurrent].substr(terminalGetCursorPos()[1], tColumns));
	process.stdout.write("\x1b["+(+terminalGetCursorPos()[0])+"G");
}

function terminalGetCursorPos(){
	var tColumns = (+process.stdout.columns-settings.terminalInputPrefix.length);
	var positionAbsolute = terminalCursorPositionAbsolute-1;
	var offsetCount = Math.floor(positionAbsolute/tColumns);
	var adjustedOffsetCount = Math.floor((positionAbsolute+offsetCount)/tColumns);
	var offsetRemainder = (positionAbsolute+adjustedOffsetCount)%tColumns;
	var postionOffset = adjustedOffsetCount*tColumns-adjustedOffsetCount;
	offsetRemainder+=(1+settings.terminalInputPrefix.length);
	return [offsetRemainder, postionOffset];
}

function terminalProcessInput(chunk) {
	var terminalCommandArgs = getArgsFromString(chunk)[0];
	var connectionName = connections[terminalCurrentConnection].connectionName||terminalCurrentConnection;
	if (terminalCommandArgs[0] && terminalCommandArgs[0].charAt(0) == '/') {
		switch (terminalCommandArgs[0].split('').slice(1).join('')) {
			case 'raw':
				(function () {
					if (connectionsTmp[terminalCurrentConnection] &&
					!connectionsTmp[terminalCurrentConnection].ircConnection.destroyed) {
						connectionsTmp[terminalCurrentConnection].ircConnection.write(terminalCommandArgs[1]+'\r\n');
					} else {
						terminalLog('Current connection is dead.');
					}
				})();
				break;
			case 'join':
				(function () {
					var botIsInChannel = false;
					for (var channel in connections[terminalCurrentConnection].channels) {if (connections[terminalCurrentConnection].channels[channel] == terminalCommandArgs[1]) {botIsInChannel = true;}}
					if (!botIsInChannel) {connections[terminalCurrentConnection].channels.arrayValueAdd(terminalCommandArgs[1]);}
				})();
				break;
			case 'part':
				(function () {
					var partReason = "Leaving";
					if (terminalCommandArgs[2] !== undefined) {partReason=terminalCommandArgs[2];}
					connections[terminalCurrentConnection].channels.arrayValueRemove(terminalCommandArgs[1]);
					if (connectionsTmp[terminalCurrentConnection] &&
					!connectionsTmp[terminalCurrentConnection].ircConnection.destroyed) {
						connectionsTmp[terminalCurrentConnection].ircConnection.write('PART '+terminalCommandArgs[1]+' :'+partReason+'\r\n');
					}
				})();
				break;
			case 'say':
				(function () {
					if (terminalCommandArgs[2] !== undefined) {
						if (connectionsTmp[terminalCurrentConnection] &&
						!connectionsTmp[terminalCurrentConnection].ircConnection.destroyed) {
							terminalLog('['+connectionName+':'+terminalCommandArgs[1]+'] '+connections[terminalCurrentConnection].botName+': '+terminalCommandArgs[2]);
							connectionsTmp[terminalCurrentConnection].ircConnection.write('PRIVMSG '+terminalCommandArgs[1]+' :'+terminalCommandArgs[2]+'\r\n');
						} else {
							terminalLog('Current connection is dead');
						}
					}
					terminalLastChannel = terminalCommandArgs[1];
				})();
				break;
			case 'quit':
				(function () {
					var quitReason = terminalCommandArgs[1]||"Leaving";
					terminalLog('> quitting...');
					setTimeout(function () {killAllnBotInstances(null, true);process.exit();}, 1000);
					killAllnBotInstances(quitReason);
				})();
				break;
			case 'connection':
				(function () {
					if (terminalCommandArgs[1] !== undefined) {
						var connection;
						if (terminalCommandArgs[1].toUpperCase() == 'SET') {
							var connectionId = terminalCommandArgs[2];
							for (connection in connections) {
								if (connections[connection].connectionName == connectionId) {connectionId = connection;}
							}
							if (connectionsTmp[connectionId] !== undefined) {
								terminalCurrentConnection = connectionId;
							}
						}
						if (terminalCommandArgs[1].toUpperCase() == 'LIST') {
							for (connection in connections) {
								terminalLog('> id: '+connection+', name: "'+connections[connection].connectionName+'", status: '+(connectionsTmp[connection]?(connectionsTmp[connection].ircConnection.destroyed?'dead':'alive'):'dead'));
							}
						}
					} else {
						terminalLog('> Current connection id: '+terminalCurrentConnection+', name: "'+connections[terminalCurrentConnection].connectionName+'", status: '+(connectionsTmp[terminalCurrentConnection]?(connectionsTmp[terminalCurrentConnection].ircConnection.destroyed?'dead':'alive'):'dead')+'.');
					}
				})();
				break;
			case 'fakemsg':
				(function () {
					if (connectionsTmp[terminalCurrentConnection]) {
						connectionsTmp[terminalCurrentConnection].publicData.botFunctions.emitBotEvent('botReceivedPRIVMSG', ['terminal', 'terminal', 'terminal', 'terminal', 'terminal', terminalCommandArgs[1]]);
					} else {
						terminalLog('Current connection is dead.');
					}
				})();
				break;
			case 'evaljs':
				(function () {
					eval("(function () {"+terminalCommandArgs[1]+"})")();
				})();
				break;
			case 'help':
				(function () {
					terminalLog('> Commands are prefixed with "/", arguments must be in form of strings "" seperated by a space');
					terminalLog('> arguments in square brackets "[]" are optional, Vertical bar "|" means "or"');
					terminalLog('> /raw "data": write data to current irc connection');
					terminalLog('> /join "#channel": join channel on current connection');
					terminalLog('> /part "#channel": part channel on current connection');
					terminalLog('> /say "#channel" "message": send message to channel on current connection');
					terminalLog('> /quit ["reason"]: terminate the bot');
					terminalLog('> /connection [LIST|SET ["name"|"id"]]: change current connection using name from settings or id starting from 0');
					terminalLog('> /fakemsg "message": emit fake PRIVMSG bot event');
					terminalLog('> /evaljs "code": evaluates node.js code');
					terminalLog('> /help: print this message');
					terminalLog('> /pluginreload "id": reload plugin with id');
					terminalLog('> /pluginreloadall: reload all plugins');
					terminalLog('> /pluginload "plugin": load a plugin');
					terminalLog('> /plugindisable "plugin": disable a loaded plugin');
					terminalLog('> /savesettings: save current settings to file');
					terminalLog('> /loadsettings: load settings from file (reloads all plugins on all current connections)');
					terminalLog('> /connectioncreate: creates new connection entry in settings');
					terminalLog('> /connectiondelete ["name"|"id"]: deletes connection entry from settings');
					terminalLog('> /connectioninit ["name"|"id"]: starts new bot connection from settings');
					terminalLog('> /connectionkill ["name"|"id"]: kills running bot instance');
				})();
				break;
			case 'pluginreload':
				(function () {
					if (connectionsTmp[terminalCurrentConnection]) {
						var botObj = connectionsTmp[terminalCurrentConnection];
						var botF = botObj.publicData.botFunctions;
						var settings = botObj.publicData.settings;
						if (botObj.pluginData[terminalCommandArgs[1]]) {
							botF.botPluginDisable(terminalCommandArgs[1]);
							botF.botPluginLoad(terminalCommandArgs[1], settings.pluginDir+'/'+terminalCommandArgs[1]+'.js');
						}
					} else {
						terminalLog('Current connection is dead.');
					}
				})();
				break;
			case 'pluginreloadall':
				(function () {
					function pluginReload(plugin) {
						botF.botPluginDisable(plugin);
						botF.botPluginLoad(plugin, settings.pluginDir+'/'+plugin+'.js');
					}
					if (connectionsTmp[terminalCurrentConnection]) {
						var botObj = connectionsTmp[terminalCurrentConnection];
						var botF = botObj.publicData.botFunctions;
						var settings = botObj.publicData.settings;
						for (var plugin in botObj.pluginData) {
							pluginReload(plugin);
						}
					} else {
						terminalLog('Current connection is dead.');
					}
				})();
				break;
			case 'pluginload':
				(function () {
					if (connectionsTmp[terminalCurrentConnection]) {
						var botObj = connectionsTmp[terminalCurrentConnection];
						var botF = botObj.publicData.botFunctions;
						var settings = botObj.publicData.settings;
						botF.botPluginLoad(terminalCommandArgs[1], settings.pluginDir+'/'+terminalCommandArgs[1]+'.js');
						settings.plugins.arrayValueAdd(terminalCommandArgs[1]);
					} else {
						terminalLog('Current connection is dead.');
					}
				})();
				break;
			case 'plugindisable':
				(function () {
					if (connectionsTmp[terminalCurrentConnection]) {
						var botObj = connectionsTmp[terminalCurrentConnection];
						var botF = botObj.publicData.botFunctions;
						var settings = botObj.publicData.settings;
						botF.botPluginDisable(terminalCommandArgs[1]);
						settings.plugins.arrayValueRemove(terminalCommandArgs[1]);
					} else {
						terminalLog('Current connection is dead.');
					}
				})();
				break;
			case 'savesettings':
				(function () {
					botSettingsSave(null, null, function () {
						terminalLog('> Settings saved!');
					});
				})();
				break;
			case 'loadsettings':
				(function () {
					botSettingsLoad(null, function (data) {
						settings = data;
						connections = settings.connections;
						function pluginReload(botObj, plugin) {
							var botF = botObj.publicData.botFunctions;
							var settings = botObj.publicData.settings;
							botF.botPluginDisable(plugin);
							botF.botPluginLoad(plugin, settings.pluginDir+'/'+plugin+'.js');
						}
						for (var connection in connectionsTmp) {
							if (connectionsTmp[connection]) {
								var botObj = connectionsTmp[connection];
								botObj.publicData.settings = connections[connection];
								botObj.publicData.globalSettings = settings;
								for (var plugin in botObj.pluginData) {
									pluginReload(botObj, plugin);
								}
							}
						}
						terminalLog('> Settings loaded!');
					});
				})();
				break;
			case 'connectioncreate':
				(function () {
					connections.splice(connections.length, 0, 
						new SettingsConstructor.connection({
							connectionName: 'Connection'+connections.length
						})
					);
					botSettingsSave(null, null, function () {
						terminalLog('> Connection created and written to settings');
						terminalLog('> modify the connection and load the changes using /loadsettings');
						terminalLog('> then initialize the connection using /connectioninit');
					});
				})();
				break;
			case 'connectiondelete':
				(function () {
					var connectionId = terminalCommandArgs[1];
					for (var connection in connections) {
						if (connections[connection].connectionName == connectionId) {connectionId = connection;}
					}
					connections.splice(connectionId, 1);
					terminalLog('> Connection deleted');
					terminalLog('> confirm this by saving settings using /savesettings');

				})();
				break;
			case 'connectioninit':
				(function () {
					var connectionId = terminalCommandArgs[1];
					for (var connection in connections) {
						if (connections[connection].connectionName == connectionId) {connectionId = connection;}
					}
					if (connectionsTmp[connectionId]) {
						var botObj = connectionsTmp[connectionId];
						var botF = botObj.publicData.botFunctions;
						for (var plugin in botObj.pluginData) {
							botF.botPluginDisable(plugin);
						}
						connectionsTmp[connectionId].kill();
						connectionsTmp[connectionId] = null;
					}
					nBotConnectionInit(connectionId);
				})();
				break;
			case 'connectionkill':
				(function () {
					var connectionId = terminalCommandArgs[1];
					for (var connection in connections) {
						if (connections[connection].connectionName == connectionId) {connectionId = connection;}
					}
					if (connectionsTmp[connectionId]) {
						var botObj = connectionsTmp[connectionId];
						var botF = botObj.publicData.botFunctions;
						for (var plugin in botObj.pluginData) {
							botF.botPluginDisable(plugin);
						}
						connectionsTmp[connectionId].kill();
						connectionsTmp[connectionId] = null;
					}
				})();
				break;
		}
	}
	if (chunk && chunk.charAt(0) != '/') {
		if (connectionsTmp[terminalCurrentConnection] &&
		!connectionsTmp[terminalCurrentConnection].ircConnection.destroyed) {
			terminalLog('['+connectionName+':'+terminalLastChannel+'] '+connections[terminalCurrentConnection].botName+': '+chunk);
			connectionsTmp[terminalCurrentConnection].ircConnection.write('PRIVMSG '+terminalLastChannel+' :'+chunk+'\r\n');
		} else {
			terminalLog('Current connection is dead.');
		}
	}
}

function initTerminalHandle() {
	terminalLastChannel = connections[terminalCurrentConnection].channels[0];
	terminalBuffer = [""]; terminalBufferCurrent = 0; terminalBufferMax = 10; terminalCursorPositionAbsolute = 1; terminalBufferCurrentUnModifiedState = "";

	process.stdin.setEncoding('utf8');
	process.stdin.setRawMode(true);
	terminalUpdateBuffer();
	
	process.stdin.on('readable', function() {
		var chunk = process.stdin.read();
		//console.log(chunk);
		if (chunk !== null) {
			if (chunk == "\x0d") {
				//enter
				if (terminalBuffer[terminalBufferCurrent]) {
					process.stdout.write('\x0a');
					var BufferData = terminalBuffer[terminalBufferCurrent];
					if (terminalBuffer[terminalBufferCurrent] !== "") {
						terminalBuffer.splice(1, 0, terminalBuffer[terminalBufferCurrent]);
						if (terminalBufferCurrent > 0) {
							terminalBuffer[terminalBufferCurrent+1]=terminalBufferCurrentUnModifiedState;
						}
						terminalBuffer.splice((terminalBufferMax+1), 1);
					}
					terminalBufferCurrent=0;
					terminalBuffer[0]="";
					terminalCursorPositionAbsolute=1;
					terminalUpdateBuffer();
					terminalProcessInput(BufferData);
				}
			}else if (chunk == "\x7f") {
				//backspace
				terminalBuffer[terminalBufferCurrent]=terminalBuffer[terminalBufferCurrent].substr(0, (terminalCursorPositionAbsolute-2))+terminalBuffer[terminalBufferCurrent].substr((terminalCursorPositionAbsolute-1));
				if (terminalCursorPositionAbsolute > 1) {
					terminalCursorPositionAbsolute--;
				}
				terminalUpdateBuffer();
			}else if (chunk == "\x1b\x5b\x41") {
				//up arrow
				if (terminalBufferCurrent < terminalBufferMax && terminalBuffer[terminalBufferCurrent+1] !== undefined) {
					terminalBufferCurrent++;
					terminalBufferCurrentUnModifiedState = terminalBuffer[terminalBufferCurrent];
					terminalCursorPositionAbsolute=terminalBuffer[terminalBufferCurrent].length+1;
					terminalUpdateBuffer();
				}
			}else if (chunk == "\x1b\x5b\x42") {
				//down arrow
				if (terminalBufferCurrent > 0) {
					terminalBufferCurrent--;
					terminalBufferCurrentUnModifiedState = terminalBuffer[terminalBufferCurrent];
					terminalCursorPositionAbsolute=terminalBuffer[terminalBufferCurrent].length+1;
					terminalUpdateBuffer();
				}
			}else if (chunk == "\x1b\x5b\x43") {
				//right arrow
				if (terminalBuffer[terminalBufferCurrent].length >= terminalCursorPositionAbsolute) {
					terminalCursorPositionAbsolute++;
				}
				terminalUpdateBuffer();
			}else if (chunk == "\x1b\x5b\x44") {
				//left arrow
				if (terminalCursorPositionAbsolute > 1) {
					terminalCursorPositionAbsolute--;
				}
				terminalUpdateBuffer();
			}else if (chunk == "\x03") {
				//^C
				terminalLog('quitting...');
				setTimeout(function () {killAllnBotInstances(null, true);process.exit();}, 1000);
				killAllnBotInstances('stdin received ^C');
			}else{
				chunk=chunk.replace(new RegExp('(\\x1b|\\x5b\\x42|\\x5b\\x41|\\x5b\\x44|\\x5b\\x43|\\x03|\\x18|\\x1a|\\x02|\\x01)', 'g'), '');
				terminalBuffer[terminalBufferCurrent]=terminalBuffer[terminalBufferCurrent].substr(0, (terminalCursorPositionAbsolute-1))+chunk+terminalBuffer[terminalBufferCurrent].substr((terminalCursorPositionAbsolute-1));
				terminalCursorPositionAbsolute+=chunk.length;
				terminalUpdateBuffer();
			}
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

Object.defineProperty(String.prototype, "replaceSpecialChars", { 
	value: function(a) {
		return this
			.replace(/#csi;/g, '\x1B[')
			.replace(/#c;/g, '\x03')
			.replace(/#reset;/g, '\x0F')
			.replace(/#underline;/g, '\x1F')
			.replace(/#bold;/g, '\x02')
			.replace(/#italic;/g, '\x16')
			.replace(new RegExp('#x([0-9a-fA-F]{2});', 'g'), function(regex, hex){return hex.fromHex();})
			.replace(new RegExp('#u([0-9a-fA-F]{4});', 'g'), function(regex, hex){return hex.fromUtf8Hex();});
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(Array.prototype, "arrayValueAdd", { 
	value: function(a) {
		this.splice(this.lastIndexOf(this.slice(-1)[0])+1, 0, a);
		return true;
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

//random functions
function encode_utf8(s) {
	var unescape;
	return unescape(encodeURIComponent(s));
}

function decode_utf8(s) {
	var escape;
	return decodeURIComponent(escape(s));
}

//https://gist.github.com/Mottie/7018157
function expandIPv6Address(address) {
	var fullAddress = "";
	var expandedAddress = "";
	var validGroupCount = 8;
	var validGroupSize = 4;
	var i;

	var ipv4 = "";
	var extractIpv4 = /([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/;
	var validateIpv4 = /((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})/;

	// look for embedded ipv4
	if(validateIpv4.test(address))
	{
		groups = address.match(extractIpv4);
		for(i=1; i<groups.length; i++)
		{
			ipv4 += ("00" + (parseInt(groups[i], 10).toString(16)) ).slice(-2) + ( i==2 ? ":" : "" );
		}
		address = address.replace(extractIpv4, ipv4);
	}

	if(address.indexOf("::") == -1) // All eight groups are present.
		fullAddress = address;
	else // Consecutive groups of zeroes have been collapsed with "::".
	{
		var sides = address.split("::");
		var groupsPresent = 0;
		for(i=0; i<sides.length; i++)
		{
			groupsPresent += sides[i].split(":").length;
		}
		fullAddress += sides[0] + ":";
		for(i=0; i<validGroupCount-groupsPresent; i++)
		{
			fullAddress += "0000:";
		}
		fullAddress += sides[1];
	}
	var groups = fullAddress.split(":");
	for(i=0; i<validGroupCount; i++)
	{
		while(groups[i].length < validGroupSize)
		{
			groups[i] = "0" + groups[i];
		}
		expandedAddress += (i!=validGroupCount-1) ? groups[i] + ":" : groups[i];
	}
	return expandedAddress;
}

//misc functions

//misc functions: get shell like arguments from a string
function getArgsFromString(str) {
	var strArray = str.split('');
	var strARGS = [];
	var strARGC = 0;
	var strChar = '';
	var isString = false;
	var escape = false;
	var escaped = false;
	
	function addToArgs(str) {
		if (!strARGS[strARGC]) {
			strARGS[strARGC] = '';
		}
		strARGS[strARGC] += str;
	}
	
	for (strChar in strArray) {
		if (escaped) {escaped = false;}
		if (escape) {escape = false; escaped = true;}
		switch (strArray[strChar]) {
			case '\\':
				if (!escaped) {
					escape = true;
				} else {
					addToArgs('\\');	
				}
				break;
			case '"':
				if (!escaped) { 
					if (!isString) {
						isString = true;
					} else {
						isString = false;
					}
				} else {
					addToArgs('"');
				}
				break;
			case ' ':
				if (!isString) {
					strARGC++;
				} else if (isString) {
					if (escaped) {addToArgs('\\');}
					addToArgs(' ');
				}
				break;
			default:
				if (escaped) {addToArgs('\\');}
				addToArgs(strArray[strChar]);
		}
	}
	return [strARGS, strARGC];
}

//misc functions: get shell like arguments from a string using regex
function getArgsFromStringRegex(str) {
	var strARGS = [], strARGC = 0, strARG, strARGRegex = new RegExp('(?:(?:(?:")+((?:(?:[^\\\\"]+(?=(?:"|\\\\"|\\\\)))(?:(?:(?:\\\\)*(?!"))?(?:\\\\")?)*)+)(?:"))+|([^ ]+)+)+(?: )?', 'g');
	while ((strARG = strARGRegex.exec(str)) !== null) {if(strARG[1] !== undefined){strARGS[strARGC]=strARG[1].replace(new RegExp('\\\\"', 'g'), '"');}else{strARGS[strARGC]=strARG[2];}strARGC++;}
	return [strARGS, strARGC];
}

//misc functions: check if input is only numbers
function isNumeric(n) {
	return !isNaN(parseFloat(n)) && isFinite(n);
}

//misc functions: irc relay
var ircRelayServerEmitter = new events.EventEmitter(); ircRelayServerEmitter.setMaxListeners(0);
function ircRelayConnectonAddWriteListener(c) {
	ircRelayServerEmitter.once('write', function (data) {
		if (c.writable) {
			ircRelayConnectonAddWriteListener(c);
			c.write(data);
		} else if (c.writable === false) {c.end(); c.destroy();}
	});
}

function ircRelayServerInit(){
	var server = net.createServer(function(c) { //'connection' listener
		var clientAddr = c.remoteAddress, clientPort = c.remotePort, pingInterval, pingTimeout = null;
		c.setEncoding('utf8');
		//c.setTimeout(60*1000);
		c.on('data', function(chunk) {
			chunk = chunk.replace(/\r\n/g, '\n');
			if (chunk.toUpperCase() == 'PONG\n') {clearTimeout(pingTimeout); pingTimeout = null;}
		});
		c.on('error', function (e) {c.end(); c.destroy(); debugLog('irc relay client "'+clientAddr+':'+clientPort+'" connection error');});
		c.on('timeout', function (e) {c.end(); c.destroy(); debugLog('irc relay client "'+clientAddr+':'+clientPort+'" connection timed out');});
		c.on('end', function() {
			c.end();
		});
		c.on('close', function() {
			clearInterval(pingInterval);
			clearTimeout(pingTimeout);
			debugLog('irc relay client "'+clientAddr+':'+clientPort+'" socket closed');
		});
		ircRelayConnectonAddWriteListener(c);
		pingInterval = setInterval(function () {if (pingTimeout === null) {c.write('PING\n'); pingTimeout = setTimeout(function () {c.end(); c.destroy(); debugLog('irc relay client "'+clientAddr+':'+clientPort+'" ping timed out');}, 30*1000);}}, 10*1000);
		debugLog('client "'+clientAddr+':'+clientPort+'" connected to irc relay');
	});
	server.listen(settings.ircRelayServerPort, function() { //'listening' listener
		debugLog('irc relay server bound!');
	});
}

//misc functions: kill all nBot instances
function killAllnBotInstances(reason, force) {
	reason = reason||'Leaving';
	force = force||false;
	var connection;
	for (connection in connectionsTmp) {
		if (connectionsTmp[connection]) {
			var botObj = connectionsTmp[connection];
			var botF = botObj.publicData.botFunctions;
			for (var plugin in botObj.pluginData) {
				botF.botPluginDisable(plugin);
			}
		}
	}
	if (force === false) {
		for (connection in connectionsTmp) {
			if (connectionsTmp[connection] &&
			!connectionsTmp[connection].ircConnection.destroyed) {
				connectionsTmp[connection].ircConnection.write('QUIT :'+reason+'\r\n');
			} else {
				connectionsTmp[connection].kill();
			}
		}
	}
	if (force === true) {
		for (connection in connectionsTmp) {
			if (connectionsTmp[connection]) {
				connectionsTmp[connection].kill();
			}
		}
	}
}

//misc functions: handle irc bot event from bot instance
var instanceBotEventHandleObj = {
	PRIVMSG: function (connection, data) {
		var nick = data[1].split('!')[0], 
			to = data[4].split(' ')[0], 
			message = data[5]?data[5]:data[4].split(' ')[1];
		var connectionName = connections[connection].connectionName||connection;
		debugLog('['+connectionName+':'+to+'] <'+nick+'>: '+message);
		if (settings.ircRelayServerEnabled && connections[connection].ircRelayServerEnabled) {
			ircRelayServerEmitter.emit('write', connectionName+':'+data[1]+':'+to+':'+message+'\n');
		}
	},
	NOTICE: function (connection, data) {
		var nick = data[1].split('!')[0], 
			to = data[4].split(' ')[0], 
			message = data[5]?data[5]:data[4].split(' ')[1];
		var connectionName = connections[connection].connectionName||connection;
		debugLog('[NOTICE('+connectionName+':'+to+')] <'+nick+'>: '+message);
		if (settings.ircRelayServerEnabled && connections[connection].ircRelayServerEnabled) {
			ircRelayServerEmitter.emit('write', connectionName+':'+data[1]+':'+to+':'+message+'\n');
		}
	}
};

//misc functions: simple debug log
function debugLog(data) {
	if (settings.terminalSupportEnabled) {
		terminalLog(data);
	} else if (settings.debugMessages) {
		process.stdout.write(data+'\x0a');
	}
} 

//misc functions: handle debug message event from bot instance
function handleBotDebugMessageEvent(connection, data) {
	var connectionName = connections[connection].connectionName||connection;
	if (settings.terminalSupportEnabled) {
		terminalLog(connectionName+"-> "+data);
	} else if (settings.debugMessages) {
		process.stdout.write(connectionName+"-> "+data+'\x0a');
	}
}

//misc functions: start a nBot connection for settings using id
function nBotConnectionInit(connectionId) {
	/*jshint -W055 */
	function handleBotEvent(event) {
		switch (event.eventName) {
			case 'botReceivedPRIVMSG': instanceBotEventHandleObj.PRIVMSG(connectionId, event.eventData); break;
			case 'botReceivedNOTICE': instanceBotEventHandleObj.NOTICE(connectionId, event.eventData); break;
		}
	}
	function handlebotDebugMessage(data) {
		handleBotDebugMessageEvent(connectionId, data);
	}
	connectionsTmp[connectionId]=new Create_nBot_instance(connections[connectionId], settings);
	connectionsTmp[connectionId].init();
	connectionsTmp[connectionId].botEventsEmitter.on('botEvent', handleBotEvent);
	connectionsTmp[connectionId].botEventsEmitter.on('botDebugMessage', handlebotDebugMessage);
}

//main bot class
function Create_nBot_instance(settings, globalSettings) {
	
	//force 'new' object keyword
	if(!(this instanceof Create_nBot_instance)) {
		return new Create_nBot_instance(settings, globalSettings);
	}
	
	//variables
	var ircConnection;
	var ircBotHost = "";
	var ircChannelUsers = {};
	var emitter = new events.EventEmitter(); emitter.setMaxListeners(0);
	var nBotObject = this;
	
	//bot variable object
	var botV = {
		ircSupportedUserModesArray: [
			['o', '@'],
			['v', '+']
		],
		ircNetworkServers: [],
		ircResponseListenerObj: {},
		ircResponseListenerLimit: settings.ircResponseListenerLimit||30
	};
	
	//bot functions object
	var botF = {
		//exposed local functions
		botSettingsLoad: botSettingsLoad,
		botSettingsSave: botSettingsSave,
		getArgsFromString: getArgsFromString,
		isNumeric: isNumeric,
		
		//misc bot functions
		
		//misc bot functions: parse irc message line
		ircParseMessageLine: function (message) {
			var prefix = '';
			var command = '';
			var params = '';
			var middleParams = '';
			var trailingParams = '';
			var loops = 0;
			
			prefix = message.charAt(0) == ':' ? message.substr(1, message.indexOf(' ')-1) : '';
			command = message.substr((prefix ? ':'+prefix+' ' : '').length, message.substr((prefix ? ':'+prefix+' ' : '').length).indexOf(' '));
			params = message.substr(((prefix ? ':'+prefix+' ' : '')+command+' ').length);
			middleParams = params.substr(0, (params.indexOf(':') != -1 ? params.indexOf(':') : params.length)).trim();
			trailingParams = params.indexOf(':') != -1 ? params.substr(params.indexOf(':')+1) : '';
			
			return [message, prefix, command, params, middleParams, trailingParams];
		},
		
		//misc bot functions: join missing channels
		ircJoinMissingChannels: function (data) {
			var channels = '';
			for (var line in data[1]) {
				if (data[1][line][2] == 319) {
					channels += data[1][line][5].replace(/[^ #]{0,1}#/g, '#');
				}
			}
			var channelArray = channels.split(' ');
			var missingChannels=settings.channels.diff(channelArray);
			for (var channel in missingChannels){
				if(settings.channels.hasOwnProperty(channel)){
					botF.debugMsg("joining channel: "+missingChannels[channel]);
					botF.ircSendCommandJOIN(missingChannels[channel]);
				}
				
			}
		},
		
		//misc bot functions: update tracked user data in channel
		ircUpdateUsersInChannel: function (channel, callback) {
			function ircUpdateTrackedUsersFromWhoMessage(data) {
				var line;
				var parsedData = {};
				var params;
				for (line in data[1]) {
					if (data[1][line][2] == 352) {
						params = data[1][line][3].split(' ');
						if (!parsedData[params[1]]) {parsedData[params[1]] = {};}
						parsedData[params[1]][params[5]] = {
							user: params[2],
							host: params[3],
							server: params[4],
							isHere: params[6].charAt(0) == 'H' ? true : false,
							isGlobalOP: params[6].charAt(1) == '*' ? true : false,
							mode: botF.ircModePrefixConvert('mode', (params[6].charAt(1) == '*' ? params[6].substr(2) : params[6].substr(1))),
							realname: data[1][line][5]
						};
					}
				}
				for (var channel in parsedData) {
					var newChannelData = {};
					if (ircChannelUsers[channel] === undefined ) {
							ircChannelUsers[channel] = {};
					}
					for (var nick in parsedData[channel]) {
						newChannelData[nick] = {};
						if (ircChannelUsers[channel][nick] !== undefined ) {
							newChannelData[nick] = ircChannelUsers[channel][nick];
						}
						for (var attrname in parsedData[channel][nick]) {
							newChannelData[nick][attrname]=parsedData[channel][nick][attrname];
						}
					}
					ircChannelUsers[channel] = newChannelData;
				}
				if(callback !== undefined) {callback(parsedData);}
			}
			botF.ircSendCommandWHO(channel, function (data) {ircUpdateTrackedUsersFromWhoMessage(data);});
		},
		
		//misc bot functions: handle post connection registation 
		ircPostConnectionRegistrationHandle: function () {
			var ircIntervalUpdate;
			botF.debugMsg('connected to irc server!');
			botF.ircSendCommandWHOIS(settings.botName, function (data) {
				botF.ircJoinMissingChannels(data);
			});
			ircIntervalUpdate = setInterval(function () {
				botF.ircSendCommandWHOIS(settings.botName, 
				function (data) {
					botF.ircJoinMissingChannels(data);
				});
			}, settings.botUpdateInterval||10000);
			nBotObject.ircConnection.once('close', function() {
				clearInterval(ircIntervalUpdate);
			});
			botF.ircWriteData('LINKS');
		},
		
		//misc bot functions: emit debug message event
		debugMsg: function (data) {
			var botEvents = nBotObject.botEventsEmitter;
			if (botEvents.listeners('botDebugMessage').length) {
				botEvents.emit('botDebugMessage', data);
			} else {
				debugLog(data);
			}
		},
		
		//misc bot functions: emit botEvent event
		emitBotEvent: function (name, data) {
			try {
				nBotObject.botEventsEmitter.emit('botEvent', {eventName: name, eventData: data});
			} catch (e) {
				botF.debugMsg('Error when emitting "botEvent" event with name "'+name+'": ('+e+')');
			}
		},
		
		//misc bot functions: load a plugin
		botPluginLoad: function (id, pluginPath) {
			pluginPath = path.resolve(pluginPath);
			function pluginAddBotEventListener(id) {
				nBotObject.botEventsEmitter.once('botEvent', function (data) {
					if (nBotObject.pluginData[id] && nBotObject.pluginData[id].botEvent) {
						if (!(data.eventName == 'botPluginDisableEvent' && data.eventData == id)) {
							pluginAddBotEventListener(id);
						}
						try {
							nBotObject.pluginData[id].botEvent(data);
						} catch (e) {
							botF.debugMsg('Error happened when passing botEvent "'+data.eventName+'" to plugin "'+id+'": ('+e+')');
						}
					}
				});
			}
			(function () {
				try {
					if (nBotObject.pluginData[id]) {
						botF.debugMsg('Plugin "'+id+'" is already registered, trying to disable before attempting to load...');
						botF.botPluginDisable(id);
					}
					nBotObject.pluginData[id] = require(pluginPath);
					nBotObject.pluginData[id].main({id: id, botObj: nBotObject});
					if (nBotObject.pluginData[id].botEvent) {
						pluginAddBotEventListener(id);
					}
					//Do not cache plugins
					if (require.cache && require.cache[pluginPath]) {
						delete require.cache[pluginPath];
					}
				} catch (e) {
					botF.debugMsg('Error happened when loading plugin "'+id+'": ('+e+')');
				}
			})();
		},
		
		//misc bot functions: disable a plugin
		botPluginDisable: function (id) {
			try {
				botF.emitBotEvent('botPluginDisableEvent', id);
				delete nBotObject.pluginData[id];
			} catch (e) {
				botF.debugMsg('Error happened when disabling plugin "'+id+'": ('+e+')');
			}
		},
		
		//misc bot functions: convert between modes and prefixes
		ircModePrefixConvert: function (convertTo, str) {
			var strArray = str.split('');
			var strChar;
			var mode;
			switch (convertTo) {
				case 'prefix':
					for (mode in botV.ircSupportedUserModesArray) {
						for (strChar in strArray) {
							if (strArray[strChar] == botV.ircSupportedUserModesArray[mode][0]) {
								strArray[strChar] = botV.ircSupportedUserModesArray[mode][1];
							}
						}
					}
					break;
				case 'mode':
					for (mode in botV.ircSupportedUserModesArray) {
						for (strChar in strArray) {
							if (strArray[strChar] == botV.ircSupportedUserModesArray[mode][1]) {
								strArray[strChar] = botV.ircSupportedUserModesArray[mode][0];
							}
						}
					}
					break;
			}
			return strArray.join('');
		},
		
		//misc bot functions: emit irc response to listeners
		ircResponseListenerEmit: function (command, data) {
			var newArray;
			var listenerObj;
			var save;
			for (var id in botV.ircResponseListenerObj) {
				newArray = [];
				for (var listener in botV.ircResponseListenerObj[id]) {
					listenerObj = botV.ircResponseListenerObj[id][listener];
					save = true;
					if (listenerObj.command == command) {
						try {
							if (listenerObj.condition(data) === true) {
								try {
									listenerObj.handle(data);
									save = false;
								} catch (e) {
									botF.debugMsg('Error when emitting irc response command "'+command+'" event to listener "'+id+'": ('+e+')');
								}
							}
						} catch (e) {
							botF.debugMsg('Error checking irc response event condition for command "'+command+'" listener "'+id+'": ('+e+')');
						}
					}
					if (botF.isNumeric(listenerObj.ttl)) {
						if (listenerObj.ttl <= 0) {
							save = false;
						} else {
							listenerObj.ttl--;
						}
					}
					if (save) {
						newArray.arrayValueAdd(listenerObj);
					}
				}
				botV.ircResponseListenerObj[id] = newArray;
			}
		},
		
		//misc bot functions: add irc response listener
		ircResponseListenerAdd: function (id, command, condition, handle, ttl) {
			var response = false;
			if (id && command && condition && handle) {
				if (!(botV.ircResponseListenerObj[id] instanceof Array)) {
					botV.ircResponseListenerObj[id] = [];
				}
				botV.ircResponseListenerObj[id].arrayValueAdd({
					command: command,
					condition: condition,
					handle: handle,
					ttl: ttl
				});
				if (botV.ircResponseListenerObj[id].length >
				botV.ircResponseListenerLimit) {
					botV.ircResponseListenerObj[id].splice(0, 1);
				}
				response = true;
			}
			return response;
		},
		
		//misc bot functions: remove irc response listener(s)
		ircResponseListenerRemove: function (id, command, condition, handle) {
			var response = false;
			var newArray;
			var listenerObj;
			var matchNeed;
			var matched;
			var save;
			if (id && botV.ircResponseListenerObj[id]) {
				if (command || condition || handle) {
					for (var listener in botV.ircResponseListenerObj[id]) {
						listenerObj = botV.ircResponseListenerObj[id][listener];
						matchNeed = 0;
						matched = 0;
						save = true;
						if (command) {matchNeed++;}
						if (condition) {matchNeed++;}
						if (handle) {matchNeed++;}
						if (listenerObj.command == command) {
							matched++;
						}
						if (listenerObj.condition == condition) {
							matched++;
						}
						if (listenerObj.handle == handle) {
							matched++;
						}
						if (matched == matchNeed) {save = false;}
						if (save) {
							newArray.arrayValueAdd(listenerObj);
						}
					}
					botV.ircResponseListenerObj[id] = newArray;
				} else {
					delete botV.ircResponseListenerObj[id];
				}
			}
			return response;
		},
		
		//write raw data
		ircWriteData: function (data) {
			ircConnection.write(data+'\r\n');
		},
		
		//irc command functions
		ircSendCommandPRIVMSG: function (data, to, timeout, forceTimeout){
			var command = "";
			command += ":";
			command += settings.botName;
			command += "!";
			command += settings.botName;
			command += "@"+ircBotHost;
			command += " PRIVMSG ";
			command += to;
			command += " :\r\n";
			var msgLength = 512-getBytes(command);
			var dataArray = ((''+data).split('')), stringArray = [''];
			var count = 0;
			var c = ircConnection;
			var length;
			timeout=timeout||1000;
			function getBytes(string){
				return Buffer.byteLength(string, 'utf8');
			}
			function writeData(data, to, count, timeout) {
				setTimeout(function() {
					c.write('PRIVMSG '+to+' :'+data[count]+'\r\n');
					count++;
					if (data[count] !== undefined) {
						writeData(data, to, count, timeout);
					}
				}, timeout);
			}
			for (var char in dataArray) {
				if (dataArray[char] == '\x0a') {
					count++;
					stringArray[count] = '';
					dataArray[char] = '';
				}
				length = getBytes(stringArray[count]+dataArray[char]);
				if (length > msgLength) {
					count++;
					stringArray[count] = '';
				}
				stringArray[count] += dataArray[char];
			}
			if (!forceTimeout) {
				if (count <= 1) {timeout=0;}
			}
			writeData(stringArray, to, 0, timeout);
		},
		
		ircSendCommandNOTICE: function (data, to, timeout, forceTimeout){
			var command = "";
			command += ":";
			command += settings.botName;
			command += "!";
			command += settings.botName;
			command += "@"+ircBotHost;
			command += " NOTICE ";
			command += to;
			command += " :\r\n";
			var msgLength = 512-getBytes(command);
			var dataArray = ((''+data).split('')), stringArray = [''];
			var count = 0;
			var c = ircConnection;
			var length;
			timeout=timeout||1000;
			function getBytes(string){
				return Buffer.byteLength(string, 'utf8');
			}
			function writeData(data, to, count, timeout) {
				setTimeout(function() {
					c.write('NOTICE '+to+' :'+data[count]+'\r\n');
					count++;
					if (data[count] !== undefined) {
						writeData(data, to, count, timeout);
					}
				}, timeout);
			}
			for (var char in dataArray) {
				if (dataArray[char] == '\x0a') {
					count++;
					stringArray[count] = '';
					dataArray[char] = '';
				}
				length = getBytes(stringArray[count]+dataArray[char]);
				if (length > msgLength) {
					count++;
					stringArray[count] = '';
				}
				stringArray[count] += dataArray[char];
			}
			if (!forceTimeout) {
				if (count <= 1) {timeout=0;}
			}
			writeData(stringArray, to, 0, timeout);
		},
		
		ircSendCommandWHOIS: function (user, callback) {
			ircConnection.write('WHOIS '+user+'\r\n');
			botF.ircResponseListenerAdd('core', '311', function (data) {
				if (data[1][0][3].split(' ')[1] == user) {return true;}
			}, function (data) {
				if (callback !== undefined) {callback(data);}
			}, 10);
		},
		
		ircSendCommandWHO: function (channel, callback) {
			ircConnection.write('WHO '+channel+'\r\n');
			botF.ircResponseListenerAdd('core', '352', function (data) {
				if (data[1][0][3].split(' ')[1] == channel) {
					return true;
				}
			}, function (data) {
				if (callback !== undefined) {callback(data);}
			}, 10);
		},
		
		ircSendCommandJOIN: function (channel) {
			ircConnection.write('JOIN '+channel+'\r\n');
			//should not do this before i actualy join
			//botF.ircUpdateUsersInChannel(channel);
		},
		
		ircSendCommandPART: function (channel, reason) {
			reason = reason||"Leaving";
			ircConnection.write('PART '+channel+' :'+reason+'\r\n');
		},
		
		ircSendCommandQUIT: function (reason) {
			reason = reason||"Leaving";
			ircConnection.write('QUIT :'+reason+'\r\n');
		},
		
		ircSendCommandMODE: function (target, mode) {
			ircConnection.write('QUIT '+target+' '+mode+'\r\n');
		},
		
		//irc response handle functions
		ircReceiveHandlePRIVMSG: function (data) {
			botF.emitBotEvent('botReceivedPRIVMSG', data);
			botF.ircResponseListenerEmit('PRIVMSG', data);
		},
		
		ircReceiveHandleNOTICE: function (data) {
			botF.emitBotEvent('botReceivedNOTICE', data);
			botF.ircResponseListenerEmit('NOTICE', data);
		},
		
		ircReceiveHandleJOIN: function (data) {
			botF.emitBotEvent('botReceivedJOIN', data);
			botF.ircResponseListenerEmit('JOIN', data);
			var nick = data[1].split('!')[0];
			if (nick != settings.botName){
				botF.ircUpdateUsersInChannel(data[5]||data[3]);
			} else {
				//should update on bot join too ...
				botF.ircUpdateUsersInChannel(data[5]||data[3]);
			}
		},
		
		ircReceiveHandlePART: function (data) {
			botF.emitBotEvent('botReceivedPART', data);
			botF.ircResponseListenerEmit('PART', data);
			var nick = data[1].split('!')[0];
			if (nick != settings.botName){
				if (ircChannelUsers[data[5]||data[3]] && ircChannelUsers[data[5]||data[3]][nick]) {
					delete ircChannelUsers[data[5]||data[3]][nick];
				}
			}
		},
		
		ircReceiveHandleQUIT: function (data) {
			botF.emitBotEvent('botReceivedQUIT', data);
			botF.ircResponseListenerEmit('QUIT', data);
			var nick = data[1].split('!')[0];
			if (nick != settings.botName){
				for (var channel in ircChannelUsers) {
					if (ircChannelUsers[channel][nick] !== undefined) {
						delete ircChannelUsers[channel][nick];
					}
				}
			}
		},
		
		ircReceiveHandleMODE: function (data) {
			botF.emitBotEvent('botReceivedMODE', data);
			botF.ircResponseListenerEmit('MODE', data);
			var modeParams = data[3].split(' ');
			
			if (modeParams[0].charAt(0) == '#') {
				var channel = modeParams[0];
				var modes = modeParams[1].split(/(\-|\+)/g);
				var modeparams = modeParams.slice(2);
				var mode, oModes, user;
				
				for (var operation in modes) {
					switch (modes[operation]) {
						case '+':
							oModes = modes[+operation+1].split('');
							for (mode in oModes) {
								user = modeparams.splice(0, 1);
								if (ircChannelUsers[channel] && ircChannelUsers[channel][user]) {
									ircChannelUsers[channel][user].mode += botF.ircModePrefixConvert('mode', oModes[mode]);
								}
							}	
							break;
						case '-':
							oModes = modes[+operation+1].split('');
							for (mode in oModes) {
								user = modeparams.splice(0, 1);
								if (ircChannelUsers[channel] && ircChannelUsers[channel][user]) {
									ircChannelUsers[channel][user].mode = ircChannelUsers[channel][user].mode.split(botF.ircModePrefixConvert('mode', oModes[mode])).join('');
								}
							}	
							break;
					}
				}
			}
		},
		
		ircReceiveHandleNICK: function (data) {
			botF.emitBotEvent('botReceivedNICK', data);
			botF.ircResponseListenerEmit('NICK', data);
			var nick = data[1].split('!')[0];
			var newnick = data[3];
			if (nick == settings.botName){
				settings.botName = newnick;
			}
			for (var channel in ircChannelUsers) {
				if (ircChannelUsers[channel][nick] !== undefined) {
					ircChannelUsers[channel][newnick]=ircChannelUsers[channel][nick];
					delete ircChannelUsers[channel][nick];
				}
			}
		},
		
		ircReceiveHandleKICK: function (data) {
			botF.emitBotEvent('botReceivedKICK', data);
			botF.ircResponseListenerEmit('KICK', data);
			var by = data[1].split('!')[0];
			var channel = data[3].split(' ')[0];
			var nick = data[3].split(' ')[1];
			if (nick != settings.botName){
				if (ircChannelUsers[channel] && ircChannelUsers[channel][nick]) {
					delete ircChannelUsers[channel][nick];
				}
			}
		},
		
		ircReceiveHandleTOPIC: function (data) {
			botF.emitBotEvent('botReceivedTOPIC', data);
			botF.ircResponseListenerEmit('TOPIC', data);
		},
		
		ircReceiveHandleKILL: function (data) {
			botF.emitBotEvent('botReceivedKILL', data);
			botF.ircResponseListenerEmit('KILL', data);
		},
		
		ircReceiveNumHandle005: function (data) {//RPL_ISUPPORT
			botF.emitBotEvent('botReceivedNum005', data);
			botF.ircResponseListenerEmit('005', data);
			var params = data[1][0][3].split(' ');
			for (var param in params) {
				var match = params[param].match(/([A-Z]+)=(.*)/);
				if (match) {
					switch (match[1]) {
						case 'CHANMODES':
							var modeData = match[2].split(',');
							botV.ircSupportedChanModes = {'A': modeData[0], 'B': modeData[1], 'C': modeData[2], 'D': modeData[3]};
						break;
						case 'PREFIX':
							var prefixData = match[2].match(/\((.*?)\)(.*)/);
							var userModeArray = [];
							for (var userMode in prefixData[1].split('')) {
								userModeArray.arrayValueAdd([prefixData[1].split('')[userMode], prefixData[2].split('')[userMode]]);
							}
							botV.ircSupportedUserModesArray = userModeArray;
						break;
					}
				}
			}
		},
		
		ircReceiveNumHandle311: function (data) {//RPL_WHOISUSER
			botF.emitBotEvent('botReceivedNum311', data);
			botF.ircResponseListenerEmit('311', data);
			var params = data[1][0][3].split(' ');
			if (params[1] == settings.botName) {ircBotHost=params[3];}
		},
		
		ircReceiveNumHandle352: function (data) {//RPL_WHOREPLY
			botF.emitBotEvent('botReceivedNum352', data);
			botF.ircResponseListenerEmit('352', data);
		},
		
		ircReceiveNumHandle353: function (data) {//RPL_NAMREPLY
			botF.emitBotEvent('botReceivedNum353', data);
			botF.ircResponseListenerEmit('353', data);
		},
		
		ircReceiveNumHandle364: function (data) {//RPL_LINKS
			botF.emitBotEvent('botReceivedNum364', data);
			botF.ircResponseListenerEmit('364', data);
			botV.ircNetworkServers = [];
			var parsedData, line, params;
			for (line in data[1]) {
				botV.ircNetworkServers[line] = {};
				params = data[1][line][3].split(' ');
				botV.ircNetworkServers[line].mask = params[1];
				botV.ircNetworkServers[line].server = params[2];
				botV.ircNetworkServers[line].hop = (params[3].charAt(0) == ':' ? params[3].substr(1) : params[3]);
				botV.ircNetworkServers[line].info = data[1][line][5].split(' ').slice(1).join(' ');
			}
		},
		
		//main irc data receiving function
		ircDataReceiveHandle: function (data) {
			botF.emitBotEvent('botReceivedDataRAW', data);
			var ircMessageLines = data.split('\r\n');
			
			function ircCommandHandle(data) {
				if (botF['ircReceiveHandle'+data[2]] !== undefined) {
					botF['ircReceiveHandle'+data[2]](data);
				}
			}
			
			function ircNumericHandle(data) {
				botV.ircNumericMessageHandles = {
					'005': {endNumeric: '005', messageHandle: botF.ircReceiveNumHandle005},
					'311': {endNumeric: '318', messageHandle: botF.ircReceiveNumHandle311},
					'352': {endNumeric: '315', messageHandle: botF.ircReceiveNumHandle352},
					'353': {endNumeric: '366', messageHandle: botF.ircReceiveNumHandle353},
					'364': {endNumeric: '365', messageHandle: botF.ircReceiveNumHandle364}
				};
				
				if (botV.ircUnfinishedMultilineMessage !== undefined) {
					botV.ircUnfinishedMultilineMessage[1][botV.ircUnfinishedMultilineMessage[2]] = data;
					botV.ircUnfinishedMultilineMessage[2]++;
				} else if (botV.ircNumericMessageHandles[data[2]] !== undefined) {
					botV.ircUnfinishedMultilineMessage=[data[2], [data], 1];
				}
				
				if (botV.ircUnfinishedMultilineMessage !== undefined) {
					if (botV.ircNumericMessageHandles[botV.ircUnfinishedMultilineMessage[0]].endNumeric == data[2]) {
						botV.ircNumericMessageHandles[botV.ircUnfinishedMultilineMessage[0]].messageHandle(botV.ircUnfinishedMultilineMessage);
						delete botV.ircUnfinishedMultilineMessage;
					}
				}
				
				if (botV.ircUnfinishedMultilineMessage !== undefined) {
					if (botV.ircUnfinishedMultilineMessage[2] > settings.ircMultilineMessageMaxLines) {
						delete botV.ircUnfinishedMultilineMessage;
					}
				}
			}
			
			for (var lineC in ircMessageLines) {
				lineC = +lineC;
				var line=ircMessageLines[lineC];
				var isMessageEnded = (ircMessageLines[lineC+1] === undefined) ? false : true;
				var messageData;
				
				if (isMessageEnded) {
					if (botV.ircUnfinishedMessage) {
						line = botV.ircUnfinishedMessage+line;
						delete botV.ircUnfinishedMessage;
					}
					messageData = botF.ircParseMessageLine(line);
					botF.emitBotEvent('botReceivedDataParsedLine', messageData);
					if (!isNumeric(messageData[2])) {
						ircCommandHandle(messageData);
					} else {
						ircNumericHandle(messageData);
					}
				} else {
					botV.ircUnfinishedMessage  = line;
				}
			}
		},
		
		//main bot initializing function
		initIrcBot: function (connectionInfoMod) {
			var ircConnectionRegistrationCompleted = false;
			var connectionInfo = {
				host: settings.ircServer||"127.0.0.1",
				port: settings.ircServerPort||6667,
				nick: settings.botName||"bot",
				pass: settings.ircServerPassword||"",
				mode: settings.botMode||"0"
			};
			for (var connectionInfoAttr in connectionInfoMod) {connectionInfo[connectionInfoAttr]=connectionInfoMod[connectionInfoAttr];}
			function ircConnectionOnData(chunk) {
				var pingMessage;
				if((pingMessage=chunk.match(/(?:^|\r\n)PING (?::)?([^\r\n]*)/)) !== null){
					ircConnection.write('PONG :'+pingMessage[1]+'\r\n');
				} else {
					botF.ircDataReceiveHandle(chunk);
				}
				if (ircConnectionRegistrationCompleted === false) {
					if (new RegExp(':[^ \r\n]* 001 '+settings.botName, 'g').exec(chunk) !== null) {
						ircConnectionRegistrationCompleted = true;
						botF.ircPostConnectionRegistrationHandle();
						botF.emitBotEvent('botIrcConnectionRegistered', ircConnection);
					}
				}
			}
			function connect() {
				var c;
				var connectionOptions = {
					host: connectionInfo.host,
					port: connectionInfo.port
				};
				var socks5 = false;
				function initSocks(host, port, user, pass, callback) {
					var ipAddr;
					var octet;
					var ATYP = net.isIP(host);
					var DST_ADDR = '';
					var DST_PORT = numToHexByte(+port);
					switch (ATYP) {
						case 0:
							ATYP = '03';
							DST_ADDR += numToHexByte(+host.length);
							DST_ADDR += host.toHex();
							break;
						case 4:
							ATYP = '01';
							ipAddr = host.split('.');
							for (octet in ipAddr) {
								DST_ADDR += numToHexByte(+ipAddr[octet]);
							}
							break;
						case 6:
							ATYP = '04';
							ipAddr = expandIPv6Address(host).split(':');
							for (octet in ipAddr) {
								DST_ADDR += ipAddr[octet];
							}
							break;
					}
					function numToHexByte(num) {
						var hex = num.toString(16);
						if ((hex.length/2)%1 !== 0) {
							hex = '0'+hex;
						}
						return hex;
					}
					function requestConnect() {
						//socks5(05), connect(01), reserved(00)
						c.write(new Buffer('050100'+ATYP+DST_ADDR+DST_PORT, 'hex'));
						c.once('data', function (data) {
							//00 == succeeded
							if (data.substr(2*1, 2) == '00') {
								callback();
							} else {
								botF.debugMsg('Error: Proxy traversal failed');
							}
						});
					}
					function sendUnamePasswdAuth() {
						var ULEN = numToHexByte(user.length);
						var UNAME = user.toHex();
						var PLEN = numToHexByte(pass.length);
						var PASSWD = pass.toHex();
						c.write(new Buffer('01'+ULEN+UNAME+PLEN+PASSWD, 'hex'));
						c.once('data', function (data) {
							//00 == succeeded
							if (data.substr(2*1, 2) == '00') {
								requestConnect();
							} else {
								botF.debugMsg('Error: Proxy auth failed');
							}
						});
					}
					(function () {
						var NMETHODS = 1;
						var METHODS = '00';
						if (user && pass) {
							NMETHODS += 1;
							METHODS += '02';
						}
						c.setEncoding('hex');
						c.write(new Buffer('05'+numToHexByte(NMETHODS)+METHODS, 'hex'));
						c.once('data', function (data) {
							if (data.substr(2*0, 2) == '05') {
								if (data.substr(2*1, 2) == '00') {
									requestConnect();
								} else if (data.substr(2*1, 2) == '02') {
									sendUnamePasswdAuth();
								} else if (data.substr(2*1, 2) == 'ff') {
									botF.debugMsg('Error: Proxy rejected all known methods');
								}
							}
						});
					})();
				}
				function initIrc() {
					c.setEncoding('utf8');
					c.on('data', ircConnectionOnData);
					if (settings.ircServerPassword) {c.write('PASS '+settings.ircServerPassword+'\r\n');}
					c.write('NICK '+connectionInfo.nick+'\r\n');
					c.write('USER '+connectionInfo.nick+' '+connectionInfo.mode+' '+connectionInfo.host+' :'+connectionInfo.nick+'\r\n');
				}
				if (settings.socks5_host && settings.socks5_port) {
					socks5 = true;
					connectionOptions.host = settings.socks5_host;
					connectionOptions.port = settings.socks5_port;
				}
				c = net.connect(connectionOptions,
					function() { //'connect' listener
						if (socks5) {
							initSocks(connectionInfo.host,
								connectionInfo.port,
								settings.socks5_username,
								settings.socks5_password, initIrc);
						} else {
							initIrc();
						}
				});
				c.once('error', function (e) {
					botF.debugMsg('Connection error: ('+e+').');
				});
				c.once('timeout', function (e) {
					botF.debugMsg('Connection timeout');
				});
				c.once('close', function() {
					botF.debugMsg('Connection closed.');
				});
				ircConnection = c;
				nBotObject.ircConnection = ircConnection;
				botF.emitBotEvent('botIrcConnectionCreated', ircConnection);
			}
			connect();
		}
	};
	
	//populate bot properties
	this.init = botF.initIrcBot;
	this.ircConnection = ircConnection;
	this.botEventsEmitter = function () {
		var botEventsEmitter = new events.EventEmitter();
		botEventsEmitter.setMaxListeners(0);
		return botEventsEmitter;
	}();
	this.kill = function () {
		ircConnection.end();
		ircConnection.destroy();
	};
	this.publicData = {
		settings: settings,
		globalSettings: globalSettings,
		ircBotHost: ircBotHost,
		ircChannelUsers: ircChannelUsers,
		botFunctions: botF,
		botVariables: botV
	};
	this.pluginData = {};
	
	//load plugins from settings
	for (var index in settings.plugins) {
		botF.botPluginLoad(settings.plugins[index],  settings.pluginDir+'/'+settings.plugins[index]+'.js');
	}
}

//load settings and start the bot
botSettingsLoad(null, function (data) {
	settings = data;
	connections = settings.connections;
	if(settings.terminalSupportEnabled){initTerminalHandle();}
	if(settings.ircRelayServerEnabled){ircRelayServerInit();}
	for (var connection in connections) {
		nBotConnectionInit(connection);
	}
});
