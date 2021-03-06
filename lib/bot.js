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
//variables
var net = require('net');
var tls = require('tls');
var path = require('path');
var util = require(__dirname+'/util');

//export the constructor
module.exports = CreateBotInstance;

//irc bot constructor
function CreateBotInstance(options) {
	//force 'new' object keyword
	if(!(this instanceof CreateBotInstance)) {
		return new CreateBotInstance(options);
	}

	//bot object
	var bot = this;

	//variables
	bot.options = options;
	bot.ircConnection = null;
	bot.ircMessageBuffer = null;
	bot.ircMultilineMessageBuffer = null;
	bot.ircMsgHandles = {};
	bot.ircMsgNumHandles = {};
	bot.ircConnectionRegistered = false;
	bot.ircBotHost = "";
	bot.ircChannelUsers = {};
	bot.ircSupportedChanModes = {};
	bot.ircSupportedUserModesArray = [
		['o', '@'],
		['v', '+']
	];
	bot.ircNetworkServers = [];
	bot.ircResponseListenerObj = {};
	bot.ircResponseListenerLimit = options.ircResponseListenerLimit||30;
	bot.events = {};
	bot.plugins = {};

	//functions
	bot.init = function (o) {bot.initIrcBot(o);};

	bot.kill = function () {
		bot.ircConnection.end();
		bot.ircConnection.destroy();
	};

	//expose util functions
	util.objCopy(bot, util);

	//misc bot functions

	//misc bot functions: parse irc message line
	bot.ircParseMessageLine = function (message) {
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

	bot.strReplaceEscapeSequences = function (str) {
		return str
			.replace(/#csi;/g, '\x1B[')
			.replace(/#c;/g, '\x03')
			.replace(/#reset;/g, '\x0F')
			.replace(/#underline;/g, '\x1F')
			.replace(/#bold;/g, '\x02')
			.replace(/#italic;/g, '\x16')
			.replace(new RegExp('#x([0-9a-fA-F]{2});', 'g'),
				function(regex, hex){return bot.strFromHex(hex);})
			.replace(new RegExp('#u([0-9a-fA-F]{4});', 'g'),
				function(regex, hex){return bot.strFromUtf8Hex(hex);});
	};

	//misc bot functions: perform updates based on self whois
	bot.ircBotUpdateSelf = function () {
		function whoisHandle(data) {
			var channels = '';
			for (var line in data[1]) {
				if (data[1][line][2] == 319) {
					channels += data[1][line][5].replace(/[^ #]{0,1}#/g, '#');
				}
			}
			var channelArray = channels.split(' ');
			var missingChannels = bot.arrDiff(
				options.channels, channelArray
			);
			for (var channel in missingChannels){
				if(options.channels.hasOwnProperty(channel)){
					bot.log("joining channel: "+missingChannels[channel]);
					bot.ircSendCommandJOIN(missingChannels[channel]);
				}
			}
			function initMissingChannelUserData(channels) {
				bot.ircUpdateUsersInChannel(channels[0], function() {
					initMissingChannelUserData(channels.slice(1));
				});
			}
			initMissingChannelUserData(
				bot.arrDiff(
					channelArray, Object.keys(
						bot.ircChannelUsers
					)
				)
			);
		}
		bot.ircSendCommandWHOIS(options.botName, function (data) {
			whoisHandle(data);
		});
	};

	//misc bot functions: update tracked user data in channel
	bot.ircUpdateUsersInChannel = function (channel, callback) {
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
						mode: bot.ircModePrefixConvert('mode', (params[6].charAt(1) == '*' ? params[6].substr(2) : params[6].substr(1))),
						hopcount: data[1][line][5].split(' ')[0],
						realname: data[1][line][5].split(' ').slice(1).join(' ')
					};
				}
			}
			for (var channel in parsedData) {
				var newChannelData = {};
				if (bot.ircChannelUsers[channel] === undefined ) {
						bot.ircChannelUsers[channel] = {};
				}
				for (var nick in parsedData[channel]) {
					newChannelData[nick] = {};
					if (bot.ircChannelUsers[channel][nick] !== undefined ) {
						newChannelData[nick] = bot.ircChannelUsers[channel][nick];
					}
					for (var attrname in parsedData[channel][nick]) {
						newChannelData[nick][attrname]=parsedData[channel][nick][attrname];
					}
				}
				bot.ircChannelUsers[channel] = newChannelData;
			}
			if(callback !== undefined) {callback(parsedData);}
		}
		bot.ircSendCommandWHO(channel, function (data) {ircUpdateTrackedUsersFromWhoMessage(data);});
	};

	//misc bot functions: handle connection registation
	bot.ircConnectionRegisteredHandle = function () {
		bot.emitBotEvent('botIrcConnectionRegistered', null);
		bot.log('connected to irc server!');
		bot.ircWriteData('LINKS');
	};

	//misc bot functions: emit debug message event
	bot.log = function (data) {
		bot.eventsEmit('botLogMessage', data);
	};

	//misc bot functions: emit botEvent event
	bot.emitBotEvent = function (name, data) {
		try {
			bot.eventsEmit('botEvent', {eventName: name, eventData: data});
		} catch (e) {
			bot.log('Error when emitting "botEvent" event with name "'+name+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
		}
	};

	//misc bot functions: load a plugin
	bot.pluginLoad = function (id, pluginPath) {
		pluginPath = path.resolve(pluginPath);
		function pluginAddBotEventListener(id) {
			bot.eventsAdd('botEvent', function (data) {
				if (bot.plugins[id] && bot.plugins[id].botEvent) {
					if (!(data.eventName == 'botPluginDisableEvent' && data.eventData == id)) {
						pluginAddBotEventListener(id);
					}
					try {
						bot.plugins[id].botEvent(data);
					} catch (e) {
						bot.log('Error happened when passing botEvent "'+data.eventName+'" to plugin "'+id+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
					}
				}
			}, true);
		}
		(function () {
			try {
				if (bot.plugins[id]) {
					bot.log('Plugin "'+id+'" is already registered, trying to disable before attempting to load...');
					bot.pluginDisable(id);
				}
				bot.plugins[id] = require(pluginPath);
				bot.plugins[id].main(id, bot);
				bot.emitBotEvent('botPluginLoadedEvent', id);
				if (bot.plugins[id].botEvent) {
					pluginAddBotEventListener(id);
				}
				//Do not cache plugins
				if (require.cache && require.cache[pluginPath]) {
					delete require.cache[pluginPath];
				}
			} catch (e) {
				bot.log('Error happened when loading plugin "'+id+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
			}
		})();
	};

	//misc bot functions: disable a plugin
	bot.pluginDisable = function (id) {
		try {
			bot.emitBotEvent('botPluginDisableEvent', id);
			delete bot.plugins[id];
		} catch (e) {
			bot.log('Error happened when disabling plugin "'+id+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
		}
	};

	//misc bot functions: convert between modes and prefixes
	bot.ircModePrefixConvert = function (convertTo, str) {
		var strArray = str.split('');
		var strChar;
		var mode;
		switch (convertTo) {
			case 'prefix':
				for (mode in bot.ircSupportedUserModesArray) {
					for (strChar in strArray) {
						if (strArray[strChar] == bot.ircSupportedUserModesArray[mode][0]) {
							strArray[strChar] = bot.ircSupportedUserModesArray[mode][1];
						}
					}
				}
				break;
			case 'mode':
				for (mode in bot.ircSupportedUserModesArray) {
					for (strChar in strArray) {
						if (strArray[strChar] == bot.ircSupportedUserModesArray[mode][1]) {
							strArray[strChar] = bot.ircSupportedUserModesArray[mode][0];
						}
					}
				}
				break;
		}
		return strArray.join('');
	};

	//simple events, cause why not, i reinvented the wheel everywhere else anyway
	bot.eventsEmit = function (event, data) {
		var e = bot.events[event], ec, l, n = [], i = 0;
		if (e !== undefined) {
			ec = util.objCopy([], e);
			for (l in ec) {
				if (ec[l].once === true) delete e[l];
				try {
					ec[l].handle(data);
				} catch (e) {
					bot.log('Error when emitting "'+event+'" event:'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
				}
			}
			for (l in e) {
				n[i] = e[l];
				i++;
			}
			if (n.length === 0)
				delete bot.events[event];
			else
				bot.events[event] = n;
		}
	};

	//add listener
	bot.eventsAdd = function (event, handle, once) {
		once = once||false;
		var l;
		if (bot.events[event] === undefined)
			bot.events[event] = [];
		for (l in bot.events[event]);
		if (l === undefined) l = -1;
		bot.events[event][+l+1] = {'handle': handle, 'once': once};
	};

	//remove listener
	bot.eventsRemove = function (event, handle) {
		var s, l, r = false, n = [], i = 0;
		if (bot.events[event] !== undefined) {
			s = bot.events[event].length;
			for (l in bot.events[event]) {
				if (bot.events[event][s-(+l+1)].handle !== handle || r)
					n[+l-i] = bot.events[event][s-(+l+1)];
				else {i++; r = true;}
			}
			if (n.length === 0)
				delete bot.events[event];
			else
				bot.events[event] = n.reverse();
		}
	};

	//misc bot functions: emit irc response to listeners
	bot.ircResponseListenerEmit = function (command, data) {
		var listenerArr;
		var newArray;
		var listenerObj;
		var save;
		for (var id in bot.ircResponseListenerObj) {
			listenerArr = util.objCopy([], bot.ircResponseListenerObj[id]);
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
								bot.log('Error when emitting irc response command "'+command+'" event to listener "'+id+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
							}
						}
					} catch (e) {
						bot.log('Error checking irc response event condition for command "'+command+'" listener "'+id+'":'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
					}
				}
				if (bot.isNumeric(listenerObj.ttl)) {
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
			bot.ircResponseListenerObj[id] = newArray.concat(
				bot.arrDiff(
					bot.ircResponseListenerObj[id], listenerArr
				)
			);
		}
	};

	//misc bot functions: add irc response listener
	bot.ircResponseListenerAdd = function (id, command, condition, handle, ttl) {
		var response = false;
		if (id && command && condition && handle) {
			if (!(bot.ircResponseListenerObj[id] instanceof Array)) {
				bot.ircResponseListenerObj[id] = [];
			}
			bot.ircResponseListenerObj[id].push({
				command: command,
				condition: condition,
				handle: handle,
				ttl: ttl
			});
			if (bot.ircResponseListenerObj[id].length >
			bot.ircResponseListenerLimit) {
				bot.ircResponseListenerObj[id].splice(0, 1);
			}
			response = true;
		}
		return response;
	};

	//misc bot functions: remove irc response listener(s)
	bot.ircResponseListenerRemove = function (id, command, condition, handle) {
		var response = false;
		var newArray;
		var listenerObj;
		var matchNeed;
		var matched;
		var save;
		if (id && bot.ircResponseListenerObj[id]) {
			if (command || condition || handle) {
				for (var listener in bot.ircResponseListenerObj[id]) {
					listenerObj = bot.ircResponseListenerObj[id][listener];
					matchNeed = 0;
					matched = 0;
					save = true;
					if (command) {matchNeed += 1;}
					if (condition) {matchNeed += 2;}
					if (handle) {matchNeed += 4;}
					if (listenerObj.command == command) {
						matched += 1;
					}
					if (listenerObj.condition == condition) {
						matched += 2;
					}
					if (listenerObj.handle == handle) {
						matched += 4;
					}
					if (matched == matchNeed) {save = false;}
					if (save) {
						newArray.push(listenerObj);
					}
				}
				bot.ircResponseListenerObj[id] = newArray;
			} else {
				delete bot.ircResponseListenerObj[id];
			}
		}
		return response;
	};

	//write raw data
	bot.ircWriteData = function (data) {
		bot.ircConnection.write(data+'\r\n');
	};

	//irc command functions
	bot.ircSendCommandPRIVMSG = function (data, to, timeout, forceTimeout){
		var command = "";
		command += ":";
		command += options.botName;
		command += "!";
		command += options.botName;
		command += "@"+bot.ircBotHost;
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
				bot.ircWriteData('PRIVMSG '+to+' :'+data[count]);
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

	bot.ircSendCommandNOTICE = function (data, to, timeout, forceTimeout){
		var command = "";
		command += ":";
		command += options.botName;
		command += "!";
		command += options.botName;
		command += "@"+bot.ircBotHost;
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
				bot.ircWriteData('NOTICE '+to+' :'+data[count]);
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

	bot.ircSendCommandWHOIS = function (user, callback, ttl) {
		bot.ircWriteData('WHOIS '+user);
		bot.ircResponseListenerAdd('core', '311', function (data) {
			if (data[1][0][3][1] == user) {return true;}
		}, function (data) {
			if (callback !== undefined) {callback(data);}
		}, ttl||10);
	};

	bot.ircSendCommandWHO = function (channel, callback, ttl) {
		bot.ircWriteData('WHO '+channel);
		bot.ircResponseListenerAdd('core', '352', function (data) {
			if (data[1][0][3][1] == channel) {
				return true;
			}
		}, function (data) {
			if (callback !== undefined) {callback(data);}
		}, ttl||10);
	};

	bot.ircSendCommandJOIN = function (channel) {
		bot.ircWriteData('JOIN '+channel);
	};

	bot.ircSendCommandPART = function (channel, reason) {
		reason = reason||"Leaving";
		bot.ircWriteData('PART '+channel+' :'+reason);
	};

	bot.ircSendCommandQUIT = function (reason) {
		reason = reason||"Leaving";
		bot.ircWriteData('QUIT :'+reason);
	};

	bot.ircSendCommandMODE = function (target, mode) {
		bot.ircWriteData('MODE '+target+' '+mode);
	};

	bot.ircSendCommandPING = function (data) {
		bot.ircWriteData('PING '+data);
	};

	bot.ircSendCommandPONG = function (data) {
		bot.ircWriteData('PONG '+data);
	};

	bot.ircSendCommandPASS = function (data) {
		bot.ircWriteData('PASS '+data);
	};

	bot.ircSendCommandNICK = function (data) {
		bot.ircWriteData('NICK '+data);
	};

	bot.ircSendCommandUSER = function (user, mode, realname) {
		bot.ircWriteData('USER '+user+' '+mode+' * :'+realname);
	};

	//irc response handle functions
	bot.ircMsgHandles.PRIVMSG = function (data) {
		bot.emitBotEvent('botReceivedPRIVMSG', data);
		bot.ircResponseListenerEmit('PRIVMSG', data);
	};

	bot.ircMsgHandles.NOTICE = function (data) {
		bot.emitBotEvent('botReceivedNOTICE', data);
		bot.ircResponseListenerEmit('NOTICE', data);
	};

	bot.ircMsgHandles.JOIN = function (data) {
		bot.emitBotEvent('botReceivedJOIN', data);
		bot.ircResponseListenerEmit('JOIN', data);
		var nick = data[1][0];
		var channel = data[5]||data[3][0];
		if (nick != options.botName){
			bot.ircUpdateUsersInChannel(channel);
		} else {
			bot.ircUpdateUsersInChannel(channel);
		}
	};

	bot.ircMsgHandles.PART = function (data) {
		bot.emitBotEvent('botReceivedPART', data);
		bot.ircResponseListenerEmit('PART', data);
		var nick = data[1][0];
		var channel = data[3][0];
		var reason = data[5];
		if (nick != options.botName){
			if (bot.ircChannelUsers[channel] && bot.ircChannelUsers[channel][nick]) {
				delete bot.ircChannelUsers[channel][nick];
			}
		} else {
			delete bot.ircChannelUsers[channel];
		}
	};

	bot.ircMsgHandles.QUIT = function (data) {
		bot.emitBotEvent('botReceivedQUIT', data);
		bot.ircResponseListenerEmit('QUIT', data);
		var nick = data[1][0];
		if (nick != options.botName){
			for (var channel in bot.ircChannelUsers) {
				if (bot.ircChannelUsers[channel][nick] !== undefined) {
					delete bot.ircChannelUsers[channel][nick];
				}
			}
		}
	};

	bot.ircMsgHandles.MODE = function (data) {
		bot.emitBotEvent('botReceivedMODE', data);
		bot.ircResponseListenerEmit('MODE', data);
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
							if (bot.ircChannelUsers[channel] && bot.ircChannelUsers[channel][user]) {
								bot.ircChannelUsers[channel][user].mode += bot.ircModePrefixConvert('mode', oModes[mode]);
							}
						}
						break;
					case '-':
						oModes = modes[+operation+1].split('');
						for (mode in oModes) {
							user = modeparams.splice(0, 1);
							if (bot.ircChannelUsers[channel] && bot.ircChannelUsers[channel][user]) {
								bot.ircChannelUsers[channel][user].mode = bot.ircChannelUsers[channel][user].mode.split(bot.ircModePrefixConvert('mode', oModes[mode])).join('');
							}
						}
						break;
				}
			}
		}
	};

	bot.ircMsgHandles.NICK = function (data) {
		bot.emitBotEvent('botReceivedNICK', data);
		bot.ircResponseListenerEmit('NICK', data);
		var nick = data[1][0];
		var newnick = data[5]||data[4][0];
		if (nick == options.botName){
			options.botName = newnick;
		}
		for (var channel in bot.ircChannelUsers) {
			if (bot.ircChannelUsers[channel][nick] !== undefined) {
				bot.ircChannelUsers[channel][newnick]=bot.ircChannelUsers[channel][nick];
				delete bot.ircChannelUsers[channel][nick];
			}
		}
	};

	bot.ircMsgHandles.KICK = function (data) {
		bot.emitBotEvent('botReceivedKICK', data);
		bot.ircResponseListenerEmit('KICK', data);
		var by = data[1][0];
		var channel = data[3][0];
		var nick = data[3][1];
		if (nick != options.botName){
			if (bot.ircChannelUsers[channel] && bot.ircChannelUsers[channel][nick]) {
				delete bot.ircChannelUsers[channel][nick];
			}
		}
	};

	bot.ircMsgHandles.TOPIC = function (data) {
		bot.emitBotEvent('botReceivedTOPIC', data);
		bot.ircResponseListenerEmit('TOPIC', data);
	};

	bot.ircMsgHandles.KILL = function (data) {
		bot.emitBotEvent('botReceivedKILL', data);
		bot.ircResponseListenerEmit('KILL', data);
	};

	bot.ircMsgHandles.PING = function (data) {
		bot.emitBotEvent('botReceivedPING', data);
		bot.ircResponseListenerEmit('PING', data);
		var pingMessage = data[5]||data[3][0];
		bot.ircSendCommandPONG(pingMessage);
	};

	bot.ircMsgNumHandles['001_001'] = function (data) {
		bot.emitBotEvent('botReceivedNum001', data);
		bot.ircResponseListenerEmit('001', data);
		if (bot.ircConnectionRegistered === false) {
			bot.ircConnectionRegistered = true;
			bot.ircConnectionRegisteredHandle();
		}
	};

	bot.ircMsgNumHandles['005_005'] = function (data) {//RPL_ISUPPORT
		bot.emitBotEvent('botReceivedNum005', data);
		bot.ircResponseListenerEmit('005', data);
		var params = data[1][0][3];
		for (var param in params) {
			var match = params[param].match(/([A-Z]+)=(.*)/);
			if (match) {
				switch (match[1]) {
					case 'CHANMODES':
						var modeData = match[2].split(',');
						bot.ircSupportedChanModes = {'A': modeData[0], 'B': modeData[1], 'C': modeData[2], 'D': modeData[3]};
					break;
					case 'PREFIX':
						var prefixData = match[2].match(/\((.*?)\)(.*)/);
						var userModeArray = [];
						for (var userMode in prefixData[1].split('')) {
							userModeArray.push([prefixData[1].split('')[userMode], prefixData[2].split('')[userMode]]);
						}
						bot.ircSupportedUserModesArray = userModeArray;
					break;
				}
			}
		}
	};

	bot.ircMsgNumHandles['311_318'] = function (data) {//RPL_WHOISUSER
		bot.emitBotEvent('botReceivedNum311', data);
		bot.ircResponseListenerEmit('311', data);
		var params = data[1][0][3];
		if (params[1] == options.botName) bot.ircBotHost=params[3];
	};

	bot.ircMsgNumHandles['352_315'] = function (data) {//RPL_WHOREPLY
		bot.emitBotEvent('botReceivedNum352', data);
		bot.ircResponseListenerEmit('352', data);
	};

	bot.ircMsgNumHandles['353_366'] = function (data) {//RPL_NAMREPLY
		bot.emitBotEvent('botReceivedNum353', data);
		bot.ircResponseListenerEmit('353', data);
	};

	bot.ircMsgNumHandles['364_365'] = function (data) {//RPL_LINKS
		bot.emitBotEvent('botReceivedNum364', data);
		bot.ircResponseListenerEmit('364', data);
		bot.ircNetworkServers = [];
		var parsedData, line, params;
		for (line in data[1]) {
			bot.ircNetworkServers[line] = {};
			params = data[1][line][3];
			bot.ircNetworkServers[line].mask = params[1];
			bot.ircNetworkServers[line].server = params[2];
			bot.ircNetworkServers[line].hop = (params[3].charAt(0) == ':' ? params[3].substr(1) : params[3]);
			bot.ircNetworkServers[line].info = data[1][line][5].split(' ').slice(1).join(' ');
		}
	};

	//main irc data receiving function
	bot.ircDataReceiveHandle = function (data) {
		var msgLines = data.split('\r\n');
		var lineI, line, isMsgEnd, lineP;

		function msgHandle(data) {
			if (bot.ircMsgHandles[data[2]] !== undefined) {
				bot.ircMsgHandles[data[2]](data);
			}
		}

		function msgNumHandle(data) {
			var iMLMBuffer = bot.ircMultilineMessageBuffer;
			var iMNH = bot.ircMsgNumHandles;
			var mH, nT = {};

			for (mH in iMNH) {
				nT[mH.substr(0,3)] = mH.substr(4,3);
			}

			if (iMLMBuffer) {
				iMLMBuffer[1][iMLMBuffer[2]] = data;
				iMLMBuffer[2]++;
			} else if (nT[data[2]] !== undefined) {
				iMLMBuffer = [data[2], [data], 1];
			}

			if (iMLMBuffer) {
				if (nT[iMLMBuffer[0]] == data[2]) {
					var handle = iMLMBuffer[0]+'_'+nT[iMLMBuffer[0]];
					iMNH[handle](iMLMBuffer);
					iMLMBuffer = null;
				} else if (iMLMBuffer[2] > options.ircMultilineMessageMaxLines) {
					iMLMBuffer = null;
				}
			}

			//save buffer state
			bot.ircMultilineMessageBuffer = iMLMBuffer;
		}

		bot.emitBotEvent('botReceivedDataRAW', data);

		for (lineI in msgLines) {
			lineI = +lineI;
			line = msgLines[lineI];
			isMsgEnd = (
				msgLines[lineI+1] === undefined
			) ? false : true;
			if (isMsgEnd) {
				if (bot.ircMessageBuffer) {
					line = bot.ircMessageBuffer+line;
					bot.ircMessageBuffer = null;
				}
				bot.emitBotEvent('botReceivedDataLine', line);
				lineP = bot.ircParseMessageLine(line);
				bot.emitBotEvent('botReceivedDataParsedLine', lineP);
				if (!bot.isNumeric(lineP[2])) {
					msgHandle(lineP);
				} else {
					msgNumHandle(lineP);
				}
			} else {
				bot.ircMessageBuffer = line;
			}
		}
	};

	//main bot initializing function
	bot.initIrcBot = function (connectionInfoMod) {
		bot.ircConnectionRegistered = false;
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
			bot.ircDataReceiveHandle(chunk);
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
			var expandIPv6Address = bot.expandIPv6Address;
			var strToHex = bot.strToHex;
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
							bot.log('Error: Proxy traversal failed');
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
							bot.log('Error: Proxy auth failed');
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
								bot.log('Error: Proxy rejected all known methods');
							}
						}
					});
				})();
			}
			function initIrc() {
				c.setEncoding('utf8');
				c.on('data', ircConnectionOnData);
				if (options.ircServerPassword)
					bot.ircSendCommandPASS(options.ircServerPassword);
				bot.ircSendCommandNICK(connectionInfo.nick);
				bot.ircSendCommandUSER(connectionInfo.nick,
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
			c.on('error', function (e) {
				bot.log('Connection error: ('+e+').');
			});
			c.on('timeout', function (e) {
				bot.log('Connection timeout');
			});
			c.on('close', function() {
				bot.log('Connection closed.');
			});
			bot.ircConnection = c;
			bot.emitBotEvent('botIrcConnectionCreated', c);
		}
		connect();
	};
}
