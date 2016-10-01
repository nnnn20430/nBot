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
var fs = require('fs');
var events = require('events');

var nBot = require('./lib/nBot');

var settings;
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
		this.debugMessages = false;
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
var instanceBotEventHandleObj = {
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
				instanceBotEventHandleObj.PRIVMSG(connectionId, event.eventData);
				break;
			case 'botReceivedNOTICE':
				instanceBotEventHandleObj.NOTICE(connectionId, event.eventData);
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
	
	connectionsTmp[connectionId] = new nBot(connections[connectionId]);
	
	var botObj = connectionsTmp[connectionId];
	var options = botObj.publicData.options;
	var botV = botObj.publicData.botVariables;
	var botF = botObj.publicData.botFunctions;
	
	botF.botSettingsLoad = botSettingsLoad;
	botF.botSettingsSave = botSettingsSave;
	
	botObj.publicData.externalObjects = {
			instanceBotEventHandleObj: instanceBotEventHandleObj
	};
	
	//load plugins from settings
	for (var plugin in connections[connectionId].plugins) {
		botF.botPluginLoad(options.plugins[plugin], 
			options.pluginDir+'/'+options.plugins[plugin]+'.js');
	}
	
	botObj.init();
	
	botObj.botEventsEmitter.on('botEvent', handleBotEvent);
	botObj.botEventsEmitter.on('botDebugMessage', handleBotDebugMessage);
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
