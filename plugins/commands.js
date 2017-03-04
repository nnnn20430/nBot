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
//reserved nBot variables
var bot;
var pId;
var options;
var pOpts;

//variables
var http = require('http');
var https = require('https');
var net = require('net');
var exec = require('child_process').exec;
var url = require('url');

var pluginDisabled = false;

//settings constructor
var SettingsConstructor = function (modified) {
	var settings, attrname;
	if (this!==SettingsConstructor) {
		settings = {
			command_request_maxBytes: 1024,
			radioStatus_mpdServer: 'localhost',
			radioStatus_mpdServerPort: 6600,
			opUsers: { 'nnnn20430': '' },
			opUsers_commandsAllowChanOp: false,
			opUsers_disabled: false,
			commandPrefix: '.',
			commandPrefixIgnoreOnDirect: true,
			reactToJoinPart: true,
			disabledPluginRemoveCommands: true,
			specificResponses: {},
			dynamicFunctions: {}
		};
		for (attrname in modified) {settings[attrname]=modified[attrname];}
		return settings;
	}
};

//main plugin object
var plugin = {};

//variables
plugin.authenticatedOpUsers = [];
plugin.commandsOriginObj = {};
plugin.netsplitData = [[false, false], {}, {}];

//misc plugin functions

//misc plugin functions: ping the server by connecting and quickly closing
plugin.pingTcpServer = function (host, port, callback){
	var isFinished = false;
	var timeA, timeB = new Date().getTime();
	function returnResults(status, info) {if (!isFinished) {callback(status, info); isFinished = true;}}
	if (port > 0 && port < 65536) {
		var pingHost = net.connect({port: port, host: host}, function () {
			timeA = new Date().getTime();
			returnResults(true, timeA-timeB);
			pingHost.end();pingHost.destroy();
		});
		pingHost.setTimeout(5*1000);
		pingHost.on('timeout', function () {pingHost.end();pingHost.destroy();returnResults(false, 'timeout');});
		pingHost.on('error', function (e) {pingHost.end();pingHost.destroy();returnResults(false, e);});
		pingHost.on('close', function () {returnResults(false, 'socket closed');});
	} else {returnResults(false, 'Error: port out of range');}
};

//misc plugin functions: return entire help
plugin.getHelpAll = function () {
	var commandArray = plugin.commandHelp('arrayOfCommands'), commandString = "";
	for (var command in commandArray) {
		commandString=commandString+pOpts.commandPrefix+plugin.commandHelp('commandInfo', commandArray[command])+'\n';
	}
	return 'Help for all commands:\n'+commandString;
};

