#!/usr/bin/env node

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
		var mainSettings, attrname;
		if (this!==SettingsConstructor) {
			mainSettings = {
				terminalSupportEnabled: true,
				terminalInputPrefix: '>',
				ircRelayServerEnabled: true,
				ircRelayServerPort: 9977,
				debugMessages: false
			};
			for (attrname in modified) {mainSettings[attrname]=modified[attrname];}
			return mainSettings;
		}
	},
	connection: function (modified) {
		var connectionSettings, attrname;
		if (this!==SettingsConstructor) {
			connectionSettings = {
				connectionName: 'Connection0',
				botName: 'nBot',
				botMode: '0',
				ircServer: 'localhost',
				ircServerPort: 6667,
				ircServerPassword: '',
				socks5_host: '',
				socks5_port: 1080,
				socks5_username: '',
				socks5_password: '',
				channels: [ '#channel' ],
				ircRelayServerEnabled: true,
				ircMaxCommandResponseWaitQueue: 30,
				ircMultilineMessageMaxLines: 300,
				pluginDir: './plugins',
				plugins: [ 
					'simpleMsg',
					'commands',
					'connectionErrorResolver'
				],
				pluginsSettings: {}
			};
			for (attrname in modified) {connectionSettings[attrname]=modified[attrname];}
			return connectionSettings;
		}
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
					connectionsTmp[terminalCurrentConnection].ircConnection.write(terminalCommandArgs[1]+'\r\n');
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
					connectionsTmp[terminalCurrentConnection].ircConnection.write('PART '+terminalCommandArgs[1]+' :'+partReason+'\r\n');
				})();
				break;
			case 'say':
				(function () {
					if (terminalCommandArgs[2] !== undefined) {
						terminalLog('['+connectionName+':'+terminalCommandArgs[1]+'] '+connections[terminalCurrentConnection].botName+': '+terminalCommandArgs[2]);
						connectionsTmp[terminalCurrentConnection].ircConnection.write('PRIVMSG '+terminalCommandArgs[1]+' :'+terminalCommandArgs[2]+'\r\n');
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
							terminalLog('> Connection list:');
							for (connection in connections) {
								terminalLog('> id: '+connection+', name: '+connections[connection].connectionName);
							}
						}
					} else {
						terminalLog('> Current connection id: '+terminalCurrentConnection+', name: "'+connections[terminalCurrentConnection].connectionName+'".');
					}
				})();
				break;
			case 'fakemsg':
				(function () {
					connectionsTmp[terminalCurrentConnection].publicData.botFunctions.emitBotEvent('botReceivedPRIVMSG', ['terminal', 'terminal', 'terminal', 'terminal', 'terminal', terminalCommandArgs[1]]);
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
					var botObj = connectionsTmp[terminalCurrentConnection];
					var botF = botObj.publicData.botFunctions;
					var settings = botObj.publicData.settings;
					if (botObj.pluginData[terminalCommandArgs[1]]) {
						botF.botPluginDisable(terminalCommandArgs[1]);
						botF.botPluginLoad(terminalCommandArgs[1], settings.pluginDir+'/'+terminalCommandArgs[1]+'.js');
					}
				})();
				break;
			case 'pluginreloadall':
				(function () {
					var botObj = connectionsTmp[terminalCurrentConnection];
					var botF = botObj.publicData.botFunctions;
					var settings = botObj.publicData.settings;
					function pluginReload(plugin) {
						botF.botPluginDisable(plugin);
						botF.botPluginLoad(plugin, settings.pluginDir+'/'+plugin+'.js');
					}
					for (var plugin in botObj.pluginData) {
						pluginReload(plugin);
					}
				})();
				break;
			case 'pluginload':
				(function () {
					var botObj = connectionsTmp[terminalCurrentConnection];
					var botF = botObj.publicData.botFunctions;
					var settings = botObj.publicData.settings;
					botF.botPluginLoad(terminalCommandArgs[1], settings.pluginDir+'/'+terminalCommandArgs[1]+'.js');
					settings.plugins.arrayValueAdd(terminalCommandArgs[1]);
				})();
				break;
			case 'plugindisable':
				(function () {
					var botObj = connectionsTmp[terminalCurrentConnection];
					var botF = botObj.publicData.botFunctions;
					var settings = botObj.publicData.settings;
					botF.botPluginDisable(terminalCommandArgs[1]);
					settings.plugins.arrayValueRemove(terminalCommandArgs[1]);
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
							var botObj = connectionsTmp[connection];
							for (var plugin in botObj.pluginData) {
								pluginReload(botObj, plugin);
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
		terminalLog('['+connectionName+':'+terminalLastChannel+'] '+connections[terminalCurrentConnection].botName+': '+chunk);
		connectionsTmp[terminalCurrentConnection].ircConnection.write('PRIVMSG '+terminalLastChannel+' :'+chunk+'\r\n');
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
		return this.splice(this.lastIndexOf(this.slice(-1)[0])+1, 0, a);
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
		var botObj = connectionsTmp[connection];
		var botF = botObj.publicData.botFunctions;
		for (var plugin in botObj.pluginData) {
			botF.botPluginDisable(plugin);
		}
	}
	if (force === false) {
		for (connection in connectionsTmp) {
			connectionsTmp[connection].ircConnection.write('QUIT :'+reason+'\r\n');
		}
	}
	if (force === true) {
		for (connection in connectionsTmp) {
			connectionsTmp[connection].kill();
		}
	}
}

//misc functions: handle irc bot event from bot instance
var instanceBotEventHandleObj = {
	PRIVMSG: function (connection, data) {
		var connectionName = connections[connection].connectionName||connection;
		debugLog('['+connectionName+':'+data[4]+'] <'+data[1].split('!')[0]+'>: '+data[5]);
		if (settings.ircRelayServerEnabled && connections[connection].ircRelayServerEnabled) {
			ircRelayServerEmitter.emit('write', connectionName+':'+data[1]+':'+data[4]+':'+data[5]+'\n');
		}
	},
	NOTICE: function (connection, data) {
		var connectionName = connections[connection].connectionName||connection;
		debugLog('[NOTICE('+connectionName+':'+data[4]+')] <'+data[1].split('!')[0]+'>: '+data[5]);
		if (settings.ircRelayServerEnabled && connections[connection].ircRelayServerEnabled) {
			ircRelayServerEmitter.emit('write', connectionName+':'+data[1]+':'+data[4]+':'+data[5]+'\n');
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
	connectionsTmp[connectionId]=new nBot_instance(connections[connectionId], settings);
	connectionsTmp[connectionId].init();
	connectionsTmp[connectionId].botEventsEmitter.on('botEvent', handleBotEvent);
	connectionsTmp[connectionId].botEventsEmitter.on('botDebugMessage', handlebotDebugMessage);
}

//main bot class
function nBot_instance(settings, globalSettings) {
	var ircConnection;
	var ircBotHost = "";
	var ircChannelUsers = {};
	var ircCommandReEventsEmitter = new events.EventEmitter(); ircCommandReEventsEmitter.setMaxListeners(settings.ircMaxCommandResponseWaitQueue+2);
	var emitter = new events.EventEmitter(); emitter.setMaxListeners(0);
	
	//clean old command events
	ircCommandReEventsEmitter.on('newListener', function (data) {
		var listeners = ircCommandReEventsEmitter.listeners(data);
		while (listeners.length > settings.ircMaxCommandResponseWaitQueue) {
			ircCommandReEventsEmitter.removeListener(data, listeners[0]);
			listeners = ircCommandReEventsEmitter.listeners(data);
		}
	});
	
	//bot variable object
	var botV = {
		ircSupportedUserModesArray: [
			['o', '@'],
			['v', '+']
		],
		ircNetworkServers: []
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
			
			while (true) {
				if (params.charAt((middleParams ? middleParams+' ' : '').length) != ':' && params.indexOf(' ', (middleParams ? middleParams+' ' : ' ').length) != -1) {
					middleParams += params.substr(middleParams.length, params.substr((middleParams ? middleParams+' ' : ' ').length).indexOf(' ')+1);
				} else if (params.charAt((middleParams ? middleParams+' ' : '').length) == ':') {
					trailingParams += params.substr((middleParams ? middleParams+' :' : ':').length);
					break;
				} else {
					break;
				}
				if (loops > 512) {loops = 0; break;}
				loops++;
			}
			
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
			botF.ircSendCommandWHOIS(settings.botName, function (data) {botF.ircJoinMissingChannels(data);});
			ircIntervalUpdate = setInterval(function () {botF.ircSendCommandWHOIS(settings.botName, function (data, lineArray) {botF.ircJoinMissingChannels(data, lineArray);});}, 10000);
			nBotObject.ircConnection.once('close', function() {clearInterval(ircIntervalUpdate);});
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
		ircModePrefixConvert : function (convertTo, str) {
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
		
		//write raw data
		ircWriteData: function (data) {
			ircConnection.write(data+'\r\n');
		},
		
		//irc command functions
		ircSendCommandPRIVMSG: function (data, to, timeout, forceTimeout){
			var privmsgLenght = 512-(":"+settings.botName+"!"+settings.botName+"@"+ircBotHost+" PRIVMSG "+to+" :\r\n").length;
			var dataLengthRegExp = new RegExp('.{1,'+privmsgLenght+'}', 'g'), stringArray = [], c = 0, string;
			timeout=timeout||1000;
			function writeData(data, to, c, timeout) {
				setTimeout(function() {ircConnection.write('PRIVMSG '+to+' :'+data[c]+'\r\n'); c++; if (data[c] !== undefined) {writeData(data, to, c, timeout);}}, timeout);
			}
			while ((string = dataLengthRegExp.exec(data)) !== null) {
				stringArray[c]=string[0];c++;
			}
			if (!forceTimeout) {
				if (c <= 1) {timeout=0;}
			}
			writeData(stringArray, to, 0, timeout);
		},
		
		ircSendCommandNOTICE: function (data, to, timeout, forceTimeout){
			var privmsgLenght = 512-(":"+settings.botName+"!"+settings.botName+"@"+ircBotHost+" NOTICE "+to+" :\r\n").length;
			var dataLengthRegExp = new RegExp('.{1,'+privmsgLenght+'}', 'g'), stringArray = [], c = 0, string;
			timeout=timeout||1000;
			function writeData(data, to, c, timeout) {
				setTimeout(function() {ircConnection.write('NOTICE '+to+' :'+data[c]+'\r\n'); c++; if (data[c] !== undefined) {writeData(data, to, c, timeout);}}, timeout);
			}
			while ((string = dataLengthRegExp.exec(data)) !== null) {
				stringArray[c]=string[0];c++;
			}
			if (!forceTimeout) {
				if (c <= 1) {timeout=0;}
			}
			writeData(stringArray, to, 0, timeout);
		},
		
		ircSendCommandWHOIS: function (user, callback) {
			ircConnection.write('WHOIS '+user+'\r\n');
			function handleresponseWHOISEvent(user) {
				ircCommandReEventsEmitter.once('responseWHOIS', function (data) {
					if (data[1][0][3].split(' ')[1] == user) {
						if (callback !== undefined) {callback(data);}
					}else{handleresponseWHOISEvent(user);}
				});
			}
			handleresponseWHOISEvent(user);
		},
		
		ircSendCommandWHO: function (channel, callback) {
			ircConnection.write('WHO '+channel+'\r\n');
			function handleresponseWHOEvent(channel) {
				ircCommandReEventsEmitter.once('responseWHO', function (data) {
					if (data[1][0][3].split(' ')[1] == channel) {
						if (callback !== undefined) {callback(data);}
					}else{handleresponseWHOEvent(channel);}
				});
			}
			handleresponseWHOEvent(channel);
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
		},
		
		ircReceiveHandleNOTICE: function (data) {
			botF.emitBotEvent('botReceivedNOTICE', data);
		},
		
		ircReceiveHandleJOIN: function (data) {
			botF.emitBotEvent('botReceivedJOIN', data);
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
			var nick = data[1].split('!')[0];
			if (nick != settings.botName){
				if (ircChannelUsers[data[5]||data[3]] && ircChannelUsers[data[5]||data[3]][nick]) {
					delete ircChannelUsers[data[5]||data[3]][nick];
				}
			}
		},
		
		ircReceiveHandleQUIT: function (data) {
			botF.emitBotEvent('botReceivedQUIT', data);
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
			var nick = data[1].split('!')[0];
			if (nick != settings.botName){
				for (var channel in ircChannelUsers) {
					if (ircChannelUsers[channel][nick] !== undefined) {
						ircChannelUsers[channel][data[3]]=ircChannelUsers[channel][nick];
						delete ircChannelUsers[channel][nick];
					}
				}
			}
		},
		
		ircReceiveHandleKICK: function (data) {
			botF.emitBotEvent('botReceivedKICK', data);
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
		},
		
		ircReceiveHandleKILL: function (data) {
			botF.emitBotEvent('botReceivedKILL', data);
		},
		
		ircReceiveNumHandle005: function (data) {//RPL_ISUPPORT
			botF.emitBotEvent('botReceivedNum005', data);
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
			ircCommandReEventsEmitter.emit('responseWHOIS', data);
			var params = data[1][0][3].split(' ');
			if (params[1] == settings.botName) {ircBotHost=params[3];}
		},
		
		ircReceiveNumHandle352: function (data) {//RPL_WHOREPLY
			botF.emitBotEvent('botReceivedNum352', data);
			ircCommandReEventsEmitter.emit('responseWHO', data);
			
		},
		
		ircReceiveNumHandle353: function (data) {//RPL_NAMREPLY
			botF.emitBotEvent('botReceivedNum353', data);
		},
		
		ircReceiveNumHandle364: function (data) {//RPL_LINKS
			botF.emitBotEvent('botReceivedNum364', data);
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
				var connectionOptions = {
					host: connectionInfo.host,
					port: connectionInfo.port
				};
				var socks5 = false;
				function initSocks(host, port, callback) {
					var ipAdr;
					var octet;
					var ATYP = net.isIP(host);
					var DST_ADDR = '';
					var DST_PORT = ('000'+(+port).toString(16)).slice(-4);
					switch (ATYP) {
						case 0:
							ATYP = '03';
							DST_ADDR += ('0'+host.length.toString(16)).slice(-2);
							DST_ADDR += host.toHex();
							break;
						case 4:
							ATYP = '01';
							ipAdr = host.split('.');
							for (octet in ipAdr) {
								DST_ADDR += ('0'+(ipAdr[octet]).toString(16)).slice(-2);
							}
							break;
						case 6:
							ATYP = '04';
							ipAdr = expandIPv6Address(host).split(':');
							for (octet in ipAdr) {
								DST_ADDR += ipAdr[octet];
							}
							break;
					}
					function requestConnect() {
						ircConnection.write(new Buffer('050100'+ATYP+DST_ADDR+DST_PORT, 'hex'));
						ircConnection.once('data', function (data) {
							//00 == succeeded
							if (data.substr(2*1, 2) == '00') {
								callback();
							} else {
								botF.debugMsg('Error: Proxy traversal failed');
							}
						});
					}
					function sendUnamePasswdAuth() {
						var ULEN = ('0'+settings.socks5_username.length.toString(16)).slice(-2);
						var UNAME = settings.socks5_username.toHex();
						var PLEN = ('0'+settings.socks5_password.length.toString(16)).slice(-2);
						var PASSWD = settings.socks5_password.toHex();
						ircConnection.write(new Buffer('01'+ULEN+UNAME+PLEN+PASSWD, 'hex'));
						ircConnection.once('data', function (data) {
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
						if (settings.socks5_username && settings.socks5_password) {
							NMETHODS += 1;
							METHODS += '02';
						}
						ircConnection.setEncoding('hex');
						ircConnection.write(new Buffer('05'+('0'+NMETHODS.toString(16)).slice(-2)+METHODS, 'hex'));
						ircConnection.once('data', function (data) {
							//if chosen method == NO AUTHENTICATION(00)
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
					ircConnection.setEncoding('utf8');
					ircConnection.on('data', ircConnectionOnData);
					if (settings.ircServerPassword) {ircConnection.write('PASS '+settings.ircServerPassword+'\r\n');}
					ircConnection.write('NICK '+connectionInfo.nick+'\r\n');
					ircConnection.write('USER '+connectionInfo.nick+' '+connectionInfo.mode+' '+connectionInfo.host+' :'+connectionInfo.nick+'\r\n');
				}
				if (settings.socks5_host && settings.socks5_port) {
					socks5 = true;
					connectionOptions.host = settings.socks5_host;
					connectionOptions.port = settings.socks5_port;
				}
				ircConnection = net.connect(connectionOptions,
					function() { //'connect' listener
						if (socks5) {
							initSocks(connectionInfo.host, connectionInfo.port, initIrc);
						} else {
							initIrc();
						}
				});
				nBotObject.ircConnection=ircConnection;
				botF.emitBotEvent('botIrcConnectionCreated', ircConnection);
			}
			connect();
		}
	};
	
	// nBot main object
	var nBotObject = {
		init: botF.initIrcBot,
		ircConnection: ircConnection,
		botEventsEmitter: function () {var botEventsEmitter = new events.EventEmitter(); botEventsEmitter.setMaxListeners(0); return botEventsEmitter;}(),
		kill: function () {ircConnection.end(); ircConnection.destroy();},
		publicData: {
			settings: settings,
			globalSettings: globalSettings,
			ircBotHost: ircBotHost,
			ircChannelUsers: ircChannelUsers,
			botFunctions: botF,
			botVariables: botV
		},
		pluginData: {}
	};
	
	//load plugins from settings
	for (var index in settings.plugins) {
		botF.botPluginLoad(settings.plugins[index],  settings.pluginDir+'/'+settings.plugins[index]+'.js');
	}
	
	return nBotObject;
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
