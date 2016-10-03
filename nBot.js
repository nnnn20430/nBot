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

/*jshint node: true*/
/*jshint evil: true*/

"use strict";
//variables
var net = require('net');
var tls = require('tls');
var fs = require('fs');
var events = require('events');
var path = require('path');

var settings = {};
var connections = [];
var connectionsTmp = [];
var terminalCurrentConnection = 0;

//handle uncaught errors
process.on('uncaughtException', function (err) {
	console.log(err.stack);
	console.log('An uncaught exception occurred please report this.');
	if (settings.ignoreUncaughtExceptions) {
		console.log('WARNING: Ignoring of uncaught exceptions enabled!');
	} else {
		process.exit(1);
	}
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
		this.terminalInputPrefix = '> ';
		this.ircRelayServerEnabled = true;
		this.ircRelayServerPort = 9977;
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
	var csettings = connections[terminalCurrentConnection];
	var connectionName = csettings.connectionName||terminalCurrentConnection;
	var botObj, botV, botF;
	if (connectionsTmp[terminalCurrentConnection]) {
		botObj= connectionsTmp[terminalCurrentConnection];
		botV = botObj.publicData.botVariables;
		botF = botObj.publicData.botFunctions;
	}
	if (terminalCommandArgs[0] && terminalCommandArgs[0].charAt(0) == '/') {
		switch (terminalCommandArgs[0].split('').slice(1).join('')) {
			case 'raw':
				(function () {
					if (botObj && !botV.ircConnection.destroyed) {
						botF.ircWriteData(terminalCommandArgs[1]);
					} else {
						terminalLog('Current connection is dead.');
					}
				})();
				break;
			case 'join':
				(function () {
					var botIsInChannel = false;
					for (var channel in csettings.channels) {
						if (csettings.channels[channel] == terminalCommandArgs[1]) {
							botIsInChannel = true;
						}
					}
					if (!botIsInChannel) {
						csettings.channels.arrayValueAdd(terminalCommandArgs[1]);
					}
				})();
				break;
			case 'part':
				(function () {
					var partReason = "Leaving";
					if (terminalCommandArgs[2] !== undefined) {partReason=terminalCommandArgs[2];}
					csettings.channels.arrayValueRemove(terminalCommandArgs[1]);
					if (botObj && !botV.ircConnection.destroyed) {
						botF.ircSendCommandPART(terminalCommandArgs[1], partReason);
					}
				})();
				break;
			case 'say':
				(function () {
					if (terminalCommandArgs[2] !== undefined) {
						if (botObj && !botV.ircConnection.destroyed) {
							terminalLog('['+connectionName+':'+terminalCommandArgs[1]+'] '+csettings.botName+': '+terminalCommandArgs[2]);
							botF.ircSendCommandPRIVMSG(terminalCommandArgs[2], terminalCommandArgs[1]);
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
					setTimeout(function () {
						killAllnBotInstances(null, true);
						process.exit();
					}, 1000);
					killAllnBotInstances(quitReason);
				})();
				break;
			case 'connection':
				(function () {
					var botObj, botV, botF;
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
								botObj= connectionsTmp[terminalCurrentConnection];
								botV = botObj.publicData.botVariables;
								botF = botObj.publicData.botFunctions;
								terminalLog('> id: '+connection+', name: "'+connections[connection].connectionName+'", status: '+(botObj?(botV.ircConnection.destroyed?'dead':'alive'):'dead'));
							}
						}
					} else {
						terminalLog('> Current connection id: '+terminalCurrentConnection+', name: "'+csettings.connectionName+'", status: '+(botObj?(botV.ircConnection.destroyed?'dead':'alive'):'dead')+'.');
					}
				})();
				break;
			case 'fakemsg':
				(function () {
					if (botObj && !botV.ircConnection.destroyed) {
						botF.emitBotEvent('botReceivedPRIVMSG', ['terminal', 'terminal', 'terminal', 'terminal', 'terminal', terminalCommandArgs[1]]);
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
					var plugin = terminalCommandArgs[1];
					if (botObj) {
						if (botObj.pluginData[plugin]) {
							botF.botPluginDisable(plugin);
							botF.botPluginLoad(plugin, csettings.pluginDir+'/'+plugin+'.js');
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
					if (botObj) {
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
					var plugin = terminalCommandArgs[1];
					if (botObj) {
						botF.botPluginLoad(plugin, csettings.pluginDir+'/'+plugin+'.js');
						csettings.plugins.arrayValueAdd(terminalCommandArgs[1]);
					} else {
						terminalLog('Current connection is dead.');
					}
				})();
				break;
			case 'plugindisable':
				(function () {
					var plugin = terminalCommandArgs[1];
					if (botObj) {
						botF.botPluginDisable(plugin);
						csettings.plugins.arrayValueRemove(plugin);
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
								botObj.publicData.options = connections[connection];
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
						if (connections[connection].connectionName == connectionId) {
							connectionId = connection;
						}
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
						if (connections[connection].connectionName == connectionId) {
							connectionId = connection;
							}
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
	if (process.stdin.setRawMode) {
		process.stdin.setRawMode(true);
	}
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
				terminalBuffer[terminalBufferCurrent]=
				terminalBuffer[terminalBufferCurrent].substr(0, (terminalCursorPositionAbsolute-2))+
				terminalBuffer[terminalBufferCurrent].substr((terminalCursorPositionAbsolute-1));
				if (terminalCursorPositionAbsolute > 1) {
					terminalCursorPositionAbsolute--;
				}
				terminalUpdateBuffer();
			}else if (chunk == "\x1b\x5b\x33\x7e") {
				//del
				terminalBuffer[terminalBufferCurrent]=
				terminalBuffer[terminalBufferCurrent].substr(0, (terminalCursorPositionAbsolute-1))+
				terminalBuffer[terminalBufferCurrent].substr((terminalCursorPositionAbsolute));
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
				
				terminalBuffer[terminalBufferCurrent]=
				terminalBuffer[terminalBufferCurrent].substr(0, (terminalCursorPositionAbsolute-1))+
				chunk+
				terminalBuffer[terminalBufferCurrent].substr((terminalCursorPositionAbsolute-1));
				
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
	var botObj, botV, botF;
	for (connection in connectionsTmp) {
		if (connectionsTmp[connection]) {
			botObj = connectionsTmp[connection];
			botV = botObj.publicData.botVariables;
			botF = botObj.publicData.botFunctions;
			for (var plugin in botObj.pluginData) {
				botF.botPluginDisable(plugin);
			}
			if (force === true) {
				botObj.kill();
			} else {
				if (!botV.ircConnection.destroyed) {
					botF.ircSendCommandQUIT(reason);
				} else {
					botObj.kill();
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
		var connectionName = connections[connection].connectionName||connection;
		debugLog('['+connectionName+':'+to+'] <'+nick+'>: '+message);
		if (settings.ircRelayServerEnabled && connections[connection].ircRelayServerEnabled) {
			ircRelayServerEmitter.emit('write', connectionName+':'+data[0].split(' ')[0].slice(1)+':'+to+':'+message+'\n');
		}
	},
	NOTICE: function (connection, data) {
		var nick = data[1][0], 
			to = data[4][0], 
			message = data[5]||data[4][1];
		var connectionName = connections[connection].connectionName||connection;
		debugLog('[NOTICE('+connectionName+':'+to+')] <'+nick+'>: '+message);
		if (settings.ircRelayServerEnabled && connections[connection].ircRelayServerEnabled) {
			ircRelayServerEmitter.emit('write', connectionName+':'+data[0].split(' ')[0].slice(1)+':'+to+':'+message+'\n');
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
		handleBotDebugMessageEvent(connectionId, data);
	}
	function handleConnectionRegistration() {
		var ircIntervalUpdate;
		
		var botObj = connectionsTmp[connectionId];
		var botV = botObj.publicData.botVariables;
		var botF = botObj.publicData.botFunctions;
		var options = botObj.publicData.options;
		
		botF.ircBotUpdateSelf();
		ircIntervalUpdate = setInterval(function () {
			botF.ircBotUpdateSelf();
		}, options.botUpdateInterval||10000);
		botV.ircConnection.once('close', function() {
			clearInterval(ircIntervalUpdate);
		});
	}
	
	connectionsTmp[connectionId] = new Create_nBot_instance(connections[connectionId]);
	
	var botObj = connectionsTmp[connectionId];
	var options = botObj.publicData.options;
	var botV = botObj.publicData.botVariables;
	var botF = botObj.publicData.botFunctions;
	
	//expose new variables
	botV.botInstanceEventHandles = botInstanceEventHandles;
	//expose new functions
	botF.botSettingsLoad = botSettingsLoad;
	botF.botSettingsSave = botSettingsSave;
	
	//listen for events
	botObj.botEventsEmitter.on('botEvent', handleBotEvent);
	botObj.botEventsEmitter.on('botDebugMessage', handleBotDebugMessage);
	
	//load plugins from settings
	for (var plugin in connections[connectionId].plugins) {
		botF.botPluginLoad(options.plugins[plugin], 
			options.pluginDir+'/'+options.plugins[plugin]+'.js');
	}
	
	botObj.init();
}

//main bot class
function Create_nBot_instance(options) {
	//force 'new' object keyword
	if(!(this instanceof Create_nBot_instance)) {
		return new Create_nBot_instance(options);
	}
	
	//variables
	var nBot = this;
	var botV = {};
	var botF = {};
	
	(function(){
		botV.ircConnection = null;
		botV.ircMessageBuffer = null;
		botV.ircMultilineMessageBuffer = null;
		botV.ircNumericMessageHandles = {};
		botV.ircConnectionRegistrationCompleted = false;
		botV.ircBotHost = "";
		botV.ircChannelUsers = {};
		botV.ircSupportedUserModesArray = [
			['o', '@'],
			['v', '+']
		];
		botV.ircNetworkServers = [];
		botV.ircResponseListenerObj = {};
		botV.ircResponseListenerLimit = options.ircResponseListenerLimit||30;
		
		//misc bot functions
		
		//misc bot functions: parse irc message line
		botF.ircParseMessageLine = function (message) {
			var messageArr = message.split(' ');
			var prefix = message.charAt(0) == ':' ? [
				messageArr[0].slice(1).split('!').slice(0,1).join('').split('@').slice(0,1).join(''),
				messageArr[0].indexOf('!') != -1 ? messageArr[0].slice(messageArr[0].indexOf('!')+1).split('@').slice(0,1).join('') : '',
				messageArr[0].indexOf('@') != -1 ? messageArr[0].slice(messageArr[0].indexOf('@')+1) : ''
			] : '';
			var command = prefix ? messageArr[1] : messageArr[0];
			var params = prefix ? messageArr.slice(2) : messageArr.slice(1);
			var middleParams = [];
			var trailingParams = '';
			
			for (var param in params) {
				if (!trailingParams) {
					if (params[param].charAt(0) == ':') {
						trailingParams += params[param].slice(1)+' ';
					} else {
						middleParams = middleParams.concat([params[param]]);
					}
				} else {
					trailingParams += params[param]+' ';
				}
			}
			
			return [message, prefix, command, params, middleParams, trailingParams.slice(0,-1)];
		};
		
		//misc bot functions: check if input is only numbers
		botF.isNumeric = function (n) {
			return !isNaN(parseFloat(n)) && isFinite(n);
		};
		
		//misc functions: get shell like arguments from a string
		botF.getArgsFromString = function (str) {
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
		};
		
		//compare From arrF Against arrA
		botF.arrDiff = function (arrF, arrA) {
			if (arrF instanceof Array &&
				arrA instanceof Array) {
				return arrF.filter(function(i) {
					return arrA.indexOf(i) < 0;
				});
			}
		};
		
		botF.strReplaceEscapeSequences = function (str) {
			return str
				.replace(/#csi;/g, '\x1B[')
				.replace(/#c;/g, '\x03')
				.replace(/#reset;/g, '\x0F')
				.replace(/#underline;/g, '\x1F')
				.replace(/#bold;/g, '\x02')
				.replace(/#italic;/g, '\x16')
				.replace(new RegExp('#x([0-9a-fA-F]{2});', 'g'),
					function(regex, hex){return botF.strFromHex(hex);})
				.replace(new RegExp('#u([0-9a-fA-F]{4});', 'g'),
					function(regex, hex){return botF.strFromUtf8Hex(hex);});
		};
		
		botF.arrVAdd = function (a, v) {
			a.splice(a.lastIndexOf(a.slice(-1)[0])+1, 0, v);
			return a;
		};
		
		botF.arrVRm = function (a, v) {
			if (a.lastIndexOf(v) !== -1) {
				return a.splice(a.lastIndexOf(v), 1);
			}
		};
		
		botF.strToHex = function (str) {
			return new Buffer(str.toString(), 'utf8').toString('hex');
		};
		
		botF.strFromHex = function (str) {
			return new Buffer(str.toString(), 'hex').toString('utf8');
		};
		
		botF.strToUtf8Hex = function (str) {
			var hex, i;
			
			var result = "";
			for (i=0; i<str.length; i++) {
				hex = str.charCodeAt(i).toString(16);
				result += ("000"+hex).slice(-4);
			}
			
			return result;
		};
		
		botF.strFromUtf8Hex = function (str) {
			var j;
			var hexes = str.match(/.{1,4}/g) || [];
			var back = "";
			for(j = 0; j<hexes.length; j++) {
				back += String.fromCharCode(parseInt(hexes[j], 16));
			}
			
			return back;
		};
		
		botF.expandIPv6Address = function (address) {
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
		};
		
		//misc bot functions: perform updates based on self whois
		botF.ircBotUpdateSelf = function () {
			function whoisHandle(data) {
				var channels = '';
				for (var line in data[1]) {
					if (data[1][line][2] == 319) {
						channels += data[1][line][5].replace(/[^ #]{0,1}#/g, '#');
					}
				}
				var channelArray = channels.split(' ');
				var missingChannels = botF.arrDiff(
					options.channels, channelArray
				);
				for (var channel in missingChannels){
					if(options.channels.hasOwnProperty(channel)){
						botF.debugMsg("joining channel: "+missingChannels[channel]);
						botF.ircSendCommandJOIN(missingChannels[channel]);
					}
				}
				function initMissingChannelUserData(channels) {
					botF.ircUpdateUsersInChannel(channels[0], function() {
						initMissingChannelUserData(channels.slice(1));
					});
				}
				initMissingChannelUserData(
					botF.arrDiff(
						channelArray, Object.keys(
							botV.ircChannelUsers
						)
					)
				);
			}
			botF.ircSendCommandWHOIS(options.botName, function (data) {
				whoisHandle(data);
			});
		};
		
		//misc bot functions: update tracked user data in channel
		botF.ircUpdateUsersInChannel = function (channel, callback) {
			function ircUpdateTrackedUsersFromWhoMessage(data) {
				var line;
				var parsedData = {};
				var params;
				for (line in data[1]) {
					if (data[1][line][2] == 352) {
						params = data[1][line][3];
						if (!parsedData[params[1]]) {parsedData[params[1]] = {};}
						parsedData[params[1]][params[5]] = {
							user: params[2],
							host: params[3],
							server: params[4],
							isHere: params[6].charAt(0) == 'H' ? true : false,
							isGlobalOP: params[6].charAt(1) == '*' ? true : false,
							mode: botF.ircModePrefixConvert('mode', (params[6].charAt(1) == '*' ? params[6].substr(2) : params[6].substr(1))),
							hopcount: data[1][line][5].split(' ')[0],
							realname: data[1][line][5].split(' ').slice(1).join(' ')
						};
					}
				}
				for (var channel in parsedData) {
					var newChannelData = {};
					if (botV.ircChannelUsers[channel] === undefined ) {
							botV.ircChannelUsers[channel] = {};
					}
					for (var nick in parsedData[channel]) {
						newChannelData[nick] = {};
						if (botV.ircChannelUsers[channel][nick] !== undefined ) {
							newChannelData[nick] = botV.ircChannelUsers[channel][nick];
						}
						for (var attrname in parsedData[channel][nick]) {
							newChannelData[nick][attrname]=parsedData[channel][nick][attrname];
						}
					}
					botV.ircChannelUsers[channel] = newChannelData;
				}
				if(callback !== undefined) {callback(parsedData);}
			}
			botF.ircSendCommandWHO(channel, function (data) {ircUpdateTrackedUsersFromWhoMessage(data);});
		};
		
		//misc bot functions: handle post connection registation 
		botF.ircPostConnectionRegistrationHandle = function () {
			botF.emitBotEvent('botIrcConnectionRegistered', null);
			botF.debugMsg('connected to irc server!');
			botF.ircWriteData('LINKS');
		};
		
		//misc bot functions: emit debug message event
		botF.debugMsg = function (data) {
			var botEvents = nBot.botEventsEmitter;
			if (botEvents.listeners('botDebugMessage').length) {
				botEvents.emit('botDebugMessage', data);
			}
		};
		
		//misc bot functions: emit botEvent event
		botF.emitBotEvent = function (name, data) {
			try {
				nBot.botEventsEmitter.emit('botEvent', {eventName: name, eventData: data});
			} catch (e) {
				botF.debugMsg('Error when emitting "botEvent" event with name "'+name+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
			}
		};
		
		//misc bot functions: load a plugin
		botF.botPluginLoad = function (id, pluginPath) {
			pluginPath = path.resolve(pluginPath);
			function pluginAddBotEventListener(id) {
				nBot.botEventsEmitter.once('botEvent', function (data) {
					if (nBot.pluginData[id] && nBot.pluginData[id].botEvent) {
						if (!(data.eventName == 'botPluginDisableEvent' && data.eventData == id)) {
							pluginAddBotEventListener(id);
						}
						try {
							nBot.pluginData[id].botEvent(data);
						} catch (e) {
							botF.debugMsg('Error happened when passing botEvent "'+data.eventName+'" to plugin "'+id+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
						}
					}
				});
			}
			(function () {
				try {
					if (nBot.pluginData[id]) {
						botF.debugMsg('Plugin "'+id+'" is already registered, trying to disable before attempting to load...');
						botF.botPluginDisable(id);
					}
					nBot.pluginData[id] = require(pluginPath);
					nBot.pluginData[id].main({id: id, botObj: nBot});
					botF.emitBotEvent('botPluginLoadedEvent', id);
					if (nBot.pluginData[id].botEvent) {
						pluginAddBotEventListener(id);
					}
					//Do not cache plugins
					if (require.cache && require.cache[pluginPath]) {
						delete require.cache[pluginPath];
					}
				} catch (e) {
					botF.debugMsg('Error happened when loading plugin "'+id+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
				}
			})();
		};
		
		//misc bot functions: disable a plugin
		botF.botPluginDisable = function (id) {
			try {
				botF.emitBotEvent('botPluginDisableEvent', id);
				delete nBot.pluginData[id];
			} catch (e) {
				botF.debugMsg('Error happened when disabling plugin "'+id+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
			}
		};
		
		//misc bot functions: convert between modes and prefixes
		botF.ircModePrefixConvert = function (convertTo, str) {
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
		};
		
		//misc bot functions: emit irc response to listeners
		botF.ircResponseListenerEmit = function (command, data) {
			var listenerArr;
			var newArray;
			var listenerObj;
			var save;
			for (var id in botV.ircResponseListenerObj) {
				listenerArr = Object.assign([], botV.ircResponseListenerObj[id]);
				newArray = [];
				for (var listener in listenerArr) {
					listenerObj = listenerArr[listener];
					save = true;
					if (listenerObj.command == command) {
						try {
							if (listenerObj.condition(data) === true) {
								try {
									listenerObj.handle(data);
									save = false;
								} catch (e) {
									botF.debugMsg('Error when emitting irc response command "'+command+'" event to listener "'+id+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
								}
							}
						} catch (e) {
							botF.debugMsg('Error checking irc response event condition for command "'+command+'" listener "'+id+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
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
						newArray.push(listenerObj);
					}
				}
				botV.ircResponseListenerObj[id] = newArray.concat(
					botF.arrDiff(
						botV.ircResponseListenerObj[id], listenerArr
					)
				);
			}
		};
		
		//misc bot functions: add irc response listener
		botF.ircResponseListenerAdd = function (id, command, condition, handle, ttl) {
			var response = false;
			if (id && command && condition && handle) {
				if (!(botV.ircResponseListenerObj[id] instanceof Array)) {
					botV.ircResponseListenerObj[id] = [];
				}
				botV.ircResponseListenerObj[id].push({
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
		};
		
		//misc bot functions: remove irc response listener(s)
		botF.ircResponseListenerRemove = function (id, command, condition, handle) {
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
							newArray.push(listenerObj);
						}
					}
					botV.ircResponseListenerObj[id] = newArray;
				} else {
					delete botV.ircResponseListenerObj[id];
				}
			}
			return response;
		};
		
		//write raw data
		botF.ircWriteData = function (data) {
			botV.ircConnection.write(data+'\r\n');
		};
		
		//irc command functions
		botF.ircSendCommandPRIVMSG = function (data, to, timeout, forceTimeout){
			var command = "";
			command += ":";
			command += options.botName;
			command += "!";
			command += options.botName;
			command += "@"+botV.ircBotHost;
			command += " PRIVMSG ";
			command += to;
			command += " :\r\n";
			var msgLength = 512-getBytes(command);
			var dataArray = ((''+data).split('')), stringArray = [''];
			var count = 0;
			var length;
			timeout=timeout||1000;
			function getBytes(string){
				return Buffer.byteLength(string, 'utf8');
			}
			function writeData(data, to, count, timeout) {
				setTimeout(function() {
					botF.ircWriteData('PRIVMSG '+to+' :'+data[count]);
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
		};
		
		botF.ircSendCommandNOTICE = function (data, to, timeout, forceTimeout){
			var command = "";
			command += ":";
			command += options.botName;
			command += "!";
			command += options.botName;
			command += "@"+botV.ircBotHost;
			command += " NOTICE ";
			command += to;
			command += " :\r\n";
			var msgLength = 512-getBytes(command);
			var dataArray = ((''+data).split('')), stringArray = [''];
			var count = 0;
			var length;
			timeout=timeout||1000;
			function getBytes(string){
				return Buffer.byteLength(string, 'utf8');
			}
			function writeData(data, to, count, timeout) {
				setTimeout(function() {
					botF.ircWriteData('NOTICE '+to+' :'+data[count]);
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
		};
		
		botF.ircSendCommandWHOIS = function (user, callback, ttl) {
			botF.ircWriteData('WHOIS '+user);
			botF.ircResponseListenerAdd('core', '311', function (data) {
				if (data[1][0][3][1] == user) {return true;}
			}, function (data) {
				if (callback !== undefined) {callback(data);}
			}, ttl||10);
		};
		
		botF.ircSendCommandWHO = function (channel, callback, ttl) {
			botF.ircWriteData('WHO '+channel);
			botF.ircResponseListenerAdd('core', '352', function (data) {
				if (data[1][0][3][1] == channel) {
					return true;
				}
			}, function (data) {
				if (callback !== undefined) {callback(data);}
			}, ttl||10);
		};
		
		botF.ircSendCommandJOIN = function (channel) {
			botF.ircWriteData('JOIN '+channel);
		};
		
		botF.ircSendCommandPART = function (channel, reason) {
			reason = reason||"Leaving";
			botF.ircWriteData('PART '+channel+' :'+reason);
		};
		
		botF.ircSendCommandQUIT = function (reason) {
			reason = reason||"Leaving";
			botF.ircWriteData('QUIT :'+reason);
		};
		
		botF.ircSendCommandMODE = function (target, mode) {
			botF.ircWriteData('QUIT '+target+' '+mode);
		};
		
		botF.ircSendCommandPING = function (data) {
			botF.ircWriteData('PING '+data);
		};
		
		botF.ircSendCommandPONG = function (data) {
			botF.ircWriteData('PONG '+data);
		};
		
		botF.ircSendCommandPASS = function (data) {
			botF.ircWriteData('PASS '+data);
		};
		
		botF.ircSendCommandNICK = function (data) {
			botF.ircWriteData('NICK '+data);
		};
		
		botF.ircSendCommandUSER = function (user, mode, realname) {
			botF.ircWriteData('USER '+user+' '+mode+' * :'+realname);
		};
		
		//irc response handle functions
		botF.ircReceiveHandlePRIVMSG = function (data) {
			botF.emitBotEvent('botReceivedPRIVMSG', data);
			botF.ircResponseListenerEmit('PRIVMSG', data);
		};
		
		botF.ircReceiveHandleNOTICE = function (data) {
			botF.emitBotEvent('botReceivedNOTICE', data);
			botF.ircResponseListenerEmit('NOTICE', data);
		};
		
		botF.ircReceiveHandleJOIN = function (data) {
			botF.emitBotEvent('botReceivedJOIN', data);
			botF.ircResponseListenerEmit('JOIN', data);
			var nick = data[1][0];
			var channel = data[5]||data[3];
			if (nick != options.botName){
				botF.ircUpdateUsersInChannel(channel);
			} else {
				botF.ircUpdateUsersInChannel(channel);
			}
		};
		
		botF.ircReceiveHandlePART = function (data) {
			botF.emitBotEvent('botReceivedPART', data);
			botF.ircResponseListenerEmit('PART', data);
			var nick = data[1][0];
			if (nick != options.botName){
				if (botV.ircChannelUsers[data[5]||data[3]] && botV.ircChannelUsers[data[5]||data[3]][nick]) {
					delete botV.ircChannelUsers[data[5]||data[3]][nick];
				}
			} else {
				delete botV.ircChannelUsers[data[5]||data[3]];
			}
		};
		
		botF.ircReceiveHandleQUIT = function (data) {
			botF.emitBotEvent('botReceivedQUIT', data);
			botF.ircResponseListenerEmit('QUIT', data);
			var nick = data[1][0];
			if (nick != options.botName){
				for (var channel in botV.ircChannelUsers) {
					if (botV.ircChannelUsers[channel][nick] !== undefined) {
						delete botV.ircChannelUsers[channel][nick];
					}
				}
			}
		};
		
		botF.ircReceiveHandleMODE = function (data) {
			botF.emitBotEvent('botReceivedMODE', data);
			botF.ircResponseListenerEmit('MODE', data);
			var modeParams = data[3];
			
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
								if (botV.ircChannelUsers[channel] && botV.ircChannelUsers[channel][user]) {
									botV.ircChannelUsers[channel][user].mode += botF.ircModePrefixConvert('mode', oModes[mode]);
								}
							}	
							break;
						case '-':
							oModes = modes[+operation+1].split('');
							for (mode in oModes) {
								user = modeparams.splice(0, 1);
								if (botV.ircChannelUsers[channel] && botV.ircChannelUsers[channel][user]) {
									botV.ircChannelUsers[channel][user].mode = botV.ircChannelUsers[channel][user].mode.split(botF.ircModePrefixConvert('mode', oModes[mode])).join('');
								}
							}	
							break;
					}
				}
			}
		};
		
		botF.ircReceiveHandleNICK = function (data) {
			botF.emitBotEvent('botReceivedNICK', data);
			botF.ircResponseListenerEmit('NICK', data);
			var nick = data[1][0];
			var newnick = data[5]||data[4][0];
			if (nick == options.botName){
				options.botName = newnick;
			}
			for (var channel in botV.ircChannelUsers) {
				if (botV.ircChannelUsers[channel][nick] !== undefined) {
					botV.ircChannelUsers[channel][newnick]=botV.ircChannelUsers[channel][nick];
					delete botV.ircChannelUsers[channel][nick];
				}
			}
		};
		
		botF.ircReceiveHandleKICK = function (data) {
			botF.emitBotEvent('botReceivedKICK', data);
			botF.ircResponseListenerEmit('KICK', data);
			var by = data[1][0];
			var channel = data[3][0];
			var nick = data[3][1];
			if (nick != options.botName){
				if (botV.ircChannelUsers[channel] && botV.ircChannelUsers[channel][nick]) {
					delete botV.ircChannelUsers[channel][nick];
				}
			}
		};
		
		botF.ircReceiveHandleTOPIC = function (data) {
			botF.emitBotEvent('botReceivedTOPIC', data);
			botF.ircResponseListenerEmit('TOPIC', data);
		};
		
		botF.ircReceiveHandleKILL = function (data) {
			botF.emitBotEvent('botReceivedKILL', data);
			botF.ircResponseListenerEmit('KILL', data);
		};
		
		botF.ircReceiveHandlePING = function (data) {
			botF.emitBotEvent('botReceivedPING', data);
			botF.ircResponseListenerEmit('PING', data);
			var pingMessage = data[5]||data[3][0];
			botF.ircSendCommandPONG(pingMessage);
		};
		
		botF.ircReceiveNumHandle001 = function (data) {
			botF.emitBotEvent('botReceivedNum001', data);
			botF.ircResponseListenerEmit('001', data);
			if (botV.ircConnectionRegistrationCompleted === false) {
				botV.ircConnectionRegistrationCompleted = true;
				botF.ircPostConnectionRegistrationHandle();
			}
		};
		
		botF.ircReceiveNumHandle005 = function (data) {//RPL_ISUPPORT
			botF.emitBotEvent('botReceivedNum005', data);
			botF.ircResponseListenerEmit('005', data);
			var params = data[1][0][3];
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
								userModeArray.push([prefixData[1].split('')[userMode], prefixData[2].split('')[userMode]]);
							}
							botV.ircSupportedUserModesArray = userModeArray;
						break;
					}
				}
			}
		};
		
		botF.ircReceiveNumHandle311 = function (data) {//RPL_WHOISUSER
			botF.emitBotEvent('botReceivedNum311', data);
			botF.ircResponseListenerEmit('311', data);
			var params = data[1][0][3];
			if (params[1] == options.botName) botV.ircBotHost=params[3];
		};
		
		botF.ircReceiveNumHandle352 = function (data) {//RPL_WHOREPLY
			botF.emitBotEvent('botReceivedNum352', data);
			botF.ircResponseListenerEmit('352', data);
		};
		
		botF.ircReceiveNumHandle353 = function (data) {//RPL_NAMREPLY
			botF.emitBotEvent('botReceivedNum353', data);
			botF.ircResponseListenerEmit('353', data);
		};
		
		botF.ircReceiveNumHandle364 = function (data) {//RPL_LINKS
			botF.emitBotEvent('botReceivedNum364', data);
			botF.ircResponseListenerEmit('364', data);
			botV.ircNetworkServers = [];
			var parsedData, line, params;
			for (line in data[1]) {
				botV.ircNetworkServers[line] = {};
				params = data[1][line][3];
				botV.ircNetworkServers[line].mask = params[1];
				botV.ircNetworkServers[line].server = params[2];
				botV.ircNetworkServers[line].hop = (params[3].charAt(0) == ':' ? params[3].substr(1) : params[3]);
				botV.ircNetworkServers[line].info = data[1][line][5].split(' ').slice(1).join(' ');
			}
		};
		
		//main irc data receiving function
		botF.ircDataReceiveHandle = function (data) {
			botF.emitBotEvent('botReceivedDataRAW', data);
			
			var ircMessageLines = data.split('\r\n');
			
			function ircCommandHandle(data) {
				if (botF['ircReceiveHandle'+data[2]] !== undefined) {
					botF['ircReceiveHandle'+data[2]](data);
				}
			}
			
			function ircNumericHandle(data) {
				var iMLMBuffer = botV.ircMultilineMessageBuffer;
				
				botV.ircNumericMessageHandles = {
					'001': {endNumeric: '001', handle: botF.ircReceiveNumHandle001},
					'005': {endNumeric: '005', handle: botF.ircReceiveNumHandle005},
					'311': {endNumeric: '318', handle: botF.ircReceiveNumHandle311},
					'352': {endNumeric: '315', handle: botF.ircReceiveNumHandle352},
					'353': {endNumeric: '366', handle: botF.ircReceiveNumHandle353},
					'364': {endNumeric: '365', handle: botF.ircReceiveNumHandle364}
				};
				
				var iNMH = botV.ircNumericMessageHandles;
				
				if (iMLMBuffer) {
					iMLMBuffer[1][iMLMBuffer[2]] = data;
					iMLMBuffer[2]++;
				} else if (iNMH[data[2]] !== undefined) {
					iMLMBuffer = [data[2], [data], 1];
				}
				
				if (iMLMBuffer) {
					if (iNMH[iMLMBuffer[0]].endNumeric == data[2]) {
						iNMH[iMLMBuffer[0]].handle(iMLMBuffer);
						iMLMBuffer = null;
					} else if (iNMH[2] > options.ircMultilineMessageMaxLines) {
						iMLMBuffer = null;
					}
				}
				
				//save state
				botV.ircMultilineMessageBuffer = iMLMBuffer;
			}
			
			for (var lineC in ircMessageLines) {
				lineC = +lineC;
				var line=ircMessageLines[lineC];
				var isMessageEnded = (
					ircMessageLines[lineC+1] === undefined
				) ? false : true;
				var messageData;
				
				if (isMessageEnded) {
					if (botV.ircMessageBuffer) {
						line = botV.ircMessageBuffer+line;
						botV.ircMessageBuffer = null;
					}
					messageData = botF.ircParseMessageLine(line);
					botF.emitBotEvent('botReceivedDataParsedLine', messageData);
					if (!botF.isNumeric(messageData[2])) {
						ircCommandHandle(messageData);
					} else {
						ircNumericHandle(messageData);
					}
				} else {
					botV.ircMessageBuffer = line;
				}
			}
		};
		
		//main bot initializing function
		botF.initIrcBot = function (connectionInfoMod) {
			var ircConnectionRegistrationCompleted = false;
			var connectionInfo = {
				host: options.ircServer||"127.0.0.1",
				port: options.ircServerPort||6667,
				localAddress: options.localBindAddress||null,
				localPort: options.localBindPort||null,
				ipFamily: options.ipFamily||4,
				nick: options.botName||"bot",
				pass: options.ircServerPassword||"",
				mode: options.botMode||"0",
				tls: options.tls?true:false,
				tlsRejectUnauthorized: options.tlsRejectUnauthorized?true:false
			};
			for (var connectionInfoAttr in connectionInfoMod) {
				connectionInfo[connectionInfoAttr]=connectionInfoMod[connectionInfoAttr];
			}
			function ircConnectionOnData(chunk) {
				botF.ircDataReceiveHandle(chunk);
			}
			function connect() {
				var c;
				var connectionOptions = {
					host: connectionInfo.host,
					port: connectionInfo.port,
					localAddress: connectionInfo.localAddress,
					localPort: connectionInfo.localPort,
					family: connectionInfo.ipFamily,
					rejectUnauthorized: connectionInfo.tlsRejectUnauthorized
				};
				var secure = connectionInfo.tls;
				var socks5 = false;
				var expandIPv6Address = botF.expandIPv6Address;
				var strToHex = botF.strToHex;
				function initSocks(c, host, port, user, pass, callback) {
					var ipAddr;
					var octet;
					var ATYP = net.isIP(host);
					var DST_ADDR = '';
					var DST_PORT = ('00'+numToHexByte(+port)).slice(-4);
					switch (ATYP) {
						case 0:
							ATYP = '03';
							DST_ADDR += numToHexByte(+host.length);
							DST_ADDR += strToHex(host);
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
						var UNAME = strToHex(user);
						var PLEN = numToHexByte(pass.length);
						var PASSWD = strToHex(pass);
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
					if (options.ircServerPassword)
						botF.ircSendCommandPASS(options.ircServerPassword);
					botF.ircSendCommandNICK(connectionInfo.nick);
					botF.ircSendCommandUSER(connectionInfo.nick,
						connectionInfo.mode,
						connectionInfo.nick);
				}
				if (options.socks5_host && options.socks5_port) {
					socks5 = true;
					connectionOptions.host = options.socks5_host;
					connectionOptions.port = options.socks5_port;
				}
				c = (secure?tls:net).connect(connectionOptions,
					function() { //'connect' listener
						if (socks5) {
							initSocks(c,
								connectionInfo.host,
								connectionInfo.port,
								options.socks5_username,
								options.socks5_password, initIrc);
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
				botV.ircConnection = c;
				botF.emitBotEvent('botIrcConnectionCreated', c);
			}
			connect();
		};
	})();
	
	//populate nBot properties
	nBot.init = botF.initIrcBot;
	nBot.botEventsEmitter = function () {
		var botEventsEmitter = new events.EventEmitter();
		botEventsEmitter.setMaxListeners(0);
		return botEventsEmitter;
	}();
	nBot.kill = function () {
		botV.ircConnection.end();
		botV.ircConnection.destroy();
	};
	nBot.publicData = {
		options: options,
		botVariables: botV,
		botFunctions: botF
	};
	nBot.pluginData = {};
}

//load settings and start the bot
botSettingsLoad(null, function (data) {
	settings = data;
	connections = settings.connections;
	if(settings.terminalSupportEnabled){initTerminalHandle();}
	if(settings.ircRelayServerEnabled){ircRelayServerInit();}
	for (var connectionId in connections) {
		nBotConnectionInit(connectionId);
	}
});