//misc plugin functions: get random int
plugin.getRandomInt = function (min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

//misc plugin functions: is the user op
plugin.isOp = function (user, checkAuth){
	var isOpUser = false;
	if (checkAuth === undefined) {checkAuth=true;}
	if (pOpts.opUsers[user]) {
		if (checkAuth === true) {
			for (var authenticatedOpUser in plugin.authenticatedOpUsers) {
					if (user == plugin.authenticatedOpUsers[authenticatedOpUser]) {isOpUser = true;}
			}
		}else if (checkAuth === false){
			isOpUser = true;
		}
	}
	if (pOpts.opUsers_disabled) {isOpUser = true;}
	return isOpUser;
};

//misc plugin functions: give a user operator status
plugin.giveOp = function (user, pass) {
	var response = "Unknown error happened";
	if (!user && !pass) {
		response = "Error: User and password must be defined";
	} else if (plugin.isOp(user, false) === false) {
		pOpts.opUsers[user]=pass;
		response = "Success: User is now an Operator";
	} else {
		response = "Error: User is already an Operator";
	}
	return response;
};

//misc plugin functions: take operator status from a user
plugin.takeOp = function (user) {
	var response = "Unknown error happened";
	if (plugin.isOp(user, false) === true) {
		delete pOpts.opUsers[user];
		plugin.authenticatedOpUsers.remove(user);
		response = "Success: User is no longer an Operator";
	} else {
		response = "Error: User is not an Operator";
	}
	return response;
};

//misc plugin functions: authenticate user
plugin.authenticateOp = function (user, pass, ignorePass) {
	var response = "Error: Wrong username or password";
	if (plugin.isOp(user, false) === true && plugin.isOp(user) === false) {
		if(pass == pOpts.opUsers[user]  && pOpts.opUsers[user] !== ""){
			response = "Success: Correct login";
			plugin.authenticatedOpUsers.push(user);
		} else if (pOpts.opUsers[user] && ignorePass) {
			response = "Success: Password ignored";
			plugin.authenticatedOpUsers.push(user);
		} else {
			response = "Error: Wrong username or password";
		}
	} else if (plugin.isOp(user) === true) {response = "Error: User is already authenticated";}
	return response;
};

//misc plugin functions: de-authenticate user
plugin.deAuthenticateOp = function (user) {
	var response = "Unknown error happened";
	if (plugin.isOp(user) === true) {
		response = "Success: User has been de-authenticated";
		plugin.authenticatedOpUsers.remove(user);
	} else {
		response = "Error: User is not authenticated";
	}
	return response;
};

//misc plugin functions: short help message
plugin.getHelp = function () {
	var helpMessage, commandArray = plugin.commandHelp('arrayOfCommands'), commandString = "";
	for (var command in commandArray) {
		commandString = commandString+commandArray[command]+", ";
	}
	commandString = commandString.replace(/, $/, ".");
	helpMessage = 'Commands are prefixed with "'+pOpts.commandPrefix+'"\n'+'use '+pOpts.commandPrefix+'help "command" to get more info about the command\n'+'Current commands are: '+commandString;
	return helpMessage;
};

//misc plugin functions: is the user op on channel
plugin.isChanOp = function (user, channel){
	var isUserChanOp = false;
	if (bot.ircChannelUsers[channel] && bot.ircChannelUsers[channel][user] && bot.ircChannelUsers[channel][user].mode) {
		if (bot.ircChannelUsers[channel][user].mode.replace(/^(o|q|h|a)$/, "isOp").indexOf("isOp") != -1 ) {isUserChanOp = true;}
		if (bot.ircChannelUsers[channel][user].isGlobalOP) {isUserChanOp = true;}
	}
	return isUserChanOp;
};

//misc plugin functions: check if plugin is ready
plugin.pluginReadyCheck = function () {
	if (bot.plugins.simpleMsg &&
	bot.plugins.simpleMsg.ready) {
		//plugin is ready
		exports.ready = true;
		bot.emitBotEvent('botPluginReadyEvent', pId);
	}
};

//misc plugin functions: add listeners to simpleMsg plugin
plugin.utilizeSimpleMsg = function () {
	var simpleMsg = bot.plugins.simpleMsg.plugin;
	simpleMsg.msgListenerAdd(pId, 'PRIVMSG', function (data) {
		plugin.commandHandle(data);
		plugin.dynamicFunctionHandle(data);
		plugin.pluggableFunctionHandle(data);
		if (pOpts.specificResponses[data.message] !== undefined) {
			bot.ircSendCommandPRIVMSG(pOpts.specificResponses[data.message], data.responseTarget);
		}
	});

	simpleMsg.msgListenerAdd(pId, 'JOIN', function (data) {
		if (data.nick != options.botName){
			if (pOpts.reactToJoinPart === true) {
				var isNetsplit = false;
				if (Object.keys(plugin.netsplitData[1]).length) {
					if (plugin.netsplitData[1][data.nick]) {
						isNetsplit = true;
						delete plugin.netsplitData[1][data.nick];
						if (plugin.netsplitData[0][1]) {
							clearTimeout(plugin.netsplitData[0][1]);
						}
						plugin.netsplitData[0][1] = setTimeout(function () {
							plugin.netsplitData[0][1] = false;
							for (var channel in plugin.netsplitData[2]) {
								bot.ircSendCommandPRIVMSG('Netsplit over!', channel);
							}
							plugin.netsplitData[2] = {};
						}, 2000);
					}
				}
				if (!isNetsplit) {
					bot.ircSendCommandPRIVMSG('Welcome '+data.nick+' to channel '+data.channel, data.channel);
					if (data.nick == "nnnn20430"){bot.ircSendCommandPRIVMSG('My Creator is here!!!', data.channel);}
				}
			}
		}
	});

	simpleMsg.msgListenerAdd(pId, 'PART', function (data) {
		if (data.nick != options.botName){
			if (pOpts.reactToJoinPart === true) {
				bot.ircSendCommandPRIVMSG('Goodbye '+data.nick, data.channel);
			}
			if(plugin.isOp(data.nick)){
				plugin.authenticatedOpUsers.remove(data.nick);
				bot.ircSendCommandPRIVMSG('You have left a channel with '+options.botName+' in it you have been de-authenticated', data.nick);
			}
		}
	});

	simpleMsg.msgListenerAdd(pId, 'QUIT', function (data) {
		if (data.nick != options.botName){
			if(plugin.isOp(data.nick)){plugin.authenticatedOpUsers.remove(data.nick);}
			if (pOpts.reactToJoinPart === true) {
				//detect netsplits
				var isNetsplit = false;
				for (var server in bot.ircNetworkServers) {
					if (data.reason.split(' ')[0] == bot.ircNetworkServers[server].mask) {
						isNetsplit = true;
					}
				}
				if (isNetsplit) {
					if (plugin.netsplitData[0][0]) {
						clearTimeout(plugin.netsplitData[0][0]);
					}
					plugin.netsplitData[0][0] = setTimeout(function () {
						plugin.netsplitData[0][0] = false;
						for (var channel in plugin.netsplitData[2]) {
							bot.ircSendCommandPRIVMSG('Netsplit: '+data.reason.split(' ')[0]+'<=>'+data.reason.split(' ')[1]+'.', channel);
						}
					}, 2000);
					plugin.netsplitData[1][data.nick] = true;
					for (var channelS in data.channels) {
						plugin.netsplitData[2][data.channels[channelS]] = true;
					}
				} else {
					for (var channel in data.channels) {
						bot.ircSendCommandPRIVMSG('Goodbye '+data.nick, data.channels[channel]);
					}
				}
			}
		}
	});

	simpleMsg.msgListenerAdd(pId, 'NICK', function (data) {
		if (data.nick != options.botName){
			if(plugin.isOp(data.nick)){
				plugin.authenticatedOpUsers.remove(data.nick);
				bot.ircSendCommandPRIVMSG('You have changed your authenticated operator nickname you have been de-authenticated', data.newnick);
			}
		}
	});

	simpleMsg.msgListenerAdd(pId, 'KICK', function (data) {
		if (data.nick != options.botName){
			if(plugin.isOp(data.nick)){
				plugin.authenticatedOpUsers.remove(data.nick);
				bot.ircSendCommandPRIVMSG('You have been kicked from a channel with '+options.botName+' in it you have been de-authenticated', data.nick);
			}
		}
	});

	plugin.pluginReadyCheck();
};

//bot command handle functions

//bot command handle functions: command help manager
plugin.commandHelp = function (purpose, command) {
	var response, index;
	if (purpose == 'arrayOfCommands') {
		var commandArray = [];
		for (index in plugin.commandsHelpArray) {
			if(plugin.commandsHelpArray.hasOwnProperty(index)) {
				commandArray[index] = plugin.commandsHelpArray[index][0];
			}
		}
		response = commandArray;
	}
	if (purpose == 'commandInfo') {
		response = 'Command not found';
		for (index in plugin.commandsHelpArray) {
			if(plugin.commandsHelpArray.hasOwnProperty(index)) {
				if (plugin.commandsHelpArray[index][0] == command) {response = plugin.commandsHelpArray[index][1];}
			}
		}
	}
	return response;
};

//bot command handle functions: handle simple bot commands
plugin.commandHandle = function (data) {
	var command = data.messageARGS[0]||'', isCommand = false;
	if (command.substr(0, pOpts.commandPrefix.length) == pOpts.commandPrefix) {
		command = command.substr(pOpts.commandPrefix.length);
		isCommand = true;
	} else if (pOpts.commandPrefixIgnoreOnDirect && data.to.charAt(0) != '#') {
		isCommand = true;
	}
	if (isCommand === true) {
		if (plugin.commandsObject[command] !== undefined) {
			try {
				plugin.commandsObject[command](data);
			} catch (e) {
				bot.log('Error: Simple bot command "'+command+'" from plugin "'+plugin.getCommandOrigin(command)+'" is erroneous:'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
			}
		}
	}
};

//bot command handle functions: add simple bot command (for plugins)
plugin.commandAdd = function (command, commandFunction, helpString, origin) {
	var response = "Unknown error happened";
	if (plugin.commandsObject[command] === undefined) {
		response = "Success: Command added";
		plugin.commandsObject[command] = commandFunction;
		if (helpString) {plugin.commandsHelpArray.push([command, helpString]);}
		if (origin) {plugin.commandsOriginObj[command] = origin;}
	} else {
		response = "Error: Command already exists";
	}
	return response;
};

//bot command handle functions: remove simple bot command
plugin.commandRemove = function (command) {
	var response = "Unknown error happened", index;
	if (plugin.commandsObject[command] !== undefined) {
		response = "Success: Command removed";
		delete plugin.commandsObject[command];
		for (index in plugin.commandsHelpArray) {
			if(plugin.commandsHelpArray.hasOwnProperty(index)) {
				if (plugin.commandsHelpArray[index][0] == command) {
					plugin.commandsHelpArray.remove(plugin.commandsHelpArray[index]);
				}
			}
		}
		if (plugin.commandsOriginObj[command] !== undefined) {delete plugin.commandsOriginObj[command];}
	} else {
		response = "Error: Command doesn't exist";
	}
	return response;
};

//bot command handle functions: simple bot command origin
plugin.getCommandOrigin = function (command) {
	var response = pId;
	if (plugin.commandsOriginObj[command] !== undefined) {response = plugin.commandsOriginObj[command];}
	return response;
};

//bot command handle functions: remove commands with same origin
plugin.commandsRemoveByOrigin = function (origin) {
	var command;
	for (command in plugin.commandsOriginObj) {
		if (plugin.commandsOriginObj[command] == origin) {
			plugin.commandRemove(command);
		}
	}
};

//bot command handle functions: handle dynamic bot functions
plugin.dynamicFunctionHandle = function (data) {
	var dynamicFunction;
	for (var dynamicFunctionName in pOpts.dynamicFunctions) {
		try {
			dynamicFunction=eval("(function (data) {"+pOpts.dynamicFunctions[dynamicFunctionName]+"})");
			dynamicFunction(data);
		} catch (e) {
			bot.log('Error: Dynamic function "'+dynamicFunctionName+'" is erroneous:'+(options.errorsIncludeStack?('\n'+e.stack):(' ('+e+')')));
		}
	}
};

//bot command handle functions: pluggable functions (to make it easier for plugins to add or remove functions)
plugin.pluggableFunctionHandle = function (data) {
	for (var pluggableFunction in plugin.pluggableFunctionObject) {
		plugin.pluggableFunctionObject[pluggableFunction](data);
	}
};

//bot commands help array
plugin.commandsHelpArray = [
	['hug', 'hug: gives you a free hug'],
	['whereis', 'whereis "user": lists the channels the user is in (the command can contain anything between where and is)'],
	['echo', 'echo "string": prints string back to the chat'],
	['sendmsg', 'sendmsg "#channel" "string": prints string on the channel (only if the bot is in it)'],
	['view', 'view "url": prints the data located at the url, data must not be bigger than 1KiB'],
	['ping', 'ping "host" "port": pings the port on host'],
	['nbot', 'nbot: prints some info about nBot'],
	['help', 'help: prints help message'],
	['away', 'away: prints a list of away users in the channel'],
	['userlist', 'userlist [count|update]: prints a list of users on the channel'],
	['origin', 'origin "command": prints plugin origin of a command'],
	['raw', 'raw "raw command": make the bot send a raw command to the irc server (op only)'],
	['savesettings', 'savesettings: save current settings to file (op only)'],
	['join', 'join "#channel": make the bot join the channel (op only)'],
	['part', 'part "#channel": make the bot part the channel (op only)'],
	['login', 'login "password": authenticate as an Operator (op only)(please send this command directly to the bot)'],
	['logout', 'logout: de-authenticate (op only)'],
	['op', 'op "user" "password": give the user Operator status (op only)'],
	['deop', 'deop "user": take Operator status from the user (op only)'],
	['helpall', 'helpall: prints help for all commands to the user'],
	['responseadd', 'responseadd "trigger" "response": add a response to trigger (op only)'],
	['responseremove', 'responseremove "trigger": remove a response from trigger (op only)'],
	['responselist', 'responselist: prints list of responses (op only)'],
	['responseclear', 'responsereclear: remove all set triggered responses (op only)'],
	['functionadd', 'functionadd "name" "code": add a function named name with node.js code (op only)(the function is passed variable data={rawdata, nick, to, message, messageARGS, responseTarget})'],
	['functionremove', 'functionremove "name": remove a function named name (op only)'],
	['functionlist', 'functionlist: prints list of functions (op only)'],
	['functionshow', 'functionshow "name": prints the code of function named name (op only)'],
	['pluginreload', 'pluginreload "id": reload plugin with id (op only)'],
	['pluginreloadall', 'pluginreloadall: reload all plugins (op only)'],
	['evaljs', 'evaljs "code": evaluates node.js code (op only)'],
	['pluginload', 'pluginload "plugin": load a plugin (op only)'],
	['plugindisable', 'plugindisable "plugin": disable a loaded plugin (op only)'],
	['date', 'date [UTC|ISO|UNIX]: get current date'],
	['sh', 'sh "shell expresion": run commands through /bin/sh (op only)'],
	['ascii', 'ascii ENCODE|DECODE "string": convert between text and ascii binary representation'],
	['binarycomp', 'binarycomp "string": binary complement'],
	['hex', 'hex ENCODE|DECODE "string": convert between binary and hex'],
	['quaternary', 'quaternary ENCODE|DECODE "string": convert between binary and quaternary'],
	['dna', 'dna "string": convert between quaternary and dna'],
	['dnacomp', 'dnacomp "string": dna complement']
];

//bot commands object
plugin.commandsObject = {
	hug: function (data) {
		bot.ircSendCommandPRIVMSG('*Hugs '+data.nick+'*', data.responseTarget);
	},
	echo: function (data) {
		var message = '';
		for (var i in data.messageARGS) {
			if (i > 0) {message += ' '+data.messageARGS[i];}
		}
		message=message.substr(1);
		bot.ircSendCommandPRIVMSG(
			bot.strReplaceEscapeSequences(message), data.responseTarget);
	},
	sendmsg: function (data) {
		bot.ircSendCommandPRIVMSG(
			bot.strReplaceEscapeSequences(data.messageARGS[2]), data.messageARGS[1]);
	},
	view: function (data) {
		var protocol = false;
		if (data.messageARGS[1].substr(0, 'http://'.length) == 'http://') {
			protocol = http;
		} else if (data.messageARGS[1].substr(0, 'https://'.length) == 'https://') {
			protocol = https;
		}
		if (protocol) {
			protocol.get(url.parse(data.messageARGS[1], true), function(res) {
				var resData = '';
				res.setEncoding('utf8');
				res.on('data', function (chunk) {resData += chunk;});
				res.on('end', function () {
					if(resData.length < pOpts.command_request_maxBytes){
						bot.ircSendCommandPRIVMSG(resData, data.responseTarget);
					}
				});
			}).on('error', function(e) {
				bot.ircSendCommandPRIVMSG("Got error: "+e.message, data.responseTarget);
			});
		}
	},
	ping: function (data) {
		plugin.pingTcpServer(data.messageARGS[1], data.messageARGS[2], function (status, info) {
			var statusString = (status?'open':'closed');
			var infoString = (status?(bot.isNumeric(info)?info+"ms":info):info);
			bot.ircSendCommandPRIVMSG("Port "+data.messageARGS[2]+" on "+data.messageARGS[1]+" is: "+statusString+" ("+infoString+")", data.responseTarget);
		});
	},
	nbot: function (data) {
		bot.ircSendCommandPRIVMSG("I'm a random bot written for fun, you can see my code here: https://git.plfgr.eu.org/?p=nBot.git", data.responseTarget);
	},
	help: function (data) {
		if (data.messageARGS[1] !== undefined) {
			bot.ircSendCommandPRIVMSG(plugin.commandHelp("commandInfo", data.messageARGS[1]), data.responseTarget);
		} else {
			bot.ircSendCommandPRIVMSG(plugin.getHelp(), data.responseTarget);
		}
	},
	away: function (data) {
		bot.ircUpdateUsersInChannel(data.responseTarget, function (userData) {
			var ircGoneUsersString = "", user;
			userData = userData[data.responseTarget];
			for (user in userData) {
				if (!userData[user].isHere) {
					ircGoneUsersString +=user+", ";
				}
			}
			bot.ircSendCommandPRIVMSG("Away users are: "+ircGoneUsersString.replace(/, $/, ".").replace(/^$/, 'No users are away.'), data.responseTarget);
		});
	},
	userlist: function (data) {
		if (data.messageARGS[1] == 'update') {
			bot.ircUpdateUsersInChannel(data.responseTarget);
		} else if (data.messageARGS[1] == 'count') {
			bot.ircSendCommandPRIVMSG(Object.keys(bot.ircChannelUsers[data.responseTarget]).length, data.responseTarget);
		} else {
			var nickList = '', nickTotal = 0, channelUsersObj = bot.ircChannelUsers[data.responseTarget];
			for (var user in channelUsersObj) {
				nickList += bot.ircModePrefixConvert('prefix', channelUsersObj[user].mode)+user+', '; nickTotal++;
			}
			nickList = nickList.replace(/, $/, ". ");
			nickList += '(Nick total: '+nickTotal+')';
			bot.ircSendCommandPRIVMSG(nickList, data.responseTarget);
		}
	},
	origin: function (data) {
		if (plugin.commandsObject[data.messageARGS[1]] !== undefined) {
			bot.ircSendCommandPRIVMSG('Command "'+data.messageARGS[1]+'" is from plugin "'+plugin.getCommandOrigin(data.messageARGS[1])+'"', data.responseTarget);
		}
	},
	raw: function (data) {
		if(plugin.isOp(data.nick) === true) {
			bot.ircWriteData(data.messageARGS[1]);
		}
	},
	savesettings: function (data) {
		if(plugin.isOp(data.nick) === true) {
			bot.im.settingsSave(null, null, function () {
				bot.ircSendCommandPRIVMSG('Settings saved!', data.responseTarget);
			});
		}
	},
	join: function (data) {
		if(plugin.isOp(data.nick) === true) {
			options.channels.push(data.messageARGS[1]);
		}
	},
	part: function (data) {
		if(plugin.isOp(data.nick) === true) {
			options.channels.remove(data.messageARGS[1]);
			bot.ircSendCommandPART(data.messageARGS[1], data.messageARGS[2]);
		} else if (plugin.isChanOp(data.nick, data.responseTarget) === true &&
		  pOpts.opUsers_commandsAllowChanOp) {
			options.channels.remove(data.responseTarget);
			bot.ircSendCommandPART(data.responseTarget);
		}
	},
	login: function (data) {
		bot.ircSendCommandPRIVMSG(plugin.authenticateOp(data.nick, data.messageARGS[1]), data.responseTarget);
	},
	logout: function (data) {
		bot.ircSendCommandPRIVMSG(plugin.deAuthenticateOp(data.nick), data.responseTarget);
	},
	op: function (data) {
		if(plugin.isOp(data.nick) === true) {
			bot.ircSendCommandPRIVMSG(plugin.giveOp(data.messageARGS[1], data.messageARGS[2]), data.responseTarget);
		}
	},
	deop: function (data) {
		if(plugin.isOp(data.nick) === true) {
			bot.ircSendCommandPRIVMSG(plugin.takeOp(data.messageARGS[1]), data.responseTarget);
		}
	},
	helpall: function (data) {
		bot.ircSendCommandPRIVMSG(plugin.getHelpAll(), data.nick);
	},
	responseadd: function (data) {
		if(plugin.isOp(data.nick) === true) {
			pOpts.specificResponses[data.messageARGS[1]]=data.messageARGS[2];
		}
	},
	responseremove: function (data) {
		if(plugin.isOp(data.nick) === true) {
			delete pOpts.specificResponses[data.messageARGS[1]];
		}
	},
	responselist: function (data) {
		if(plugin.isOp(data.nick) === true) {
			var specificResponseList="";
			for (var specificResponse in pOpts.specificResponses) {
				specificResponseList+="\""+specificResponse+"\", ";
			}
			bot.ircSendCommandPRIVMSG("Current responses are: "+specificResponseList.replace(/, $/, ".").replace(/^$/, 'No responses found.'), data.responseTarget);
		}
	},
	reponseclear: function (data) {
		if(plugin.isOp(data.nick) === true) {
			pOpts.specificResponses = {};
		}
	},
	functionadd: function (data) {
		if(plugin.isOp(data.nick) === true) {
			pOpts.dynamicFunctions[data.messageARGS[1]]=data.messageARGS[2];
		}
	},
	functionremove: function (data) {
		if(plugin.isOp(data.nick) === true) {
			delete pOpts.dynamicFunctions[data.messageARGS[1]];
		}
	},
	functionlist: function (data) {
		if(plugin.isOp(data.nick) === true) {
			var dynamicFunctionList="";
			for (var dynamicFunction in pOpts.dynamicFunctions) {
				dynamicFunctionList+="\""+dynamicFunction+"\", ";
			}
			bot.ircSendCommandPRIVMSG("Current functions are: "+dynamicFunctionList.replace(/, $/, ".").replace(/^$/, 'No dynamic functions found.'), data.responseTarget);
		}
	},
	functionshow: function (data) {
		if(plugin.isOp(data.nick) === true) {
			var dynamicFunction;
			if ((dynamicFunction = pOpts.dynamicFunctions[data.messageARGS[1]]) !== undefined) {
				bot.ircSendCommandPRIVMSG(dynamicFunction, data.responseTarget);
			} else {
				bot.ircSendCommandPRIVMSG("Error: Function not found", data.responseTarget);
			}
		}
	},
	pluginreload: function (data) {
		if (plugin.isOp(data.nick) === true) {
			if (bot.plugins[data.messageARGS[1]]) {
				bot.pluginDisable(data.messageARGS[1]);
				bot.pluginLoad(data.messageARGS[1], options.pluginDir+'/'+data.messageARGS[1]+'.js');
			}
		}
	},
	pluginreloadall: function (data) {
		function pluginReload(id) {
			bot.pluginDisable(id);
			bot.pluginLoad(id, options.pluginDir+'/'+id+'.js');
		}
		if(plugin.isOp(data.nick) === true) {
			pluginReload(pId);
			for (var id in bot.plugins) {
				if (id != pId && id != 'simpleMsg') {
					pluginReload(id);
				}
			}
		}
	},
	evaljs: function (data) {
		if (plugin.isOp(data.nick) === true) {
			eval("(function () {"+data.messageARGS[1]+"})")();
		}
	},
	pluginload: function (data) {
		if (plugin.isOp(data.nick) === true) {
			bot.pluginLoad(data.messageARGS[1], options.pluginDir+'/'+data.messageARGS[1]+'.js');
			options.plugins.push(data.messageARGS[1]);
		}
	},
	plugindisable: function (data) {
		if (plugin.isOp(data.nick) === true) {
			bot.pluginDisable(data.messageARGS[1]);
			options.plugins.remove(data.messageARGS[1]);
		}
	},
	date: function (data) {
		var date = '';
		switch (data.messageARGS[1]?data.messageARGS[1].toUpperCase():null) {
			case 'UTC': date = new Date().toUTCString(); break;
			case 'ISO': date = new Date().toISOString(); break;
			case 'UNIX': date = Math.round(new Date().getTime() / 1000); break;
			default: date = new Date();
		}
		bot.ircSendCommandPRIVMSG(date, data.responseTarget);
	},
	sh: function (data) {
		var shell_arguments = '';
		for (var i in data.messageARGS) {
			if (i > 0) {
				shell_arguments += ' '+data.messageARGS[i];
			}
		}
		shell_arguments=shell_arguments.substr(1);
		if (plugin.isOp(data.nick) === true) {
			exec(shell_arguments, {shell: '/bin/bash'}, function(error, stdout, stderr){
				bot.ircSendCommandPRIVMSG(stdout.replace(/\n/g, ' ;; '), data.responseTarget);
			});
		}
	},
	ascii: function (data, callback) {
		var i, strArr, msgB = '', msgA = '';
		for (i in data.messageARGS) {
			if (i > 1) {
				msgB += ' '+data.messageARGS[i];
			}
		}
		msgB = msgB.substr(1);
		switch (
			data.messageARGS[1]?
			data.messageARGS[1].toUpperCase().split('')[0]:
			null
		) {
			case 'E':
				strArr = msgB.split('');
				for (i in strArr) {
					msgA += ' '+('0000000'+parseInt(
						new Buffer(
							strArr[i].toString(), 'utf8'
						).toString('hex'), 16
					).toString(2)).slice(-8);
				}
				msgA = msgA.substr(1);
				break;
			case 'D':
				msgB = msgB.split(' ').join('');
				i = 0;
				while (8*(i+1) <= msgB.length) {
					msgA += new Buffer(
						parseInt(
							msgB.substr(8*i, 8), 2
						).toString(16), 'hex'
					).toString('utf8');
					i++;
				}
				break;
		}
		if (callback)
			callback(msgA);
		else
			bot.ircSendCommandPRIVMSG(msgA, data.responseTarget);
	},
	binarycomp: function (data, callback) {
		var i, strArr, c, msgB = '', msgA = '';
		for (i in data.messageARGS) {
			if (i > 0) {
				msgB += ''+data.messageARGS[i];
			}
		}
		strArr = msgB.split('');
		for (i in strArr) {
			msgA += (+strArr[i] === 0?1:(+strArr[i] === 1?0:''));
		}
		if (msgA.length == msgB.length)
			if (callback)
				callback(msgA);
			else
				bot.ircSendCommandPRIVMSG(msgA, data.responseTarget);
	},
	hex: function (data, callback) {
		var i, strArr, c, msgB = '', msgA = '';
		var e, tT = [
			['0', '0000'], ['1', '0001'], ['2', '0010'], ['3', '0011'],
			['4', '0100'], ['5', '0101'], ['6', '0110'], ['7', '0111'],
			['8', '1000'], ['9', '1001'], ['A', '1010'], ['B', '1011'],
			['C', '1100'], ['D', '1101'], ['E', '1110'], ['F', '1111']
		];
		for (i in data.messageARGS) {
			if (i > 1) {
				msgB += ''+data.messageARGS[i].toUpperCase();
			}
		}
		strArr = msgB.split('');
		switch (
			data.messageARGS[1]?
			data.messageARGS[1].toUpperCase().split('')[0]:
			null
		) {
			case 'E':
				i = 0;
				msgA = [];
				strArr = strArr
					.reverse()
					.concat(['','','','','','','']); // 3+4 padding
				while (true) {
					c = '';
					c += strArr[4*i+3];
					c += strArr[4*i+2];
					c += strArr[4*i+1];
					c += strArr[4*i+0];
					if (c === '') break;
					c = ('000'+c).slice(-4); // more padding
					for (e in tT) {
						if (c === tT[e][1])
							msgA = msgA.concat([tT[e][0]]);
					}
					i++;
				}
				msgA = msgA.reverse().join('');
				break;
			case 'D':
				for (i in strArr) {
					for (e in tT) {
						if (strArr[i] === tT[e][0])
							msgA += tT[e][1];
					}
				}
				break;
		}
		if (callback)
			callback(msgA);
		else
			bot.ircSendCommandPRIVMSG(msgA, data.responseTarget);
	},
	quaternary: function (data, callback) {
		var i, strArr, c, msgB = '', msgA = '';
		var e, tT = [
			['0', '00'], ['1', '01'],
			['2', '10'], ['3', '11']
		];
		for (i in data.messageARGS) {
			if (i > 1) {
				msgB += ''+data.messageARGS[i];
			}
		}
		strArr = msgB.split('');
		switch (
			data.messageARGS[1]?
			data.messageARGS[1].toUpperCase().split('')[0]:
			null
		) {
			case 'E':
				i = 0;
				msgA = [];
				strArr = strArr
					.reverse()
					.concat(['','','']); // 1+2 padding
				while (true) {
					c = '';
					c += strArr[2*i+1];
					c += strArr[2*i+0];
					if (c === '') break;
					c = ('0'+c).slice(-2); // more padding
					for (e in tT) {
						if (c === tT[e][1])
							msgA = msgA.concat([tT[e][0]]);
					}
					i++;
				}
				msgA = msgA.reverse().join('');
				break;
			case 'D':
				for (i in strArr) {
					for (e in tT) {
						if (strArr[i] === tT[e][0])
							msgA += tT[e][1];
					}
				}
				break;
		}
		if (callback)
			callback(msgA);
		else
			bot.ircSendCommandPRIVMSG(msgA, data.responseTarget);
	},
	dna: function (data, callback) {
		var i, strArr, msgB = '', msgA = '', type = 'quaternary';
		for (i in data.messageARGS) {
			if (i > 0) {
				msgB += ''+data.messageARGS[i];
			}
		}
		msgB = msgB.toUpperCase();
		strArr = msgB.split('');
		for (i in strArr) {
			switch (strArr[i]) {
				default: type = 'invalid'; break;
				case '0':
					if (type == 'quaternary') msgA += 'A';
					else type = 'invalid';
					break;
				case '1':
					if (type == 'quaternary') msgA += 'C';
					else type = 'invalid';
					break;
				case '2':
					if (type == 'quaternary') msgA += 'G';
					else type = 'invalid';
					break;
				case '3':
					if (type == 'quaternary') msgA += 'T';
					else type = 'invalid';
					break;
				case 'A':
					if (type == 'quaternary')
						type = (msgA.length?'invalid':'dna');
					if (type == 'dna') msgA += '0';
					break;
				case 'T':
					if (type == 'quaternary')
						type = (msgA.length?'invalid':'dna');
					if (type == 'dna') msgA += '3';
					break;
				case 'C':
					if (type == 'quaternary')
						type = (msgA.length?'invalid':'dna');
					if (type == 'dna') msgA += '1';
					break;
				case 'G':
					if (type == 'quaternary')
						type = (msgA.length?'invalid':'dna');
					if (type == 'dna') msgA += '2';
					break;
			}
		}
		if (type != 'invalid')
			if (callback)
				callback(msgA);
			else
				bot.ircSendCommandPRIVMSG(msgA, data.responseTarget);
	},
	dnacomp: function (data, callback) {
		var i, strArr, msgB = '', msgA = '';
		var e, tT = [
			['A', 'T'],
			['C', 'G']
		];
		for (i in data.messageARGS) {
			if (i > 0) {
				msgB += ''+data.messageARGS[i];
			}
		}
		msgB = msgB.toUpperCase();
		strArr = msgB.split('');
		for (i in strArr) {
			for (e in tT) {
				if (strArr[i] == tT[e][0])
					msgA += tT[e][1];
				else if (strArr[i] == tT[e][1])
					msgA += tT[e][0];
			}
		}
		if (callback)
			callback(msgA);
		else
			bot.ircSendCommandPRIVMSG(msgA, data.responseTarget);
	}
};

//bot pluggable functions object
plugin.pluggableFunctionObject = {
	whereis: function (data) {
		var commandArgsWhereis;
		if ((commandArgsWhereis = new RegExp('^'+pOpts.commandPrefix+'where(?:.*)*?(?=is)is ([^ ]*)', 'g').exec(data.message)) !== null) {
			bot.ircSendCommandWHOIS(commandArgsWhereis[1], function(whoisData){
				var channels = '';
				for (var line in whoisData[1]) {
					if (whoisData[1][line][2] == 319) {
						channels += whoisData[1][line][5].replace(/[^ #]{0,1}#/g, '#');
					}
				}
				var channelArray = channels.split(' ');
				channels = channelArray.join(' ');
				bot.ircSendCommandPRIVMSG(commandArgsWhereis[1]+' is on: '+channels.replace(/^$/, 'User not found on any channel'), data.responseTarget);
			});
		}
	},
	hi: function (data) {
		if (new RegExp('(Hi|Hello|Hey|Hai) '+options.botName, 'gi').exec(data.message) !== null) {
			bot.ircSendCommandPRIVMSG('Hi '+data.nick, data.responseTarget);
		}
	},
	ctcpVersion: function (data) {
		if (new RegExp('\x01VERSION\x01', 'g').exec(data.message) !== null) {
			bot.ircSendCommandNOTICE("\x01VERSION nBot v0.3.1.4\x01", data.nick);
		}
	},
	ctcpPing: function (data) {
		var timestamp;
		if ((timestamp = new RegExp('\x01PING ([^\x01]*)\x01', 'g').exec(data.message)) !== null) {
			bot.ircSendCommandNOTICE("\x01PING "+timestamp[1]+"\x01", data.nick);
		}
	},
	ctcpTime: function (data) {
		if (new RegExp('\x01TIME\x01', 'g').exec(data.message) !== null) {
			bot.ircSendCommandNOTICE("\x01TIME "+new Date()+"\x01", data.nick);
		}
	},
	ctcpClientinfo: function (data) {
		if (new RegExp('\x01CLIENTINFO\x01', 'g').exec(data.message) !== null) {
			bot.ircSendCommandNOTICE("\x01CLIENTINFO VERSION PING TIME CLIENTINFO SOURCE\x01", data.nick);
		}
	},
	ctcpSource: function (data) {
		if (new RegExp('\x01SOURCE\x01', 'g').exec(data.message) !== null) {
			bot.ircSendCommandNOTICE("\x01SOURCE https://phab.plfgr.eu.org/diffusion/NBOT/\x01", data.nick);
		}
	}
};

//exports
module.exports.plugin = plugin;
module.exports.ready = false;

//reserved functions

//handle "botEvent" from bot (botEvent is used for irc related activity)
module.exports.botEvent = function (event) {
	switch (event.eventName) {
		//make sure operator list is clean if new connection is made
		case 'botPluginDisableEvent':
			if (event.eventData == pId) {pluginDisabled = true;}
			if (pOpts.disabledPluginRemoveCommands) {
				plugin.commandsRemoveByOrigin(event.eventData);
			}
			break;
		case 'botPluginReadyEvent':
			if (event.eventData == 'simpleMsg') {
				plugin.utilizeSimpleMsg();
			}
			break;
	}
};

//main function called when plugin is loaded
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
	if (bot.plugins.simpleMsg &&
	bot.plugins.simpleMsg.ready) {
		plugin.utilizeSimpleMsg();
	}
};
