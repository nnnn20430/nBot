#!/usr/bin/env node

"use strict";
//variables
var http = require('http');
var net = require('net');
var readline = require('readline');
var fs = require('fs');
var util = require('util');
var events = require("events");
var sys = require('sys');
var exec = require('child_process').exec;
var settings;
var connections = [];
var connectionsTmp = [];
var terminalCurrentConnection = 0;

//handle wierd errors
process.on('uncaughtException', function (err) {
	console.log(err.stack);
});

//settings management
var settingsConstructor = {
	main: function (modified) {
		var mainSettings, attrname;
		if (this!==settingsConstructor) {
			mainSettings = {
				terminalSupportEnabled: true,
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
		if (this!==settingsConstructor) {
			connectionSettings = {
				connectionName: 'Connection0',
				botName: 'nBot',
				botMode: '0',
				ircServer: 'localhost',
				ircServerPort: 6667,
				ircServerPassword: '',
				channels: [ 'mindcraft' ],
				ircRelayServerEnabled: true,
				ircMaxCommandResponseWaitQueue: 30,
				plugins: [ 'core' ],
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
			fs.writeFile(file, JSON.stringify(new settingsConstructor.main({
				connections: [new settingsConstructor.connection({
					channels: [
						'#mindcraft',
						'#BronyTalkTest',
						'#BronyTalk',
						'#parasprite'
					]
				})]
			}), null, '\t'), function (err) {if (err) throw err; botSettingsLoad(file, callback);});
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
	process.stdout.write("\x1b[1G\x1b[2K");
	process.stdout.write(terminalBuffer[terminalBufferCurrent].substr(terminalGetCursorPos()[1], process.stdout.columns));
	process.stdout.write("\x1b["+terminalGetCursorPos()[0]+"G");
}

function terminalGetCursorPos(){
	var positionAbsolute = terminalCursorPositionAbsolute-1;
	var offsetCount = Math.floor(positionAbsolute/process.stdout.columns);
	var adjustedOffsetCount = Math.floor((positionAbsolute+offsetCount)/process.stdout.columns);
	var offsetRemainder = (positionAbsolute+adjustedOffsetCount)%process.stdout.columns;
	var postionOffset = adjustedOffsetCount*process.stdout.columns-adjustedOffsetCount;
	offsetRemainder+=1;
	return [offsetRemainder, postionOffset];
}

function terminalProcessInput(chunk) {
	var terminalCommandArgs = getArgsFromString(chunk)[0];
	if (terminalCommandArgs[0] == '/raw') {connectionsTmp[terminalCurrentConnection].ircConnection.write(terminalCommandArgs[1]+'\r\n');}
	if (terminalCommandArgs[0] == '/join') {
		var botIsInChannel = false;
		for (var channel in connections[terminalCurrentConnection].channels) {if (connections[terminalCurrentConnection].channels[channel] == terminalCommandArgs[1]) {botIsInChannel = true;}}
		if (!botIsInChannel) {connections[terminalCurrentConnection].channels.arrayValueAdd(terminalCommandArgs[1]);}
	}
	if (terminalCommandArgs[0] == '/part') {
		var partReason = "Leaving";
		if (terminalCommandArgs[2] !== undefined) {partReason=terminalCommandArgs[2];}
		connections[terminalCurrentConnection].channels.arrayValueRemove(terminalCommandArgs[1]);
		connectionsTmp[terminalCurrentConnection].ircConnection.write('PART '+terminalCommandArgs[1]+' :'+partReason+'\r\n');
	}
	if (terminalCommandArgs[0] == '/say') {
		if (terminalCommandArgs[2] !== undefined) {
			terminalLog('['+terminalCurrentConnection+':'+terminalCommandArgs[1]+'] '+connections[terminalCurrentConnection].botName+': '+terminalCommandArgs[2]);
			connectionsTmp[terminalCurrentConnection].ircConnection.write('PRIVMSG '+terminalCommandArgs[1]+' :'+terminalCommandArgs[2]+'\r\n');
		}
		terminalLastChannel = terminalCommandArgs[1];
	}
	if (terminalCommandArgs[0] == '/quit') {
		var quitReason = terminalCommandArgs[1]||"Leaving";
		killAllnBotInstances(quitReason);
		terminalLog('quiting...');
		setTimeout(function () {killAllnBotInstances(null, true);process.exit();}, 1000);
	}
	if (terminalCommandArgs[0] == '/connection') {
		var connectionId = terminalCommandArgs[1];
		for (var connection in connections) {if (connections[connection].connectionName == terminalCommandArgs[1]) {connectionId = connection;}}
		if (connectionsTmp[connectionId] !== undefined) {
			terminalCurrentConnection = connectionId;
		}
	}
	if (terminalCommandArgs[0] == '/fakemsg') {
		connectionsTmp[terminalCurrentConnection].publicData.botFunctions.emitBotEvent('botReceivedPRIVMSG', ['terminal', 'terminal', 'terminal', 'terminal', 'terminal', terminalCommandArgs[1]]);
	}
	if (chunk.charAt(0) != '/') {
		terminalLog('['+terminalCurrentConnection+':'+terminalLastChannel+'] '+connections[terminalCurrentConnection].botName+': '+chunk);
		connectionsTmp[terminalCurrentConnection].ircConnection.write('PRIVMSG '+terminalLastChannel+' :'+chunk+'\r\n');
	}
}

function initTerminalHandle() {
	terminalLastChannel = connections[terminalCurrentConnection].channels[0];
	terminalBuffer = [""]; terminalBufferCurrent = 0; terminalBufferMax = 10; terminalCursorPositionAbsolute = 1; terminalBufferCurrentUnModifiedState = "";

	process.stdin.setEncoding('utf8');
	process.stdin.setRawMode(true);
	
	process.stdin.on('readable', function() {
		var chunk = process.stdin.read();
		//console.log(chunk);
		if (chunk !== null) {
			if (chunk == "\x0d") {
				//enter
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
				killAllnBotInstances('stdin received ^C');
				terminalLog('quiting...');
				setTimeout(function () {killAllnBotInstances(null, true);process.exit();}, 1000);
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
		return this.replace(/#csi;/g, '\x1B[').replace(/#c;/g, '\x03').replace(/#reset;/g, '\x0F').replace(/#underline;/g, '\x1F').replace(/#bold;/g, '\x02').replace(/#italic;/g, '\x16').replace(new RegExp('#x([0-9a-fA-F]{2});', 'g'), function(regex, hex){return hex.fromHex();}).replace(new RegExp('#u([0-9a-fA-F]{4});', 'g'), function(regex, hex){return hex.fromUtf8Hex();});
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

//misc functions

//misc functions: get shell like arguments from a string
function getArgsFromString(str) {
	var strARGS = {}, strARGC = 0, strARG, strARGRegex = new RegExp('(?:(?:(?:")+((?:(?:[^\\\\"]+(?=(?:"|\\\\"|\\\\)))(?:(?:(?:\\\\)*(?!"))?(?:\\\\")?)*)+)(?:"))+|([^ ]+)+)+(?: )?', 'g');
	while ((strARG = strARGRegex.exec(str)) !== null) {if(strARG[1] !== undefined){strARGS[strARGC]=strARG[1].replace(new RegExp('\\\\"', 'g'), '"');}else{strARGS[strARGC]=strARG[2];}strARGC++;}
	return [strARGS, strARGC];
}

//misc functions: irc relay
var ircRelayServerEmitter = new events.EventEmitter(); ircRelayServerEmitter.setMaxListeners(0);
function ircRelayMessageHandle(c) {
	ircRelayServerEmitter.once('newIrcMessage', function (connection, from, to, message) {
		if (c.writable) {
			c.write(connection+':'+from+':'+to+':'+message+'\r\n');
			ircRelayMessageHandle(c);
		}
	});
}

function ircRelayServer(){
	var server = net.createServer(function(c) { //'connection' listener
		debugLog('client connected to irc relay');
		c.on('end', function() {
			debugLog('client disconnected from irc relay');
		});
		ircRelayMessageHandle(c);
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

//misc functions: handle irc message event from bot instance
function handleReceivedPRIVMSGEvent(connection, data) {
	var connectionName = connections[connection].connectionName||connection;
	debugLog('['+connectionName+':'+data[4]+'] '+data[1]+': '+data[5]);
	if (settings.ircRelayServerEnabled && connections[connection].ircRelayServerEnabled) {
		ircRelayServerEmitter.emit('newIrcMessage', connectionName, data[1], data[4], data[5]);
	}
}

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

//main bot class
function nBot_instance(settings, globalSettings) {
	var ircConnection;
	var ircBotHost = "";
	var ircChannelUsers = {};
	var ircCommandReEventsEmitter = new events.EventEmitter(); ircCommandReEventsEmitter.setMaxListeners(settings.ircMaxCommandResponseWaitQueue+2);
	var emitter = new events.EventEmitter(); emitter.setMaxListeners(0);
	var privateData = {};
	
	//clean old command events
	ircCommandReEventsEmitter.on('newListener', function (data) {
		var listeners = ircCommandReEventsEmitter.listeners(data);
		while (listeners.length > settings.ircMaxCommandResponseWaitQueue) {ircCommandReEventsEmitter.removeListener(data, listeners[0]);listeners = ircCommandReEventsEmitter.listeners(data);}
	});
	
	//bot functions object
	var botF = {
		//exposed local functions
		botSettingsLoad: botSettingsLoad,
		botSettingsSave: botSettingsSave,
		getArgsFromString: getArgsFromString,
		
		//misc bot functions
		
		//misc bot functions: parse whois for channels
		ircWhoisParseChannels: function (data) {
			var channels = new RegExp('(?:'+data[1]+' :(?:[^# \r\n]?#[^ \r\n]+ )+\r\n(?:.*(?='+data[1]+' :(?:[^# \r\n]?#[^ \r\n]+ )*\r\n))?)+').exec(data[0]),
				channelRegexp = new RegExp('[^#]{0,1}(#[^ ]*) ', 'g'),
				result,
				userChannels = [],
				userChannelsC = 0;
			if (channels !== null) {
				while ((result = channelRegexp.exec(channels[0])) !== null) {userChannels[userChannelsC] = result[1];userChannelsC++;}
			}
			return [userChannels, userChannelsC];
		},
		
		//misc bot functions: join missing channels
		ircJoinMissingChannels: function (data) {
			var channelArray=botF.ircWhoisParseChannels(data);
			var missingChannels=settings.channels.diff(channelArray[0]);
			for (var channel in missingChannels){
				if(settings.channels.hasOwnProperty(channel)){
					botF.debugMsg("joining channel: "+missingChannels[channel]);
					botF.sendCommandJOIN(missingChannels[channel]);
				}
				
			}	
		},
		
		//misc bot functions: update tracked user data in channel
		ircUpdateUsersInChannel: function (channel) {
			function ircUpdateTrackedUsersFromWhoMessage(data) {
				var regex = new RegExp('352 (?:[^ \r\n]* ){1}([^ \r\n]+) (?:[^ \r\n]+ ){3}([^ \r\n]+) (H|G){1}(\\*){0,1}(@|\\+|~|%|&|!|-){0,1} :(?:[^\r\n]*)', 'g'), whoData, whoDataObject = {};
				while ((whoData = regex.exec(data[0])) !== null) {
					whoDataObject[whoData[2]] = {};
					if ((ircChannelUsers[data[1]] && ircChannelUsers[data[1]][whoData[2]]) !== undefined) {whoDataObject[whoData[2]] = ircChannelUsers[data[1]][whoData[2]];}
					if (whoData[3] !== undefined && whoData[3] == "H") {whoDataObject[whoData[2]].isHere = true;}else{whoDataObject[whoData[2]].isHere = false;}
					if (whoData[4] !== undefined && whoData[4] == "*") {whoDataObject[whoData[2]].isGlobalOP = true;}else{whoDataObject[whoData[2]].isGlobalOP = false;}
					if (whoData[5] !== undefined) {whoDataObject[whoData[2]].mode = whoData[5];}else{whoDataObject[whoData[2]].mode = "";}
				}
				ircChannelUsers[data[1]] = whoDataObject;
			}
			botF.sendCommandWHO(channel, function (data) {ircUpdateTrackedUsersFromWhoMessage(data);});
		},
		
		//misc bot functions: handle post connection registation 
		ircPostConnectionRegistrationHandle: function () {
			var ircIntervalUpdate;
			botF.debugMsg('connected to irc server!');
			botF.sendCommandWHOIS(settings.botName, function (data) {botF.ircJoinMissingChannels(data);});
			ircIntervalUpdate = setInterval(function () {botF.sendCommandWHOIS(settings.botName, function (data) {botF.ircJoinMissingChannels(data);});}, 5000);
			nBotObject.ircConnection.once('close', function() {clearInterval(ircIntervalUpdate);});
		},
		
		//misc bot functions: emit debug message event
		debugMsg: function (data) {
			nBotObject.botEventsEmitter.emit('botDebugMessage', data);
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
		botPluginLoad: function (id, path) {
			function pluginHandleBotEvent(id) {
				nBotObject.botEventsEmitter.once('botEvent', function (data) {
					if (nBotObject.pluginData[id] && nBotObject.pluginData[id].botEvent) {
						try {
							nBotObject.pluginData[id].botEvent(data);
						} catch (e) {
							botF.debugMsg('Error happend when passing botEvent "'+data.eventName+'" to plugin "'+id+'": ('+e+')');
						}
						pluginHandleBotEvent(id);
					}
				});
			}
			(function () {
				try {
					nBotObject.pluginData[id] = require(path);
					nBotObject.pluginData[id].main({id: id, botObj: nBotObject});
					if (nBotObject.pluginData[id].botEvent) {
						pluginHandleBotEvent(id);
					}
				} catch (e) {
					botF.debugMsg('Error happend when loading plugin "'+id+'": ('+e+')');
				}
			})();
		},
		
		//misc bot functions: disable a plugin
		botPluginDisable: function (id) {
			try {
				nBotObject.pluginData[id].botEvent({eventName: 'botPluginDisableEvent', eventData: 'disable'});
				delete nBotObject.pluginData[id];
			} catch (e) {
				botF.debugMsg('Error happend when disabling plugin "'+id+'": ('+e+')');
			}
		},
		
		//irc command functions
		sendCommandPRIVMSG: function (data, to, timeout, forceTimeout){
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
		
		sendCommandWHOIS: function (user, callback) {
			ircConnection.write('WHOIS '+user+'\r\n');
			function handleresponseWHOISEvent(user) {
				ircCommandReEventsEmitter.once('responseWHOIS', function (data, dataString, dataArray) {
					if (data[1] == user) {
						if (callback !== undefined) {callback(data, dataString, dataArray);}
					}else{handleresponseWHOISEvent(user);}
				});
			}
			handleresponseWHOISEvent(user);
		},
		
		sendCommandWHO: function (channel, callback) {
			ircConnection.write('WHO '+channel+'\r\n');
			function handleresponseWHOEvent(channel) {
				ircCommandReEventsEmitter.once('responseWHO', function (data, dataString, dataArray) {
					if (data[1] == channel) {
						if (callback !== undefined) {callback(data, dataString, dataArray);}
					}else{handleresponseWHOEvent(channel);}
				});
			}
			handleresponseWHOEvent(channel);
		},
		
		sendCommandJOIN: function (channel) {
			ircConnection.write('JOIN '+channel+'\r\n');
			botF.ircUpdateUsersInChannel(channel);
		},
		
		sendCommandPART: function (channel, reason) {
			reason = reason||"Leaving";
			ircConnection.write('PART '+channel+' :'+reason+'\r\n');
		},
		
		sendCommandQUIT: function (reason) {
			reason = reason||"Leaving";
			ircConnection.write('QUIT :'+reason+'\r\n');
		},
		
		sendCommandMODE: function (target, mode) {
			ircConnection.write('QUIT '+target+' '+mode+'\r\n');
		},
		
		//irc command handle functions
		responseHandlePRIVMSG: function (data) {
			var privmsgArgs = data.slice(0, 4).concat(new RegExp('((?:#){0,1}[^ \r\n]+) :([^\r\n]*)').exec(data[5]).slice(1));
			botF.emitBotEvent('botReceivedPRIVMSG', privmsgArgs);
		},
		
		responseHandleWHOIS: function (dataString, dataArray) {
			botF.emitBotEvent('botReceivedWHOIS', {dataString: dataString, dataArray: dataArray});
			var ircWHOISheader = new RegExp('^[^ \r\n]* 311 '+settings.botName+' ([^ \r\n]+) ([^ \r\n]+) ([^ \r\n]+) \\* :([^\r\n]+)').exec(dataArray[0]);
			if (ircWHOISheader !== null) {
				ircWHOISheader=ircWHOISheader.slice(1);
				var data = [dataString].concat(ircWHOISheader);
				if (ircWHOISheader[0] == settings.botName) {ircBotHost=ircWHOISheader[2];}
				ircCommandReEventsEmitter.emit('responseWHOIS', data, dataString, dataArray);
			}
		},
		
		responseHandleWHO: function (dataString, dataArray) {
			botF.emitBotEvent('botReceivedWHO', {dataString: dataString, dataArray: dataArray});
			var channel = new RegExp('^[^ \r\n]* 352 '+settings.botName+' ([^ \r\n]+)').exec(dataArray[0]);
			if (channel !== null) {
				channel=channel.slice(1);
				ircCommandReEventsEmitter.emit('responseWHO', [dataString].concat(channel), dataString, dataArray);
			}
		},
		
		responseHandleJOIN: function (data) {
			var joinArgs = data.slice(0, 4).concat(new RegExp('(?::){0,1}(#[^ \r\n]*)').exec(data[5]).slice(1));
			botF.emitBotEvent('botReceivedJOIN', joinArgs);
			if (joinArgs[1] != settings.botName){
				botF.ircUpdateUsersInChannel(joinArgs[4]);
			}
		},
		
		responseHandlePART: function (data) {
			var partArgs = data.slice(0, 4).concat(new RegExp('((?:#){0,1}[^ \r\n]+)(?: :){0,1}([^\r\n]*)').exec(data[5]).slice(1));
			botF.emitBotEvent('botReceivedPART', partArgs);
			if (partArgs[1] != settings.botName){
				delete ircChannelUsers[partArgs[4]][partArgs[1]];
			}
		},
		
		responseHandleQUIT: function (data) {
			
			var quitArgs = data.slice(0, 4).concat(new RegExp(':([^\r\n]*)').exec(data[5]).slice(1));
			botF.emitBotEvent('botReceivedQUIT', quitArgs);
			if (quitArgs[1] != settings.botName){
				for (var channel in ircChannelUsers) {
					if (ircChannelUsers[channel][quitArgs[1]] !== undefined) {
						delete ircChannelUsers[channel][quitArgs[1]];
					}
				}
			}
		},
		
		responseHandleMODE: function (data) {
			var modeArgs = data.slice(0, 4).concat(new RegExp('([^ \r\n]*) ([^\r\n]*)').exec(data[5]).slice(1));
			botF.emitBotEvent('botReceivedMODE', modeArgs);
			var user, mode;
			if ((user = modeArgs[5].split(' ')[1]) !== undefined){
				var channel = modeArgs[2];
				botF.sendCommandWHOIS(user, function (_, __, dataArray) {if ((mode = new RegExp('(?::| )([^# \r\n]{0,1})'+channel).exec(dataArray[0])) !== null) {ircChannelUsers[channel][user].mode = mode[1];}});
			}
		},
		
		responseHandleNICK: function (data) {
			var nickArgs = data.slice(0, 4).concat(new RegExp('([^\r\n]*)').exec(data[5]).slice(1));
			botF.emitBotEvent('botReceivedNICK', nickArgs);
			if (nickArgs[1] != settings.botName){
				for (var channel in ircChannelUsers) {
					if (ircChannelUsers[channel][nickArgs[1]] !== undefined) {
						ircChannelUsers[channel][nickArgs[4]]=ircChannelUsers[channel][nickArgs[1]];
						delete ircChannelUsers[channel][nickArgs[1]];
					}
				}
			}
		},
		
		responseHandleKICK: function (data) {
			var kickArgs = data.slice(0, 4).concat(new RegExp('(#[^ \r\n]*) ((?:(?! :)[^\r\n])*) :[^\r\n]*').exec(data[5]).slice(1));
			botF.emitBotEvent('botReceivedKICK', kickArgs);
			if (kickArgs[3] != settings.botName){
				delete ircChannelUsers[kickArgs[4]][kickArgs[5]];
			}
		},
		
		//main irc data receiving function
		ircDataReceiveHandle: function (data, ircConnection) {
			//console.log(data);
			var ircMessageLines = {}, ircMessageLineC = 0, ircMessageLine, ircMessageLineRegex = new RegExp('([^\r\n]+)', 'g');
			while ((ircMessageLine = ircMessageLineRegex.exec(data)) !== null) {ircMessageLines[ircMessageLineC]=ircMessageLine[1];ircMessageLineC++;}
			for (var lineC in ircMessageLines) {
				lineC = +lineC;
				var line=ircMessageLines[lineC];
				//parse single lines here
				var ircCommandMessage = new RegExp(':([^! \r\n]+)!([^@ \r\n]+)@([^ \r\n]+) ([^ \r\n]+) ([^\r\n]*)').exec(line), msgArgRegex, ircMessageData;
				if (ircCommandMessage !== null) {
					try {
						switch (ircCommandMessage[4]) {
								case 'PRIVMSG': botF.responseHandlePRIVMSG(ircCommandMessage); break;
								case 'JOIN': botF.responseHandleJOIN(ircCommandMessage); break;
								case 'PART': botF.responseHandlePART(ircCommandMessage); break;
								case 'QUIT': botF.responseHandleQUIT(ircCommandMessage); break;
								case 'MODE': botF.responseHandleMODE(ircCommandMessage); break;
								case 'NICK': botF.responseHandleNICK(ircCommandMessage); break;
								case 'KICK': botF.responseHandleKICK(ircCommandMessage); break;
						}
					} catch (e) {
						botF.debugMsg('Error happend when processing server message: ('+e+')');
					}
				}
				var ircMultilineMessageNumeric, ircMultilineMessageMaxLines=30;
				if (privateData.ircUnfinishedMultilineMessage !== undefined) {
					var c = privateData.ircUnfinishedMultilineMessage[3];
					if (new RegExp('^:[^ \r\n]* (318|315) '+settings.botName).exec(line) === null) {
						privateData.ircUnfinishedMultilineMessage[1]+=line+"\r\n";
						privateData.ircUnfinishedMultilineMessage[2][c+1]=line;
						privateData.ircUnfinishedMultilineMessage[3]++;
						if (privateData.ircUnfinishedMultilineMessage[3] == ircMultilineMessageMaxLines+2) {delete privateData.ircUnfinishedMultilineMessage;}
					}else{
						if (privateData.ircUnfinishedMultilineMessage[0] == "311") {botF.responseHandleWHOIS(privateData.ircUnfinishedMultilineMessage[1], privateData.ircUnfinishedMultilineMessage[2]);}
						if (privateData.ircUnfinishedMultilineMessage[0] == "352") {botF.responseHandleWHO(privateData.ircUnfinishedMultilineMessage[1], privateData.ircUnfinishedMultilineMessage[2]);}
						delete privateData.ircUnfinishedMultilineMessage;
					}
				}else if ((ircMultilineMessageNumeric = new RegExp('^:[^ \r\n]* (311|352) '+settings.botName).exec(line)) !== null) {
					ircMultilineMessageNumeric=ircMultilineMessageNumeric[1];
					privateData.ircUnfinishedMultilineMessage=[ircMultilineMessageNumeric, line+"\r\n", [line], 0];
				}
			}
			//parse whole response here
			/* old multiline message handle (i liked the regex)
			var ircWHOIS, ircWHOISRegex = new RegExp('311 (?:[^ \r\n]* ){0,1}([^ \r\n]+) (?:[^ \r\n]+ ){2}(?=\\*)\\* :[^\r\n]*((?!\r\n:[^:\r\n]*:End of \\/WHOIS list)\r\n:[^\r\n]*)*\r\n:[^:\r\n]*:End of \\/WHOIS list', 'g'),
				ircWHO, ircWHORegex = new RegExp('352 (?:[^ \r\n]* ){0,1}([^ \r\n]+) (?:[^ \r\n]+ ){3}(?=[^ \r\n]+ (?:H|G)+)([^ \r\n]+) (?:H|G){1}(?:\\*){0,1}(?:@|\\+|~|%|&|!|-){0,1} :[^\r\n]*((?!\r\n:[^:\r\n]*:End of \\/WHO list)\r\n:[^\r\n]*)*\r\n:[^:\r\n]*:End of \\/WHO list', 'g');
			while ((ircWHOIS = ircWHOISRegex.exec(data)) !== null) {responseHandleWHOIS(ircWHOIS);}
			while ((ircWHO = ircWHORegex.exec(data)) !== null) {responseHandleWHO(ircWHO);}
			*/
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
					botF.ircDataReceiveHandle(chunk, ircConnection);
				}
				if (ircConnectionRegistrationCompleted === false) {
					if (new RegExp(':[^ \r\n]* 001 '+settings.botName, 'g').exec(chunk) !== null) {
						ircConnectionRegistrationCompleted = true;
						botF.ircPostConnectionRegistrationHandle();
					}
				}
			}
			ircConnection = net.connect({port: connectionInfo.port, host: connectionInfo.host},
				function() { //'connect' listener
					ircConnection.setEncoding('utf8');
					ircConnection.on('data', ircConnectionOnData);
					if (settings.ircServerPassword) {ircConnection.write('PASS '+settings.ircServerPassword+'\r\n');}
					ircConnection.write('NICK '+connectionInfo.nick+'\r\n');
					ircConnection.write('USER '+connectionInfo.nick+' '+connectionInfo.mode+' '+connectionInfo.host+' :'+connectionInfo.nick+'\r\n');
			});
			nBotObject.ircConnection=ircConnection;
			botF.emitBotEvent('botIrcConnectionCreated', ircConnection);
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
			botFunctions: botF
		},
		pluginData: {}
	};
	
	//load plugins from settings
	for (var index in settings.plugins) {
		botF.botPluginLoad(settings.plugins[index], __dirname+'/plugins/'+settings.plugins[index]+'.js');
	}
	
	return nBotObject;
}

//load settings and start the bot
botSettingsLoad(null, function (data) {
	settings = data;
	connections = settings.connections;
	if(settings.terminalSupportEnabled){initTerminalHandle();}
	if(settings.ircRelayServerEnabled){ircRelayServer();}
	function handleBotEvent(connection, event) {
		switch (event.eventName) {
			case 'botReceivedPRIVMSG': handleReceivedPRIVMSGEvent(connection, event.eventData); break;
		}
	}
	for (var connection in connections) {
		connectionsTmp[connection]=new nBot_instance(connections[connection], settings);
		connectionsTmp[connection].init();
		connectionsTmp[connection].botEventsEmitter.on('botEvent', handleBotEvent.bind(undefined, connection));
		connectionsTmp[connection].botEventsEmitter.on('botDebugMessage', handleBotDebugMessageEvent.bind(undefined, connection));
	}
});
